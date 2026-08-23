import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  ASSET_KIND_LABEL,
  assetIdentifier,
  normalizeAssetIdentifier,
} from '../../lib/fleetAssets'

const HEADER_ALIASES = {
  name: ['ชื่อ', 'ชื่อรถ', 'ชื่อยานพาหนะ', 'ชื่อทรัพย์สิน', 'ชื่อเครื่องยนต์', 'name'],
  license_plate: ['ทะเบียน', 'ทะเบียนรถ', 'เลขทะเบียน', 'licenseplate', 'license_plate'],
  asset_code: ['รหัสครุภัณฑ์', 'รหัสทรัพย์สิน', 'รหัสเครื่องยนต์', 'assetcode', 'asset_code'],
  asset_kind: ['ชนิดทรัพย์สิน', 'กลุ่มทรัพย์สิน', 'assetkind', 'asset_kind'],
  vehicle_type: ['ประเภท', 'ประเภทรถ', 'ประเภทเครื่อง', 'vehicletype', 'vehicle_type'],
  department: ['กอง', 'หน่วยงาน', 'ส่วนงาน', 'กอง/หน่วยงาน', 'department'],
  fuel_type: ['เชื้อเพลิง', 'ประเภทเชื้อเพลิง', 'fueltype', 'fuel_type'],
  meter_unit: ['หน่วยมิเตอร์', 'หน่วยเลขไมล์', 'meterunit', 'meter_unit'],
  odometer_initial: ['มิเตอร์เริ่มต้น', 'เลขไมล์เริ่มต้น', 'ชั่วโมงเริ่มต้น', 'odometerinitial', 'odometer_initial'],
  brand: ['ยี่ห้อ', 'brand'],
  model: ['รุ่น', 'model'],
  tank_capacity: ['ความจุถัง', 'ความจุถังลิตร', 'tankcapacity', 'tank_capacity'],
  is_pool: ['รถกลาง', 'ใช้ร่วมกัน', 'ispool', 'is_pool'],
  status: ['สถานะ', 'status'],
  notes: ['หมายเหตุ', 'notes'],
}

const VALID_STATUS = new Set(['active', 'inactive', 'under_repair', 'retired'])
const TEMPLATE_HEADERS = [
  'ชื่อ', 'ชนิดทรัพย์สิน', 'ทะเบียนรถ', 'รหัสครุภัณฑ์', 'ประเภท', 'กอง/หน่วยงาน',
  'เชื้อเพลิง', 'หน่วยมิเตอร์', 'มิเตอร์เริ่มต้น', 'ยี่ห้อ', 'รุ่น', 'ความจุถัง',
  'รถกลาง', 'สถานะ', 'หมายเหตุ',
]

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('th-TH')
    .replace(/[\s_\-/().]+/g, '')
}

function columnIndex(headers, key) {
  const aliases = HEADER_ALIASES[key].map(normalizeHeader)
  return headers.findIndex(header => aliases.includes(normalizeHeader(header)))
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      if (row.some(value => String(value).trim())) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  row.push(cell)
  if (row.some(value => String(value).trim())) rows.push(row)
  return rows
}

function excelColumnIndex(reference = '') {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? ''
  let result = 0
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64
  return Math.max(0, result - 1)
}

async function parseXlsx(file) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const workbookEntry = zip.file('xl/workbook.xml')
  const relsEntry = zip.file('xl/_rels/workbook.xml.rels')
  if (!workbookEntry || !relsEntry) throw new Error('ไฟล์ XLSX ไม่มีโครงสร้าง Workbook ที่รองรับ')

  const parser = new DOMParser()
  const workbook = parser.parseFromString(await workbookEntry.async('string'), 'application/xml')
  const rels = parser.parseFromString(await relsEntry.async('string'), 'application/xml')
  const firstSheet = workbook.querySelector('sheet')
  const relationshipId = firstSheet?.getAttribute('r:id')
    || firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
  const relationship = [...rels.querySelectorAll('Relationship')]
    .find(item => item.getAttribute('Id') === relationshipId)
  const target = relationship?.getAttribute('Target')
  if (!target) throw new Error('ไม่พบ Worksheet แรกในไฟล์ XLSX')

  const worksheetPath = target.startsWith('/')
    ? target.slice(1)
    : `xl/${target.replace(/^\.\//, '')}`
  const worksheetEntry = zip.file(worksheetPath)
  if (!worksheetEntry) throw new Error('ไม่สามารถอ่าน Worksheet แรกได้')

  const sharedEntry = zip.file('xl/sharedStrings.xml')
  const sharedStrings = sharedEntry
    ? [...parser.parseFromString(await sharedEntry.async('string'), 'application/xml').querySelectorAll('si')]
        .map(item => item.textContent ?? '')
    : []

  const worksheet = parser.parseFromString(await worksheetEntry.async('string'), 'application/xml')
  return [...worksheet.querySelectorAll('sheetData > row')].map(rowNode => {
    const row = []
    for (const cellNode of rowNode.querySelectorAll('c')) {
      const index = excelColumnIndex(cellNode.getAttribute('r'))
      const type = cellNode.getAttribute('t')
      const raw = cellNode.querySelector('v')?.textContent ?? ''
      const value = type === 's'
        ? sharedStrings[Number(raw)] ?? ''
        : type === 'inlineStr'
          ? cellNode.querySelector('is')?.textContent ?? ''
          : raw
      row[index] = value
    }
    return row
  }).filter(row => row.some(value => String(value ?? '').trim()))
}

// ระบบนี้ดูแลเฉพาะยานพาหนะแล้ว (ตัด "เครื่องยนต์"/"ครุภัณฑ์" ออก แยกไปคนละเมนู) —
// ไม่ว่าคอลัมน์ "ชนิด" ในไฟล์นำเข้าจะเขียนว่าอะไรมา ก็ import เป็น vehicle เสมอ
function mapAssetKind() {
  return 'vehicle'
}

function mapVehicleType(value, kind) {
  const normalized = normalizeHeader(value)
  const entries = [
    ['motorcycle', ['motorcycle', 'จักรยานยนต์', 'มอเตอร์ไซค์']],
    ['pickup', ['pickup', 'รถกระบะ', 'กระบะ']],
    ['truck', ['truck', 'รถบรรทุก', 'รถขยะ', 'รถบรรทุกน้ำ']],
    ['van', ['van', 'รถตู้', 'รถรับส่ง']],
    ['excavator', ['excavator', 'รถขุด']],
    ['backhoe', ['backhoe', 'แบคโฮ', 'jcb']],
    ['pump', ['pump', 'เครื่องสูบน้ำ', 'สูบน้ำ']],
    ['generator', ['generator', 'เครื่องกำเนิดไฟฟ้า', 'เครื่องยนต์']],
    ['car', ['car', 'รถยนต์']],
  ]
  const found = entries.find(([, aliases]) => aliases.some(alias => normalized.includes(normalizeHeader(alias))))
  if (found) return found[0]
  if (kind === 'engine') return 'generator'
  return kind === 'vehicle' ? 'car' : 'other'
}

function mapFuelType(value) {
  const normalized = normalizeHeader(value)
  if (normalized.includes('ดีเซล') || normalized === 'diesel') return 'diesel'
  if (normalized.includes('เบนซิน') || normalized.includes('gasoline')) return 'gasoline'
  if (normalized.includes('lpg') || normalized.includes('แก๊ส')) return 'gas_lpg'
  if (normalized.includes('ไฟฟ้า') || normalized.includes('electric')) return 'electric'
  if (normalized.includes('หล่อลื่น') || normalized.includes('lubricant')) return 'lubricant'
  return normalized ? 'other' : 'diesel'
}

function mapStatus(value) {
  const normalized = normalizeHeader(value)
  if (VALID_STATUS.has(normalized)) return normalized
  if (normalized.includes('ซ่อม')) return 'under_repair'
  if (normalized.includes('ปลดระวาง')) return 'retired'
  if (normalized.includes('เลิกใช้') || normalized.includes('ไม่ใช้งาน')) return 'inactive'
  return 'active'
}

function mapBoolean(value) {
  const normalized = normalizeHeader(value)
  return ['1', 'true', 'yes', 'y', 'ใช่', 'รถกลาง', 'ใช้ร่วมกัน'].includes(normalized)
}

function mapNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function departmentIdFor(value, departments) {
  const normalized = normalizeHeader(value)
  if (!normalized) return null
  return departments.find(department => [department.name, department.short_name, department.code]
    .some(candidate => normalizeHeader(candidate) === normalized))?.id ?? null
}

function buildPreview(matrix, departments, existingAssets) {
  if (matrix.length < 2) throw new Error('ไฟล์ต้องมีแถวหัวตารางและข้อมูลอย่างน้อย 1 แถว')
  const headers = matrix[0]
  const indexes = Object.fromEntries(Object.keys(HEADER_ALIASES).map(key => [key, columnIndex(headers, key)]))
  if (indexes.name < 0) throw new Error('ไม่พบคอลัมน์ “ชื่อ” ในไฟล์')

  const existingKeys = new Set(existingAssets.flatMap(asset => [
    asset.license_plate ? `vehicle:${normalizeAssetIdentifier(asset.license_plate)}` : null,
    asset.asset_code ? `${asset.asset_kind ?? 'engine'}:${normalizeAssetIdentifier(asset.asset_code)}` : null,
  ].filter(Boolean)))
  const fileKeys = new Set()

  return matrix.slice(1).map((source, rowIndex) => {
    const value = key => indexes[key] >= 0 ? String(source[indexes[key]] ?? '').trim() : ''
    const rawType = mapVehicleType(value('vehicle_type'), 'vehicle')
    const assetKind = mapAssetKind(value('asset_kind'), rawType)
    const vehicleType = mapVehicleType(value('vehicle_type'), assetKind)
    const licensePlate = value('license_plate') || null
    const assetCode = value('asset_code') || null
    const isPool = mapBoolean(value('is_pool'))
    const departmentText = value('department')
    const departmentId = departmentIdFor(departmentText, departments)
    const meterInitial = mapNumber(value('odometer_initial'))
    const tankCapacity = mapNumber(value('tank_capacity'))
    const identifier = assetKind === 'vehicle' ? licensePlate : assetCode
    const duplicateKey = identifier ? `${assetKind}:${normalizeAssetIdentifier(identifier)}` : null
    const errors = []

    if (!value('name')) errors.push('ไม่ระบุชื่อ')
    if (assetKind === 'vehicle' && !licensePlate) errors.push('ยานพาหนะต้องมีทะเบียน')
    if (assetKind !== 'vehicle' && !assetCode) errors.push('เครื่องยนต์/ครุภัณฑ์ต้องมีรหัสครุภัณฑ์')
    if (!departmentId && !isPool) errors.push(departmentText ? 'ไม่พบกอง/หน่วยงาน' : 'ไม่ระบุกอง/หน่วยงาน')
    if (Number.isNaN(meterInitial) || (meterInitial ?? 0) < 0) errors.push('มิเตอร์เริ่มต้นไม่ถูกต้อง')
    if (Number.isNaN(tankCapacity) || (tankCapacity !== null && tankCapacity <= 0)) errors.push('ความจุถังไม่ถูกต้อง')
    if (duplicateKey && (existingKeys.has(duplicateKey) || fileKeys.has(duplicateKey))) errors.push('ข้อมูลซ้ำ')
    if (duplicateKey) fileKeys.add(duplicateKey)

    const payload = {
      name: value('name'),
      asset_kind: assetKind,
      license_plate: assetKind === 'vehicle' ? licensePlate : null,
      asset_code: assetCode,
      vehicle_type: vehicleType,
      department_id: departmentId,
      fuel_type: mapFuelType(value('fuel_type')),
      meter_unit: (
        value('meter_unit').toLocaleLowerCase().includes('hour')
        || value('meter_unit').includes('ชั่วโมง')
        || assetKind !== 'vehicle'
      ) ? 'hour' : 'km',
      odometer_initial: meterInitial ?? 0,
      brand: value('brand') || null,
      model: value('model') || null,
      tank_capacity: tankCapacity,
      is_pool: isPool,
      status: mapStatus(value('status')),
      notes: value('notes') || null,
    }

    return {
      line: rowIndex + 2,
      payload,
      errors,
      status: errors.length ? 'invalid' : 'ready',
    }
  })
}

function downloadTemplate() {
  const sample = [
    'รถกระบะส่วนกลาง', 'ยานพาหนะ', 'กข 1234 แพร่', '', 'รถกระบะ', 'สำนักปลัด',
    'ดีเซล', 'กม.', '0', 'Toyota', 'Hilux', '60', 'ใช่', 'ใช้งาน', '',
  ]
  const csv = `\uFEFF${[TEMPLATE_HEADERS, sample].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'fleet_asset_import_template.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function FleetImportModal({ tenant, depts, existingAssets, onImported, onClose }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')

  const summary = useMemo(() => ({
    total: preview.length,
    ready: preview.filter(row => row.status === 'ready').length,
    invalid: preview.filter(row => row.status === 'invalid').length,
    imported: preview.filter(row => row.status === 'imported').length,
    failed: preview.filter(row => row.status === 'failed').length,
  }), [preview])

  async function handleFile(nextFile) {
    setFile(nextFile ?? null)
    setPreview([])
    setMessage('')
    if (!nextFile) return
    if (!/\.(csv|xlsx)$/i.test(nextFile.name)) {
      setMessage('รองรับเฉพาะไฟล์ CSV และ XLSX')
      return
    }

    setLoading(true)
    try {
      const matrix = /\.xlsx$/i.test(nextFile.name)
        ? await parseXlsx(nextFile)
        : parseCsv((await nextFile.text()).replace(/^\uFEFF/, ''))
      setPreview(buildPreview(matrix, depts, existingAssets))
    } catch (error) {
      setMessage(error.message || 'อ่านไฟล์ไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  async function importRows() {
    const candidates = preview.filter(row => row.status === 'ready')
    if (!candidates.length || !tenant?.id) return
    setImporting(true)
    setMessage('')
    const batchId = crypto.randomUUID()
    const imported = []
    const next = [...preview]

    // ทำทีละรายการเพื่อรายงานแถวผิดได้ชัด และไม่ทำให้ทั้งไฟล์ล้มเพราะแถวเดียว
    for (const candidate of candidates) {
      const identifier = candidate.payload.license_plate || candidate.payload.asset_code
      const legacyKey = `${candidate.payload.asset_kind}:${normalizeAssetIdentifier(identifier)}`
      const { data, error } = await supabase.from('fleet_vehicles').insert({
        ...candidate.payload,
        municipality_id: tenant.id,
        legacy_source: 'google_apps_script_import',
        legacy_key: legacyKey,
        import_batch_id: batchId,
      }).select('*, departments(name,short_name)').single()

      const index = next.findIndex(row => row.line === candidate.line)
      if (error) {
        next[index] = { ...next[index], status: 'failed', errors: [error.message] }
      } else {
        next[index] = { ...next[index], status: 'imported', errors: [] }
        imported.push(data)
      }
      setPreview([...next])
    }

    if (imported.length) onImported(imported)
    setMessage(`นำเข้าสำเร็จ ${imported.length} รายการ${candidates.length > imported.length ? ` · ไม่สำเร็จ ${candidates.length - imported.length} รายการ` : ''}`)
    setImporting(false)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/50 md:p-4">
      <div className="bg-white w-full max-w-5xl max-h-[94vh] rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <FileSpreadsheet size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-gray-800">นำเข้าทะเบียนยานพาหนะ/เครื่องยนต์</h2>
            <p className="text-[11px] text-gray-400">ตรวจสอบแบบ Dry run ก่อนบันทึกจริงทุกครั้ง</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-gray-400 hover:bg-gray-100" aria-label="ปิด">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 p-4">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <label className="flex-1 cursor-pointer rounded-xl bg-white border border-blue-200 px-4 py-3 flex items-center gap-3 hover:border-blue-400">
                <Upload size={18} className="text-blue-600" />
                <span className="text-sm font-semibold text-gray-700 truncate">
                  {file?.name || 'เลือกไฟล์ CSV หรือ XLSX (Worksheet แรก)'}
                </span>
                <input type="file" accept=".csv,.xlsx" className="hidden" onChange={event => handleFile(event.target.files?.[0])} />
              </label>
              <button onClick={downloadTemplate}
                className="px-4 py-3 rounded-xl border border-emerald-200 bg-white text-emerald-700 text-xs font-bold flex items-center justify-center gap-2">
                <Download size={15} /> ดาวน์โหลดแบบฟอร์มตัวอย่าง
              </button>
            </div>
            <p className="text-[10px] text-blue-500 mt-2">
              Excel รุ่นเก่า .xls ให้บันทึกเป็น .xlsx หรือ .csv ก่อน · ระบบไม่นำเข้ารายการที่ซ้ำหรือไม่พบกอง
            </p>
          </div>

          {loading && <div className="text-center py-10 text-sm text-gray-400">กำลังตรวจไฟล์...</div>}
          {message && (
            <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${summary.failed ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
              {message}
            </div>
          )}

          {!!preview.length && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  ['ทั้งหมด', summary.total, 'bg-slate-50 text-slate-700'],
                  ['พร้อมนำเข้า', summary.ready, 'bg-emerald-50 text-emerald-700'],
                  ['ต้องแก้ไข', summary.invalid, 'bg-red-50 text-red-700'],
                  ['นำเข้าแล้ว', summary.imported, 'bg-blue-50 text-blue-700'],
                ].map(([label, value, color]) => (
                  <div key={label} className={`rounded-xl p-3 ${color}`}>
                    <p className="text-lg font-black">{value}</p>
                    <p className="text-[10px] font-semibold">{label}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full text-xs border-collapse min-w-[760px]">
                  <thead className="bg-slate-800 text-white">
                    <tr>
                      {['แถว', 'ชื่อ', 'ชนิด', 'ทะเบียน/รหัส', 'กอง', 'สถานะตรวจสอบ'].map(header => (
                        <th key={header} className="px-3 py-2 text-left font-bold">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.map(row => {
                      const department = depts.find(item => item.id === row.payload.department_id)
                      return (
                        <tr key={row.line} className={row.status === 'invalid' || row.status === 'failed' ? 'bg-red-50/60' : ''}>
                          <td className="px-3 py-2 text-gray-400">{row.line}</td>
                          <td className="px-3 py-2 font-semibold text-gray-800">{row.payload.name || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{ASSET_KIND_LABEL[row.payload.asset_kind]}</td>
                          <td className="px-3 py-2 text-gray-600">{assetIdentifier(row.payload)}</td>
                          <td className="px-3 py-2 text-gray-600">{row.payload.is_pool ? 'ทรัพย์สินส่วนกลาง' : department?.name || '—'}</td>
                          <td className="px-3 py-2">
                            {row.status === 'ready' && <span className="text-emerald-600 font-bold">พร้อมนำเข้า</span>}
                            {row.status === 'imported' && <span className="text-blue-600 font-bold">นำเข้าแล้ว</span>}
                            {row.status === 'invalid' && <span className="text-red-600">{row.errors.join(', ')}</span>}
                            {row.status === 'failed' && <span className="text-red-600">{row.errors.join(', ')}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-gray-100 p-4 flex items-center justify-end gap-2 bg-white">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600">
            ปิด
          </button>
          <button onClick={importRows} disabled={!summary.ready || importing}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-40 flex items-center gap-2">
            <Upload size={15} /> {importing ? 'กำลังนำเข้า...' : `นำเข้า ${summary.ready} รายการ`}
          </button>
        </div>
      </div>
    </div>
  )
}
