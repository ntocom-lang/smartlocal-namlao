import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import {
  Upload, FileText, CheckCircle2, AlertCircle, Loader2, X, MapPin, Route, Trash2, Layers, Filter,
  ChevronRight, ChevronDown, Hexagon, ShieldAlert, Copy, History, Undo2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { compressImage } from '../../lib/imageUtils'
import { uploadFile } from '../../lib/driveStorage'
import { driveFolderPath, DRIVE_MODULES } from '../../lib/driveFolders'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { mergeOptions, tidyName } from '../../lib/dataCenterPicker'
import { fetchAssignableStaff } from '../../lib/staffRoster'
import {
  parseGisFile, groupByFolder, folderKeyOf, suggestMapping, buildCatalog, resolvePair, markDuplicates,
  looksPersonalColumn, buildDescription, DEFAULT_ROUTE_COLOR, MAX_IMPORT_ITEMS, MAX_PHOTOS_PER_IMPORT,
} from '../../lib/gisImport'

// ตัวอย่างตั้งต้น — ใช้เป็นคำแนะนำในช่องพิมพ์เท่านั้น (ข้อมูลจริงในระบบมาก่อนเสมอ)
const SEED_GROUPS = [
  'สาธารณสุข', 'สถานที่สำคัญ', 'สถานประกอบการ', 'การจัดการขยะ',
  'สถานศึกษา', 'โครงสร้างพื้นฐาน', 'สถานที่หลบภัย', 'พื้นที่สีเขียว'
]

const ACCEPT = '.kml,.kmz,.geojson,.json,.gpx,.csv,.txt,.zip,.shp'
const BATCH_SIZE = 50
const PHOTO_ROW_CONCURRENCY = 3 // อัปโหลดพร้อมกันกี่ "แถว" (ไม่ใช่กี่รูป) — รูปในแถวเดียวกันทำทีละรูป กัน edge function ถูกยิงถี่เกิน
const MAX_ROWS_SHOWN = 200 // แสดงรายการข้างในโฟลเดอร์ไม่เกินนี้ต่อโฟลเดอร์ (ไฟล์หลายพันจุดทำ DOM หนักบนมือถือ)

const inputCls = 'w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-800 focus:ring-2 focus:ring-blue-200 focus:outline-none'

function countsText(c) {
  return [c.point && `${c.point} จุด`, c.line && `${c.line} เส้น`, c.polygon && `${c.polygon} พื้นที่`].filter(Boolean).join(' · ')
}

function ShapeBadge({ item }) {
  if (item.shape === 'line') {
    return (
      <span className="shrink-0 text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded-md flex items-center gap-1">
        <Route size={10} /> เส้น ({item.route_points.length} จุด)
      </span>
    )
  }
  if (item.shape === 'polygon') {
    return (
      <span className="shrink-0 text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded-md flex items-center gap-1">
        <Hexagon size={10} /> พื้นที่
      </span>
    )
  }
  return (
    <span className="shrink-0 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-md flex items-center gap-1">
      <MapPin size={10} /> จุด
    </span>
  )
}

// ── ชุดที่นำเข้า / ยกเลิกทั้งชุด (เฟส 2) ─────────────────────────────────────────
// ยกเลิกได้เฉพาะ 3 role นี้ (ฐานข้อมูลตรวจซ้ำอีกชั้น: หัวหน้ากองยกเลิกได้เฉพาะชุดที่ทุกแถวเป็นของกองตัวเอง)
// staff/technician เห็นรายการชุดได้แต่ไม่มีปุ่มยกเลิก
const CANCEL_ROLES = ['superadmin', 'admin', 'officer']
const BATCH_LIST_ROLES = [...CANCEL_ROLES, 'staff', 'technician']

// RPC ยังไม่มีในฐาน (ก่อนรัน SQL เฟส 2) — PostgREST ตอบ PGRST202 / Postgres ตอบ 42883 → ซ่อนส่วนนี้เงียบๆ ไม่ขึ้น error แดง
function isMissingRpc(err) {
  if (!err) return false
  return err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(err.message || '')
}

function formatBatchTime(iso) {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return '—'
  const day = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
  return `${day} เวลา ${time} น.`
}

function confirmCancelBatch(count) {
  return window.confirm(
    `ยกเลิกการนำเข้าชุดนี้? จะลบ ${count} รายการที่นำเข้าในชุดนี้ออกจากศูนย์ข้อมูลดิจิทัลทั้งชุด\n\n`
    + 'ย้อนกลับไม่ได้ (รูปที่อัปโหลดไปแล้วไม่ถูกลบ)',
  )
}

// คืน { count } เมื่อสำเร็จ หรือ { error } เป็นข้อความพร้อมแสดง — เซิร์ฟเวอร์ลบทั้งชุดหรือไม่ลบเลย (error.message เป็นภาษาไทยจากเซิร์ฟเวอร์)
async function cancelImportBatch(batchId) {
  const { data, error } = await supabase.rpc('data_center_cancel_import_batch', { _batch_id: batchId })
  if (error) {
    console.error('data_center_cancel_import_batch:', error.message)
    return { error: isMissingRpc(error) ? 'ฐานข้อมูลยังไม่รองรับการยกเลิกทั้งชุด' : (error.message || 'ยกเลิกไม่สำเร็จ') }
  }
  return { count: Number(data) || 0 }
}

// รายการชุดที่นำเข้าล่าสุด (พับไว้ก่อน) — ไม่ขึ้นเลยถ้า RPC ยังไม่มี หรือยังไม่เคยนำเข้า
function ImportBatchesPanel({ tenant, canCancel, onChanged }) {
  const [rows, setRows] = useState(null) // null = ยังโหลดไม่เสร็จ
  const [unavailable, setUnavailable] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [open, setOpen] = useState(false)
  const [names, setNames] = useState(null) // Map uuid → ชื่อ (โหลดตอนกางครั้งแรก)
  const [busyId, setBusyId] = useState(null)
  const [msg, setMsg] = useState(null) // { ok, text }

  const tenantId = tenant?.id
  const [reloadKey, setReloadKey] = useState(0) // เพิ่มค่า = โหลดรายการชุดใหม่ (หลังยกเลิก)

  useEffect(() => {
    if (!tenantId) return undefined
    let active = true
    supabase.rpc('data_center_import_batches', { _municipality_id: tenantId })
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          if (isMissingRpc(error)) { setUnavailable(true); return }
          console.error('data_center_import_batches:', error.message)
          setLoadError(error.message || 'โหลดรายการไม่สำเร็จ')
          return
        }
        setLoadError(null)
        setRows(data ?? [])
      })
    return () => { active = false }
  }, [tenantId, reloadKey])

  // ชื่อผู้นำเข้า: ใช้ทะเบียนเจ้าหน้าที่เดิม (fetchAssignableStaff) ไม่ query profiles เพิ่ม — ผู้ที่ไม่อยู่ในทะเบียน (เช่น Super Admin) แสดง "เจ้าหน้าที่"
  useEffect(() => {
    if (!open || names || !tenantId) return undefined
    let active = true
    fetchAssignableStaff(tenantId)
      .then(people => { if (active) setNames(new Map(people.map(p => [p.id, p.full_name]))) })
      .catch(() => { if (active) setNames(new Map()) })
    return () => { active = false }
  }, [open, names, tenantId])

  if (unavailable) return null
  if (rows === null && !loadError) return null
  if (rows !== null && rows.length === 0 && !loadError && !msg) return null

  async function handleCancel(b) {
    if (busyId) return
    if (!confirmCancelBatch(b.item_count)) return
    setBusyId(b.batch_id)
    setMsg(null)
    const r = await cancelImportBatch(b.batch_id)
    setBusyId(null)
    if (r.error) { setMsg({ ok: false, text: r.error }); return }
    setMsg({ ok: true, text: `ยกเลิกการนำเข้าแล้ว ลบ ${r.count} รายการ` })
    onChanged?.()
    setReloadKey(k => k + 1)
  }

  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full px-3.5 py-2.5 bg-gray-50 flex items-center justify-between gap-2 text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors"
      >
        <span className="flex items-center gap-1.5"><History size={14} className="text-blue-500" /> ชุดที่นำเข้าล่าสุด{rows ? ` (${rows.length})` : ''}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {open && (
        <div className="border-t border-gray-200 divide-y divide-gray-100">
          {loadError && (
            <p className="px-3.5 py-2 text-xs text-red-600 flex items-start gap-1.5">
              <AlertCircle size={13} className="shrink-0 mt-0.5" /> {loadError}
            </p>
          )}
          {msg && (
            <p className={`px-3.5 py-2 text-xs flex items-start gap-1.5 ${msg.ok ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
              {msg.ok ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> : <AlertCircle size={13} className="shrink-0 mt-0.5" />}
              <span className="break-words">{msg.text}</span>
            </p>
          )}
          {!canCancel && (rows?.length ?? 0) > 0 && (
            <p className="px-3.5 py-2 text-[11px] text-gray-500">ต้องการยกเลิกชุดที่นำเข้า ให้หัวหน้ากองหรือผู้ดูแลระบบยกเลิกให้</p>
          )}
          {(rows ?? []).map(b => {
            const who = (b.created_by && names?.get(b.created_by)) || 'เจ้าหน้าที่'
            const sample = Array.isArray(b.sample_names) ? b.sample_names.filter(Boolean) : []
            const counts = countsText({ point: b.point_count, line: b.line_count, polygon: b.polygon_count })
            return (
              <div key={b.batch_id} className="px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-semibold text-gray-800">
                    {formatBatchTime(b.imported_at)} · {who}
                  </p>
                  <p className="text-gray-600">
                    {b.item_count} รายการ{counts && ` (${counts})`}
                  </p>
                  {sample.length > 0 && (
                    <p className="text-[11px] text-gray-400 truncate">เช่น {sample.join(' · ')}</p>
                  )}
                </div>
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => handleCancel(b)}
                    disabled={busyId !== null}
                    className="shrink-0 px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 text-[11px] font-bold hover:bg-red-50 disabled:opacity-50 flex items-center gap-1 transition-colors"
                  >
                    {busyId === b.batch_id ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
                    ยกเลิกชุดนี้
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main Import Modal Component ───────────────────────────────────────────────

export default function DataCenterImportModal({ tenant, profile, summary, onClose, onImportComplete }) {
  const fileInputRef = useRef(null)
  const existingRef = useRef(null) // รายการเดิมของ tenant (ดึงครั้งเดียวต่อการเปิดโมดัล)
  // เลขชุดนำเข้า (import_batch_id) — สร้างตอนกดนำเข้า ถ้ายังไม่มี · ล้มกลางทางแล้วกดซ้ำ = ใช้เลขเดิม (ทำต่อชุดเดิม ไม่แตกเป็นสองชุด)
  // สำเร็จครบแล้วย้ายไป lastBatchId (ไว้ให้ปุ่มยกเลิกทั้งชุด) แล้วล้าง ref · เปลี่ยนไฟล์/เริ่มใหม่ = ล้าง
  const batchIdRef = useRef(null)

  const [file, setFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [dupNotice, setDupNotice] = useState(null)

  const [result, setResult] = useState(null) // { items (พร้อม duplicate), skipped, columns, warnings }
  const [selected, setSelected] = useState({}) // key รายการ → ติ๊กนำเข้า
  const [overrides, setOverrides] = useState({}) // key โฟลเดอร์ → { group?, category? } ที่เจ้าหน้าที่แก้เอง
  const [expanded, setExpanded] = useState({})
  const [defaults, setDefaults] = useState({ group: 'โครงสร้างพื้นฐาน', category: 'พิกัดนำเข้า' })
  const [keptColumns, setKeptColumns] = useState([])
  const [pdpaConfirmed, setPdpaConfirmed] = useState(false)

  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [insertedSoFar, setInsertedSoFar] = useState(0)
  const [importError, setImportError] = useState(null)
  const [successRows, setSuccessRows] = useState(null) // [{ group, category, count }]
  const [importPhotos, setImportPhotos] = useState(false) // ค่าเริ่มต้นไม่ติ๊ก: รูปขึ้นแผนที่สาธารณะ ต้องให้คนตัดสินใจเอง
  const [photoProgress, setPhotoProgress] = useState(null) // { done, total } ตอนอัปโหลดรูป
  const [photoResult, setPhotoResult] = useState(null) // { ok, fail } หลังอัปโหลดรูปจบ
  const [lastBatchId, setLastBatchId] = useState(null) // ชุดที่เพิ่งนำเข้าสำเร็จ — ไว้ยกเลิกทั้งชุดจากหน้าผลสำเร็จ
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelResult, setCancelResult] = useState(null) // { ok, text } ผลการยกเลิกจากหน้าผลสำเร็จ
  const [listChanged, setListChanged] = useState(false) // ยกเลิกชุดจากรายการแล้ว → ตอนปิดโมดัลต้องรีเฟรชแผนที่/รายการ

  const canCancelBatch = CANCEL_ROLES.includes(profile?.role)
  const canListBatches = BATCH_LIST_ROLES.includes(profile?.role)

  const items = useMemo(() => result?.items ?? [], [result])
  const catalog = useMemo(() => buildCatalog(summary, SEED_GROUPS), [summary])
  const folders = useMemo(() => groupByFolder(items), [items])
  const suggestions = useMemo(
    () => suggestMapping(folders, summary, SEED_GROUPS, defaults),
    [folders, summary, defaults],
  )

  // ค่าที่ใช้จริงของแต่ละโฟลเดอร์ = ที่เจ้าหน้าที่แก้ ถ้าไม่แก้ใช้ที่ระบบเสนอ (เปลี่ยนค่าเริ่มต้น แถวที่ไม่ได้แก้ตามไปด้วย)
  const rows = useMemo(() => folders.map(f => {
    const ov = overrides[f.key] ?? {}
    const sug = suggestions[f.key]
    const groupText = ov.group ?? sug?.group ?? ''
    const categoryText = ov.category ?? sug?.category ?? ''
    return { folder: f, groupText, categoryText, resolved: resolvePair(catalog, groupText, categoryText) }
  }), [folders, overrides, suggestions, catalog])
  const resolvedByKey = useMemo(() => Object.fromEntries(rows.map(r => [r.folder.key, r.resolved])), [rows])

  const stats = useMemo(() => {
    const s = { point: 0, line: 0, polygon: 0, duplicate: 0 }
    for (const it of items) { s[it.shape] += 1; if (it.duplicate) s.duplicate += 1 }
    return s
  }, [items])

  const selectedItems = useMemo(() => items.filter(i => selected[i.key]), [items, selected])
  const selectedCount = selectedItems.length

  // รูปของรายการที่ "ติ๊กไว้" เท่านั้น — เพดานคิดจากสิ่งที่จะอัปโหลดจริงในรอบนี้
  const photoTotal = result?.photos?.total ?? 0
  const selectedPhotoCount = useMemo(
    () => selectedItems.reduce((n, i) => n + (i.photoRefs?.length ?? 0), 0),
    [selectedItems],
  )
  const overPhotoLimit = importPhotos && selectedPhotoCount > MAX_PHOTOS_PER_IMPORT

  // โฟลเดอร์ที่มีรายการถูกเลือกแต่ยังไม่มีกลุ่ม/ประเภท → ปิดปุ่มนำเข้า (ฐานข้อมูลไม่รับค่าว่าง)
  const missingFolders = useMemo(() => rows.filter(r =>
    r.folder.itemKeys.some(k => selected[k]) && (!r.resolved.group || !r.resolved.category),
  ), [rows, selected])

  const hasColumns = (result?.columns?.length ?? 0) > 0

  const reset = useCallback(() => {
    setFile(null); setResult(null); setSelected({}); setOverrides({}); setExpanded({})
    setKeptColumns([]); setPdpaConfirmed(false); setParseError(null); setDupNotice(null)
    setImportError(null); setInsertedSoFar(0); setProgress(0)
    setImportPhotos(false); setPhotoProgress(null); setPhotoResult(null)
    batchIdRef.current = null; setLastBatchId(null); setCancelResult(null)
  }, [])

  // กำลังนำเข้า (รวมอัปโหลดรูป) แล้วปิดแท็บ = ค้างครึ่งทาง: รายการลงฐานแล้วแต่รูปไม่ครบ จึงเตือนก่อนปิด
  useEffect(() => {
    if (!importing) return undefined
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [importing])

  async function loadExisting() {
    if (existingRef.current) return existingRef.current
    if (!tenant?.id) return { rows: null, warning: 'ไม่พบข้อมูลหน่วยงาน จึงข้ามการตรวจรายการซ้ำ' }
    try {
      // อ่านอย่างเดียว — ต้อง .order('id') ให้ไล่หลายหน้าแล้วไม่ตกหล่น/ซ้ำ (ดู fetchAllRows)
      const { data, error, truncated } = await fetchAllRows(() => supabase
        .from('data_center_entries')
        .select('id,name,latitude,longitude')
        .eq('municipality_id', tenant.id)
        .order('id'))
      if (error) throw error
      const out = {
        rows: data ?? [],
        warning: truncated ? 'รายการเดิมในระบบมากเกินกว่าจะตรวจได้ครบ การตรวจรายการซ้ำอาจไม่ครบ' : null,
      }
      existingRef.current = out
      return out
    } catch (err) {
      console.error('Error loading existing data center entries:', err)
      return { rows: null, warning: 'โหลดรายการเดิมเพื่อตรวจรายการซ้ำไม่สำเร็จ — ข้ามการตรวจซ้ำ กรุณาตรวจสอบชื่อที่ซ้ำกับของเดิมด้วยตนเอง' }
    }
  }

  async function processFile(selectedFile) {
    if (!selectedFile) return
    setFile(selectedFile)
    setParsing(true)
    setParseError(null)
    setResult(null)
    setImportError(null)
    setInsertedSoFar(0)
    batchIdRef.current = null // ไฟล์ใหม่ = ชุดใหม่
    setLastBatchId(null)
    setCancelResult(null)

    try {
      const parsed = await parseGisFile(selectedFile)
      if (parsed.items.length === 0) {
        const sk = parsed.skipped
        const why = [
          sk.outsideThailand && `พิกัดอยู่นอกประเทศไทย ${sk.outsideThailand}`,
          sk.invalidCoord && `พิกัดไม่ถูกต้อง ${sk.invalidCoord}`,
          sk.overlay && `ภาพซ้อน ${sk.overlay}`,
          sk.model && `โมเดล 3 มิติ ${sk.model}`,
          sk.networkLink && `NetworkLink ${sk.networkLink}`,
          sk.empty && `ไม่มีพิกัด ${sk.empty}`,
        ].filter(Boolean).join(', ')
        throw new Error(`ไม่พบพิกัดที่นำเข้าได้ในไฟล์นี้${why ? ` (ข้าม: ${why})` : ''}${parsed.warnings.length ? ` — ${parsed.warnings.join(' ')}` : ''}`)
      }

      const existing = await loadExisting()
      const withDup = existing.rows ? markDuplicates(parsed.items, existing.rows) : parsed.items.map(i => ({ ...i, duplicate: false }))
      setDupNotice(existing.warning)
      setResult({ ...parsed, items: withDup })
      // รายการซ้ำไม่ติ๊กไว้ก่อน — กันนำเข้าซ้ำโดยไม่รู้ตัว (เจ้าหน้าที่ติ๊กเองได้ถ้าตั้งใจ)
      setSelected(Object.fromEntries(withDup.map(i => [i.key, !i.duplicate])))
      setOverrides({})
      setExpanded({})
      // คอลัมน์ที่ชื่อบ่งว่าเป็นข้อมูลส่วนบุคคลไม่เก็บไว้ก่อน (PDPA) — ข้อมูลที่นำเข้าขึ้นแผนที่สาธารณะทันที
      setKeptColumns(parsed.columns.filter(c => !looksPersonalColumn(c)))
      setPdpaConfirmed(false)
      setImportPhotos(false)
      setPhotoProgress(null)
      setPhotoResult(null)
    } catch (err) {
      console.error('Error parsing file:', err)
      setParseError(err.message || 'ไม่สามารถอ่านข้อมูลในไฟล์ได้')
    } finally {
      setParsing(false)
    }
  }

  function handleFileSelected(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    processFile(f)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    if (parsing) return
    processFile(e.dataTransfer?.files?.[0])
  }

  function toggleItem(key) {
    setSelected(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // ติ๊กทั้งโฟลเดอร์ = เลือกทุกรายการที่ไม่ซ้ำ / เอาออกทั้งหมด
  function toggleFolder(folder, on) {
    setSelected(prev => {
      const next = { ...prev }
      for (const k of folder.itemKeys) {
        const it = items.find(i => i.key === k)
        next[k] = on ? !it?.duplicate : false
      }
      return next
    })
  }

  function setOverride(folderKey, patch) {
    setOverrides(prev => ({ ...prev, [folderKey]: { ...prev[folderKey], ...patch } }))
  }

  function toggleColumn(col) {
    setKeptColumns(prev => (prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]))
  }

  async function executeBatchImport() {
    if (selectedCount === 0 || selectedCount > MAX_IMPORT_ITEMS || overPhotoLimit || !tenant?.id || !pdpaConfirmed || missingFolders.length > 0) return

    const toInsert = items
      .filter(i => selected[i.key])
      .map(it => {
        const r = resolvedByKey[folderKeyOf(it)]
        return {
          key: it.key,
          photoRefs: importPhotos ? (it.photoRefs ?? []) : [],
          group: r.group,
          category: r.category,
          row: {
            // สร้าง id เองฝั่งหน้าเว็บ เพื่อจับคู่ "แถวที่ลงฐาน" กับ "รูปของแถวนั้น" ได้แน่นอน
            // ไม่พึ่งลำดับผล RETURNING (insert หลายแถวไม่รับประกันว่าลำดับผลตรงกับลำดับที่ส่ง)
            id: crypto.randomUUID(),
            municipality_id: tenant.id,
            // ค่าที่จับคู่ของเดิมได้เป็น "ค่าดิบจากฐาน" แล้ว (resolvePair) — ห้าม tidyName ทับ ไม่งั้นกลายเป็นหมวดใหม่เงียบๆ
            group_name: r.groupIsNew ? tidyName(r.group) : r.group,
            category: r.categoryIsNew ? tidyName(r.category) : r.category,
            name: tidyName(it.name),
            description: buildDescription(it.description, it.attributes, keptColumns) || null,
            latitude: it.latitude,
            longitude: it.longitude,
            route_points: it.route_points,
            route_color: it.route_points ? (it.route_color || DEFAULT_ROUTE_COLOR) : null,
            shape: it.shape, // 'point' | 'line' | 'polygon' — พื้นที่ต้องลงเป็น polygon ไม่กลายเป็นเส้น
            status: 'active',
            created_by: profile?.id ?? null,
            department_id: profile?.department_id ?? null,
          },
        }
      })

    // ล้มกลางทางแล้วกดซ้ำ ใช้เลขเดิม — รายการที่ลงไปแล้วกับที่ลงต่อรอบหลังอยู่ชุดเดียวกัน ยกเลิกทั้งชุดได้ครบ
    if (!batchIdRef.current) batchIdRef.current = crypto.randomUUID()
    const batchId = batchIdRef.current
    for (const t of toInsert) t.row.import_batch_id = batchId

    setImporting(true)
    setProgress(0)
    setImportError(null)
    setPhotoProgress(null)
    setPhotoResult(null)

    let inserted = 0
    const doneKeys = []
    const insertedRows = [] // แถวที่ลงฐานสำเร็จแล้ว (ไว้ใช้ในเฟสรูป)
    try {
      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE)
        const { error } = await supabase.from('data_center_entries').insert(batch.map(b => b.row))
        if (error) throw error
        inserted += batch.length
        doneKeys.push(...batch.map(b => b.key))
        insertedRows.push(...batch)
        setProgress(Math.round((inserted / toInsert.length) * 100))
      }

      // เฟสสอง: อัปโหลดรูป "หลัง" insert ครบทุกแถว — ถ้า insert ล้มกลางทางจะไม่เริ่มเฟสนี้ (กันรูปลอยไม่มีเจ้าของ)
      // ห่อ try แยก: ความผิดพลาดของรูปห้ามไปถูกรายงานเป็น "insert ล้ม" (รายการลงฐานครบแล้วจริง)
      const withPhotos = insertedRows.filter(b => b.photoRefs.length > 0)
      if (withPhotos.length > 0 && result?.readPhoto) {
        try {
          setPhotoResult(await uploadPhotosForRows(withPhotos))
        } catch (photoErr) {
          console.error('Error uploading imported photos:', photoErr)
          setPhotoResult({ ok: 0, fail: withPhotos.reduce((n, b) => n + b.photoRefs.length, 0) })
        }
      }

      const tally = new Map()
      for (const t of toInsert) {
        const k = `${t.group}\u0000${t.category}`
        tally.set(k, { group: t.group, category: t.category, count: (tally.get(k)?.count ?? 0) + 1 })
      }
      setInsertedSoFar(prev => prev + inserted)
      setLastBatchId(batchId)
      batchIdRef.current = null
      setSuccessRows(Array.from(tally.values()).sort((a, b) => b.count - a.count))
    } catch (err) {
      console.error('Error batch inserting data center entries:', err)
      // บันทึกไปแล้วบางชุด: เอาออกจากรายการที่ติ๊ก กดนำเข้าอีกครั้งจะทำต่อเฉพาะที่เหลือ ไม่ซ้ำของที่ลงแล้ว
      // แถวที่ลงไปแล้วในรอบนี้จะไม่ได้รูป (ไม่เริ่มเฟสรูป) — นับจำนวนไว้บอกตรงๆ ในกล่องแจ้งผล
      const photosPending = insertedRows.reduce((n, b) => n + b.photoRefs.length, 0)
      if (doneKeys.length > 0) {
        setSelected(prev => {
          const next = { ...prev }
          for (const k of doneKeys) next[k] = false
          return next
        })
        setInsertedSoFar(prev => prev + inserted)
      }
      setImportError({
        inserted,
        total: toInsert.length,
        message: err?.message || 'ไม่ทราบสาเหตุ',
        photosPending,
      })
    } finally {
      setImporting(false)
      setPhotoProgress(null)
    }
  }

  // อัปโหลดรูปของแต่ละแถวที่ลงฐานแล้ว — ทำพร้อมกัน PHOTO_ROW_CONCURRENCY แถว
  // รูปที่ล้มนับแล้วทำต่อ ไม่ล้มทั้งงาน (รายการลงฐานไปแล้ว ขาดแค่รูป เพิ่มเองได้ที่ปุ่มแก้ไขรายการ)
  // โฟลเดอร์ Drive ใช้ชื่อหมวด/ชื่อสถานที่ "ตัวที่ลงฐานจริง" ให้ตรงกับที่ฟอร์มเพิ่มข้อมูลเดิมจัดไว้
  async function uploadPhotosForRows(rowsWithPhotos) {
    const total = rowsWithPhotos.reduce((n, b) => n + b.photoRefs.length, 0)
    let done = 0
    let ok = 0
    let fail = 0
    setPhotoProgress({ done: 0, total })

    const tick = () => { done += 1; setPhotoProgress({ done, total }) }

    async function uploadRow(b) {
      const urls = []
      for (const ref of b.photoRefs) {
        try {
          const raw = await result.readPhoto(ref)
          const file = await compressImage(raw, 1600)
          const ext = file.name?.split('.').pop() || 'jpg'
          const { url, error } = await uploadFile('complaint-attachments', file, {
            subject: `data-center/${b.row.id}`,
            folder: driveFolderPath(DRIVE_MODULES.dataCenter, b.row.category, b.row.name),
            filename: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
            municipality: tenant?.slug,
          })
          if (!error && url) urls.push(url)
          else fail += 1
        } catch (err) {
          console.error('Error uploading imported photo:', err)
          fail += 1
        }
        tick()
      }
      if (urls.length === 0) return
      const { error } = await supabase.from('data_center_entries').update({ photo_urls: urls }).eq('id', b.row.id)
      if (error) {
        console.error('Error saving photo_urls:', error)
        fail += urls.length
      } else {
        ok += urls.length
      }
    }

    let next = 0
    const worker = async () => {
      while (next < rowsWithPhotos.length) {
        const mine = rowsWithPhotos[next]
        next += 1
        await uploadRow(mine)
      }
    }
    await Promise.all(Array.from({ length: Math.min(PHOTO_ROW_CONCURRENCY, rowsWithPhotos.length) }, worker))
    return { ok, fail }
  }

  // ยกเลิกชุดที่เพิ่งนำเข้าจากหน้าผลสำเร็จ — ลบทั้งชุดหรือไม่ลบเลย (เซิร์ฟเวอร์ตรวจสิทธิ์ซ้ำ) แล้วให้ปุ่ม "เสร็จ" รีเฟรชหน้าตามเดิม
  async function handleCancelLastBatch() {
    if (!lastBatchId || cancelBusy) return
    if (!confirmCancelBatch(insertedSoFar)) return
    setCancelBusy(true)
    setCancelResult(null)
    const r = await cancelImportBatch(lastBatchId)
    setCancelBusy(false)
    if (r.error) { setCancelResult({ ok: false, text: r.error }); return }
    setCancelResult({ ok: true, text: `ยกเลิกการนำเข้าชุดนี้แล้ว ลบ ${r.count} รายการ` })
    setLastBatchId(null)
  }

  // ปิดทั้งที่มีบางรายการลงฐานไปแล้ว ต้องให้หน้ารายการรีเฟรช (ใช้ onImportComplete) ไม่งั้นรายการที่เพิ่มไม่โผล่
  function handleClose() {
    if (insertedSoFar > 0 || listChanged) onImportComplete?.()
    else onClose?.()
  }

  const showTable = !!result && successRows === null

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400 shrink-0">
              <Upload size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-base leading-tight">นำเข้าพิกัด GIS / Google Earth</h2>
              <p className="text-xs text-slate-400 truncate">รองรับ KML, KMZ, GeoJSON, GPX, CSV และ Shapefile (.zip)</p>
            </div>
          </div>
          <button onClick={handleClose} disabled={importing} className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body Area */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">

          {/* Step 1: File Drop Zone */}
          {!result && successRows === null && (
            <div className="space-y-4">
              <div
                onClick={() => !parsing && fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center group ${dragOver ? 'border-blue-500 bg-blue-100/60' : 'border-blue-200 hover:border-blue-500 bg-blue-50/40 hover:bg-blue-50'}`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelected}
                  accept={ACCEPT}
                  className="hidden"
                />
                {parsing ? (
                  <div className="flex flex-col items-center py-4">
                    <Loader2 size={36} className="animate-spin text-blue-600 mb-3" />
                    <p className="font-bold text-gray-700 text-sm">กำลังอ่านไฟล์พิกัดและตรวจรายการซ้ำ...</p>
                    <p className="text-xs text-gray-400 mt-1 break-all">{file?.name}</p>
                  </div>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-2xl bg-white border border-blue-100 shadow-sm flex items-center justify-center text-blue-600 mb-3 group-hover:scale-110 transition-transform">
                      <FileText size={28} />
                    </div>
                    <p className="font-bold text-gray-800 text-base">ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</p>
                    <p className="text-xs text-gray-500 mt-1 max-w-md">
                      <span className="font-semibold text-blue-600">.KML / .KMZ (Google Earth)</span>, <span className="font-semibold text-emerald-600">.GeoJSON</span>, <span className="font-semibold text-teal-600">.GPX</span>, <span className="font-semibold text-orange-600">.CSV</span> หรือ <span className="font-semibold text-purple-600">Shapefile (.zip ที่มี .shp .dbf .prj)</span>
                    </p>
                  </>
                )}
              </div>

              {parseError && (
                <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">เกิดข้อผิดพลาดในการอ่านไฟล์</p>
                    <p className="mt-0.5">{parseError}</p>
                  </div>
                </div>
              )}

              {/* Guidelines */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-2 text-xs text-slate-600">
                <p className="font-bold text-slate-800 flex items-center gap-1.5 text-sm">
                  <Layers size={15} className="text-blue-500" /> ข้อแนะนำโครงสร้างไฟล์
                </p>
                <ul className="list-disc pl-4 space-y-1 text-slate-600 leading-relaxed">
                  <li>
                    <strong>จัดโฟลเดอร์ใน Google Earth 2 ชั้น ระบบจัดหมวดให้เอง</strong>: โฟลเดอร์ชั้นบนสุด = กลุ่มหลัก, โฟลเดอร์ในสุด = ประเภทย่อย
                    <div className="mt-1 font-mono text-[11px] bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 leading-relaxed">
                      📁 สาธารณสุข<br />
                      &nbsp;&nbsp;└ 📁 รพ.สต.<br />
                      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└ 📍 จุด
                    </div>
                  </li>
                  <li>โฟลเดอร์ชั้นเดียว = ประเภทย่อย (ถ้าประเภทนี้มีในระบบอยู่แล้ว ระบบเติมกลุ่มให้) · ไม่มีโฟลเดอร์ = ใช้ค่าเริ่มต้นที่กำหนดในขั้นถัดไป</li>
                  <li>ระบบอ่านจุด (Point) เส้น (LineString / gx:Track) และพื้นที่ (Polygon) พร้อมสีของเส้น — พื้นที่แสดงบนแผนที่เป็นพื้นที่ระบายสี</li>
                  <li>ข้ามภาพซ้อน (GroundOverlay), โมเดล 3 มิติ และ NetworkLink โดยบอกจำนวนที่ข้ามให้ทราบ · รับเฉพาะพิกัดในประเทศไทย</li>
                  <li><strong>CSV</strong>: หัวตารางต้องมี <code>name</code> (ชื่อ), <code>lat</code> (ละติจูด), <code>lng</code> (ลองจิจูด) · ใช้คอลัมน์ <code>group</code> (กลุ่ม) และ <code>category</code> (ประเภท) จัดหมวดได้</li>
                  <li><strong>Shapefile</strong>: บีบ .shp + .dbf + .prj เป็นไฟล์ .zip ไฟล์เดียว (ต้องมี .prj เพื่อแปลงเป็นพิกัด GPS)</li>
                </ul>
              </div>

              {canListBatches && (
                <ImportBatchesPanel tenant={tenant} canCancel={canCancelBatch} onChanged={() => setListChanged(true)} />
              )}
            </div>
          )}

          {/* Success screen */}
          {successRows !== null && (
            <div className="space-y-4">
              <div className="pt-4 flex flex-col items-center justify-center text-center space-y-2">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 size={36} />
                </div>
                <h3 className="text-xl font-bold text-gray-800">นำเข้าข้อมูลสำเร็จ</h3>
                <p className="text-sm text-gray-600 max-w-sm">
                  บันทึกเข้าศูนย์ข้อมูลดิจิทัลเรียบร้อย <span className="font-bold text-emerald-600 text-base">{insertedSoFar}</span> รายการ
                </p>
                {photoResult && (
                  <p className={`text-sm max-w-sm ${photoResult.fail > 0 ? 'text-amber-700' : 'text-gray-600'}`}>
                    อัปโหลดรูปสำเร็จ {photoResult.ok} รูป · ไม่สำเร็จ {photoResult.fail} รูป
                    {photoResult.fail > 0 && (
                      <span className="block text-xs mt-0.5">รูปที่ไม่สำเร็จ เพิ่มเองได้ที่ปุ่มแก้ไขรายการ</span>
                    )}
                  </p>
                )}
                {canCancelBatch && lastBatchId && !cancelResult?.ok && (
                  <button
                    type="button"
                    onClick={handleCancelLastBatch}
                    disabled={cancelBusy}
                    className="mt-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-bold hover:bg-red-50 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                  >
                    {cancelBusy ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
                    ยกเลิกการนำเข้าชุดนี้
                  </button>
                )}
                {cancelResult && (
                  <p className={`text-xs max-w-sm flex items-start gap-1.5 ${cancelResult.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                    {cancelResult.ok ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" /> : <AlertCircle size={13} className="shrink-0 mt-0.5" />}
                    <span className="break-words">{cancelResult.text}</span>
                  </p>
                )}
              </div>
              <div className="border border-gray-200 rounded-2xl overflow-hidden">
                <div className="px-3.5 py-2 bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-700">สรุปตามกลุ่ม › ประเภท (รอบนี้)</div>
                <div className="divide-y divide-gray-100 max-h-[40vh] overflow-y-auto">
                  {successRows.map(r => (
                    <div key={`${r.group}|${r.category}`} className="px-3.5 py-2 flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate text-gray-800">{r.group} › {r.category}</span>
                      <span className="shrink-0 font-bold text-emerald-700">{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: ตรวจตารางจับคู่ */}
          {showTable && (
            <div className="space-y-4">

              {/* a) แถบสรุป */}
              <div className="bg-blue-50/70 border border-blue-100 rounded-2xl p-3.5 space-y-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-bold text-blue-900">พบ {stats.point} จุด / {stats.line} เส้น / {stats.polygon} พื้นที่</span>
                  <span className="text-[11px] text-blue-700 break-all">{file?.name}</span>
                </div>
                {(Object.values(result.skipped).some(Boolean)) && (
                  <p className="text-gray-600">
                    ข้าม: ภาพซ้อน {result.skipped.overlay}, โมเดล {result.skipped.model}, NetworkLink {result.skipped.networkLink},
                    พิกัดผิด {result.skipped.invalidCoord}, นอกประเทศไทย {result.skipped.outsideThailand}
                    {result.skipped.empty > 0 && `, ไม่มีพิกัด ${result.skipped.empty}`}
                  </p>
                )}
                {(result.photos.total + result.photos.remote + result.photos.missing + result.photos.overLimit) > 0 && (
                  <p className="text-gray-600">
                    รูปที่แนบในไฟล์: อ่านได้ {result.photos.total} รูป
                    {result.photos.remote > 0 && ` · รูปภายนอก ${result.photos.remote} รูป (ข้าม)`}
                    {result.photos.missing > 0 && ` · หาไม่เจอในไฟล์ ${result.photos.missing} รูป (ข้าม)`}
                    {result.photos.overLimit > 0 && ` · เกิน 5 รูปต่อจุด ${result.photos.overLimit} รูป (ข้าม)`}
                  </p>
                )}
                <p className="text-gray-600 flex items-center gap-1.5">
                  <Copy size={12} className="shrink-0" />
                  ซ้ำกับของเดิม {stats.duplicate} รายการ{stats.duplicate > 0 && ' (ไม่ติ๊กนำเข้าไว้ให้ก่อน)'}
                </p>
                {dupNotice && (
                  <p className="text-amber-700 flex items-start gap-1.5"><AlertCircle size={12} className="shrink-0 mt-0.5" />{dupNotice}</p>
                )}
                {result.warnings.map(w => (
                  <p key={w} className="text-amber-700 flex items-start gap-1.5"><AlertCircle size={12} className="shrink-0 mt-0.5" />{w}</p>
                ))}
              </div>

              {/* b) ค่าเริ่มต้นของไฟล์ */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2.5">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Filter size={14} className="text-blue-600" /> ค่าเริ่มต้นของไฟล์ (ใช้เฉพาะรายการที่ไม่มีโฟลเดอร์/ข้อมูลหมวดในไฟล์)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 mb-1 block">กลุ่มหลัก</label>
                    <input
                      type="text"
                      list="import-default-groups"
                      value={defaults.group}
                      onChange={e => setDefaults(d => ({ ...d, group: e.target.value }))}
                      placeholder="เช่น โครงสร้างพื้นฐาน, สาธารณสุข"
                      className={inputCls}
                    />
                    <datalist id="import-default-groups">
                      {catalog.groupOptions.map(g => <option key={g.value} value={g.value} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 mb-1 block">ประเภทย่อย</label>
                    <input
                      type="text"
                      value={defaults.category}
                      onChange={e => setDefaults(d => ({ ...d, category: e.target.value }))}
                      placeholder="เช่น เสาไฟส่องสว่าง, จุดทิ้งขยะ"
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              {/* c) ตารางจับคู่รายโฟลเดอร์ */}
              <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white">
                <div className="px-3.5 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between text-xs gap-2">
                  <span className="font-bold text-gray-700">
                    ตรวจการจับคู่หมวด ({folders.length} โฟลเดอร์ · เลือกนำเข้า {selectedCount}/{items.length} รายการ)
                  </span>
                  <button
                    onClick={reset}
                    disabled={importing}
                    className="shrink-0 text-gray-400 hover:text-red-600 font-medium transition-colors flex items-center gap-1"
                  >
                    <Trash2 size={13} /> เปลี่ยนไฟล์
                  </button>
                </div>

                <div className="hidden sm:grid grid-cols-12 gap-3 px-3.5 py-2 text-[11px] font-bold text-gray-500 border-b border-gray-100 bg-white">
                  <div className="col-span-4">โฟลเดอร์ในไฟล์</div>
                  <div className="col-span-3">กลุ่มหลัก</div>
                  <div className="col-span-3">ประเภทย่อย</div>
                  <div className="col-span-2">สถานะหมวด</div>
                </div>

                <div className="divide-y divide-gray-100 max-h-[46vh] overflow-y-auto">
                  {rows.map((r, idx) => {
                    const f = r.folder
                    const chosen = f.itemKeys.filter(k => selected[k]).length
                    const allOn = chosen === f.itemKeys.length
                    const open = !!expanded[f.key]
                    const groupEntry = catalog.groups.find(g => g.value === r.resolved.group)
                    const catOptions = groupEntry
                      ? groupEntry.categories
                      : mergeOptions(...catalog.groups.map(g => g.categories))
                    const listId = `import-cat-${idx}`
                    const shownKeys = open ? f.itemKeys.slice(0, MAX_ROWS_SHOWN) : []
                    return (
                      <div key={f.key} className={chosen === 0 ? 'bg-gray-50/70' : ''}>
                        <div className="p-3 sm:px-3.5 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 sm:items-center">
                          <div className="sm:col-span-4 flex items-start gap-2 min-w-0">
                            <input
                              type="checkbox"
                              ref={el => { if (el) el.indeterminate = chosen > 0 && !allOn }}
                              checked={allOn}
                              onChange={e => toggleFolder(f, e.target.checked)}
                              aria-label={`นำเข้าทั้งโฟลเดอร์ ${f.key}`}
                              className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer shrink-0"
                            />
                            <button
                              type="button"
                              onClick={() => setExpanded(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                              className="min-w-0 text-left flex-1"
                            >
                              <span className="flex items-center gap-1 text-xs font-bold text-gray-900">
                                {open ? <ChevronDown size={14} className="shrink-0 text-gray-400" /> : <ChevronRight size={14} className="shrink-0 text-gray-400" />}
                                <span className="break-words min-w-0">{f.key}</span>
                              </span>
                              <span className="block text-[11px] text-gray-500 pl-5">
                                {countsText(f.counts)} · เลือก {chosen}/{f.itemKeys.length}
                              </span>
                            </button>
                          </div>

                          <div className="sm:col-span-3">
                            <label className="sm:hidden text-[11px] font-semibold text-gray-500 mb-0.5 block">กลุ่มหลัก</label>
                            <input
                              type="text"
                              list="import-row-groups"
                              value={r.groupText}
                              onChange={e => setOverride(f.key, { group: e.target.value })}
                              placeholder="กลุ่มหลัก"
                              className={`${inputCls} ${!r.resolved.group && chosen > 0 ? 'border-red-300 bg-red-50' : ''}`}
                            />
                          </div>
                          <div className="sm:col-span-3">
                            <label className="sm:hidden text-[11px] font-semibold text-gray-500 mb-0.5 block">ประเภทย่อย</label>
                            <input
                              type="text"
                              list={listId}
                              value={r.categoryText}
                              onChange={e => setOverride(f.key, { category: e.target.value })}
                              placeholder="ประเภทย่อย"
                              className={`${inputCls} ${!r.resolved.category && chosen > 0 ? 'border-red-300 bg-red-50' : ''}`}
                            />
                            <datalist id={listId}>
                              {catOptions.map(c => <option key={c.value} value={c.value} />)}
                            </datalist>
                          </div>
                          <div className="sm:col-span-2 flex flex-wrap gap-1">
                            {r.resolved.groupIsNew && r.resolved.group && (
                              <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-md">กลุ่มใหม่</span>
                            )}
                            {r.resolved.categoryIsNew && r.resolved.category && (
                              <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-md">
                                {r.resolved.groupIsNew ? 'หมวดใหม่' : 'ประเภทใหม่'}
                              </span>
                            )}
                            {r.resolved.group && r.resolved.category && !r.resolved.isNew && (
                              <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-md">ตรงของเดิม</span>
                            )}
                          </div>
                        </div>

                        {open && (
                          <div className="bg-slate-50/60 border-t border-gray-100 divide-y divide-gray-100">
                            {shownKeys.map(k => {
                              const it = items.find(x => x.key === k)
                              return (
                                <label key={k} className={`pl-9 pr-3.5 py-2 flex items-start gap-2.5 cursor-pointer hover:bg-white ${!selected[k] ? 'opacity-50' : ''}`}>
                                  <input
                                    type="checkbox"
                                    checked={!!selected[k]}
                                    onChange={() => toggleItem(k)}
                                    className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer shrink-0"
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="flex flex-wrap items-center gap-1.5">
                                      <span className="font-semibold text-xs text-gray-900 break-words">{it.name}</span>
                                      <ShapeBadge item={it} />
                                      {it.photoRefs?.length > 0 && (
                                        <span className="shrink-0 text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded-md">📷 {it.photoRefs.length}</span>
                                      )}
                                      {it.duplicate && (
                                        <span className="shrink-0 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-md">มีอยู่แล้ว</span>
                                      )}
                                    </span>
                                    <span className="block text-[10px] text-gray-400 mt-0.5">
                                      {it.latitude.toFixed(6)}, {it.longitude.toFixed(6)}
                                    </span>
                                  </span>
                                </label>
                              )
                            })}
                            {f.itemKeys.length > MAX_ROWS_SHOWN && (
                              <p className="pl-9 pr-3.5 py-2 text-[11px] text-gray-500">
                                แสดง {MAX_ROWS_SHOWN} จาก {f.itemKeys.length} รายการ — ติ๊กที่โฟลเดอร์เพื่อเลือก/ไม่เลือกทั้งหมด
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <datalist id="import-row-groups">
                  {catalog.groupOptions.map(g => <option key={g.value} value={g.value} />)}
                </datalist>
              </div>

              {/* d) PDPA */}
              <div className="border border-amber-300 bg-amber-50 rounded-2xl p-3.5 space-y-3 text-xs">
                <p className="font-bold text-amber-900 flex items-start gap-1.5">
                  <ShieldAlert size={15} className="shrink-0 mt-0.5" />
                  ข้อมูลที่นำเข้าจะแสดงบนแผนที่สาธารณะทันที ห้ามนำเข้าชื่อ-เบอร์โทร-เลขบัตรของประชาชน
                </p>

                {hasColumns && (
                  <div className="space-y-1.5">
                    <p className="font-semibold text-amber-900">คอลัมน์ข้อมูลในไฟล์ — ติ๊กเฉพาะที่ต้องการเก็บลงรายละเอียดของรายการ</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                      {result.columns.map(col => {
                        const personal = looksPersonalColumn(col)
                        return (
                          <label key={col} className="flex items-center gap-2 cursor-pointer min-w-0">
                            <input
                              type="checkbox"
                              checked={keptColumns.includes(col)}
                              onChange={() => toggleColumn(col)}
                              className="rounded border-amber-400 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer shrink-0"
                            />
                            <span className="min-w-0 break-words text-gray-800">{col}</span>
                            {personal && (
                              <span className="shrink-0 text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-md">อาจเป็นข้อมูลส่วนบุคคล</span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}

                {photoTotal > 0 && (
                  <div className="space-y-1.5">
                    <label className="flex items-start gap-2 cursor-pointer text-amber-900 font-semibold">
                      <input
                        type="checkbox"
                        checked={importPhotos}
                        onChange={e => setImportPhotos(e.target.checked)}
                        disabled={importing}
                        className="mt-0.5 rounded border-amber-400 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer shrink-0"
                      />
                      <span>นำเข้ารูปที่แนบในไฟล์ด้วย ({photoTotal} รูป{importPhotos ? ` · รอบนี้ติ๊กไว้ ${selectedPhotoCount} รูป` : ''})</span>
                    </label>
                    <p className="pl-6 text-amber-800 flex items-start gap-1.5">
                      <ShieldAlert size={13} className="shrink-0 mt-0.5" />
                      รูปจะขึ้นแผนที่สาธารณะ ตรวจก่อนว่าไม่มีหน้าคน ทะเบียนรถ หรือเอกสารส่วนตัว
                    </p>
                    {(result.photos.remote + result.photos.missing + result.photos.overLimit) > 0 && (
                      <p className="pl-6 text-amber-800">
                        ข้ามแล้ว: รูปภายนอก {result.photos.remote} · หาไม่เจอในไฟล์ {result.photos.missing} · เกิน 5 รูปต่อจุด {result.photos.overLimit}
                      </p>
                    )}
                    {overPhotoLimit && (
                      <p className="pl-6 text-red-600 font-semibold flex items-start gap-1.5">
                        <AlertCircle size={13} className="shrink-0 mt-0.5" />
                        รูปที่เลือกมี {selectedPhotoCount} รูป เกินครั้งละ {MAX_PHOTOS_PER_IMPORT} รูป — เอาติ๊กบางโฟลเดอร์ออกแล้วนำเข้าเป็นรอบ
                      </p>
                    )}
                  </div>
                )}

                <label className="flex items-start gap-2 cursor-pointer text-amber-900 font-semibold">
                  <input
                    type="checkbox"
                    checked={pdpaConfirmed}
                    onChange={e => setPdpaConfirmed(e.target.checked)}
                    className="mt-0.5 rounded border-amber-400 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer shrink-0"
                  />
                  <span>ข้าพเจ้าตรวจแล้วว่าข้อมูลที่จะนำเข้าไม่มีข้อมูลส่วนบุคคลของประชาชน</span>
                </label>
              </div>

              {importError && (
                <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">
                      {importError.inserted > 0
                        ? `นำเข้าสำเร็จไปแล้ว ${importError.inserted} จาก ${importError.total} รายการ แล้วหยุดกลางทาง`
                        : 'นำเข้าไม่สำเร็จ ยังไม่มีรายการใดถูกบันทึก'}
                    </p>
                    <p className="mt-0.5 break-words">สาเหตุ: {importError.message}</p>
                    {importError.inserted > 0 && (
                      <p className="mt-0.5">รายการที่บันทึกแล้วถูกเอาออกจากรายการที่ติ๊ก — กดนำเข้าอีกครั้งจะทำต่อเฉพาะรายการที่เหลือ ไม่บันทึกซ้ำ</p>
                    )}
                    {importError.photosPending > 0 && (
                      <p className="mt-0.5 font-semibold">รายการที่บันทึกไปแล้วยังไม่ได้รับรูป ({importError.photosPending} รูป) เพราะการนำเข้าหยุดก่อนถึงขั้นอัปโหลดรูป — เพิ่มรูปเองได้ที่ปุ่มแก้ไขรายการ</p>
                    )}
                  </div>
                </div>
              )}

              {missingFolders.length > 0 && (
                <p className="text-[11px] text-red-600 flex items-start gap-1.5">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  ยังไม่มีกลุ่ม/ประเภทในโฟลเดอร์: {missingFolders.map(r => r.folder.key).join(', ')} — กรอกให้ครบหรือเอาติ๊กออก
                </p>
              )}

              {/* Progress bar during upload */}
              {importing && (
                <div className="space-y-1.5 bg-blue-50 p-3 rounded-xl border border-blue-200">
                  <div className="flex justify-between text-xs font-bold text-blue-900">
                    <span>{photoProgress ? `กำลังอัปโหลดรูป ${photoProgress.done}/${photoProgress.total} (อย่าปิดหน้านี้)` : 'กำลังบันทึกข้อมูลเข้าสู่ฐานข้อมูล...'}</span>
                    <span>{photoProgress ? `${Math.round((photoProgress.done / Math.max(photoProgress.total, 1)) * 100)}%` : `${progress}%`}</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${photoProgress ? Math.round((photoProgress.done / Math.max(photoProgress.total, 1)) * 100) : progress}%` }}
                    />
                  </div>
                </div>
              )}

            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3.5 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-2 shrink-0">
          {successRows === null ? (
            <button
              onClick={handleClose}
              disabled={importing}
              className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
            >
              ยกเลิก
            </button>
          ) : <span />}

          {showTable && (
            <button
              onClick={executeBatchImport}
              disabled={importing || selectedCount === 0 || selectedCount > MAX_IMPORT_ITEMS || overPhotoLimit || !pdpaConfirmed || missingFolders.length > 0}
              title={selectedCount > MAX_IMPORT_ITEMS
                ? `นำเข้าได้ครั้งละไม่เกิน ${MAX_IMPORT_ITEMS.toLocaleString('th-TH')} รายการ — เอาติ๊กบางโฟลเดอร์ออกแล้วนำเข้าเป็นรอบ`
                : overPhotoLimit ? `นำเข้ารูปได้ครั้งละไม่เกิน ${MAX_PHOTOS_PER_IMPORT} รูป — เอาติ๊กบางโฟลเดอร์ออกแล้วนำเข้าเป็นรอบ` : undefined}
              className="px-4 sm:px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-xs font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-all flex items-center gap-2"
            >
              {importing ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> {photoProgress ? `กำลังอัปโหลดรูป ${photoProgress.done}/${photoProgress.total}` : `กำลังนำเข้า (${progress}%)`}
                </>
              ) : (
                <>
                  <Upload size={14} /> {selectedCount > MAX_IMPORT_ITEMS
                    ? `เกิน ${MAX_IMPORT_ITEMS.toLocaleString('th-TH')} รายการ — แบ่งนำเข้าเป็นรอบ`
                    : overPhotoLimit
                      ? `รูปเกิน ${MAX_PHOTOS_PER_IMPORT} รูป — แบ่งนำเข้าเป็นรอบ`
                      : `นำเข้า ${selectedCount} รายการที่เลือก`}
                </>
              )}
            </button>
          )}

          {successRows !== null && (
            <button
              onClick={() => onImportComplete?.()}
              className="px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-500/20 active:scale-95 transition-all"
            >
              เสร็จ
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
