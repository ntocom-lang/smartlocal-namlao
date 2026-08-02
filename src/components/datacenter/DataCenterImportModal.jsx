import { useState, useRef } from 'react'
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, X, MapPin, Route, Eye, Trash2, Layers, Filter } from 'lucide-react'
import JSZip from 'jszip'
import { supabase } from '../../lib/supabase'

const SEED_GROUPS = [
  'สาธารณสุข', 'สถานที่สำคัญ', 'สถานประกอบการ', 'การจัดการขยะ',
  'สถานศึกษา', 'โครงสร้างพื้นฐาน', 'สถานที่หลบภัย', 'พื้นที่สีเขียว'
]

// ── Parser Helpers ────────────────────────────────────────────────────────────

function stripHTML(html) {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent || ''
}

function parseCoordinatesString(coordsStr) {
  if (!coordsStr) return []
  return coordsStr.trim().split(/\s+/).map(pairStr => {
    const parts = pairStr.split(',').map(p => parseFloat(p.trim()))
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      // KML coordinates are: longitude, latitude, [altitude]
      return { lng: parts[0], lat: parts[1] }
    }
    return null
  }).filter(Boolean)
}

function parseKMLDocument(xmlText) {
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml')

  const parserError = xmlDoc.querySelector('parsererror')
  if (parserError) {
    throw new Error('โครงสร้างไฟล์ KML ไม่ถูกต้อง หรือไม่ใช่ XML ที่สมบูรณ์')
  }

  const items = []
  const placemarks = xmlDoc.getElementsByTagName('Placemark')

  for (let i = 0; i < placemarks.length; i++) {
    const pm = placemarks[i]

    // Name & Description
    const nameNode = pm.getElementsByTagName('name')[0]
    const name = nameNode ? nameNode.textContent.trim() : `สถานที่ #${i + 1}`

    const descNode = pm.getElementsByTagName('description')[0]
    const rawDesc = descNode ? descNode.textContent.trim() : ''
    const description = stripHTML(rawDesc)

    // Check Folder parent for group/category hint
    let folderHint = ''
    let parentNode = pm.parentNode
    while (parentNode && parentNode.nodeName !== 'Document' && parentNode.nodeName !== '#document') {
      if (parentNode.nodeName === 'Folder') {
        const folderName = parentNode.getElementsByTagName('name')[0]?.textContent?.trim()
        if (folderName) {
          folderHint = folderName
          break
        }
      }
      parentNode = parentNode.parentNode
    }

    // Geometry check
    let latitude = null
    let longitude = null
    let routePoints = null

    // 1. Point
    const pointNode = pm.getElementsByTagName('Point')[0]
    if (pointNode) {
      const coordsNode = pointNode.getElementsByTagName('coordinates')[0]
      const pts = parseCoordinatesString(coordsNode ? coordsNode.textContent : '')
      if (pts.length > 0) {
        latitude = pts[0].lat
        longitude = pts[0].lng
      }
    }

    // 2. LineString / Polyline
    const lineNode = pm.getElementsByTagName('LineString')[0]
    if (lineNode) {
      const coordsNode = lineNode.getElementsByTagName('coordinates')[0]
      const pts = parseCoordinatesString(coordsNode ? coordsNode.textContent : '')
      if (pts.length >= 2) {
        routePoints = pts
        const midIdx = Math.floor(pts.length / 2)
        latitude = pts[midIdx].lat
        longitude = pts[midIdx].lng
      }
    }

    // 3. Polygon
    const polyNode = pm.getElementsByTagName('Polygon')[0]
    if (!lineNode && polyNode) {
      const coordsNode = polyNode.getElementsByTagName('coordinates')[0]
      const pts = parseCoordinatesString(coordsNode ? coordsNode.textContent : '')
      if (pts.length >= 2) {
        routePoints = pts
        const midIdx = Math.floor(pts.length / 2)
        latitude = pts[midIdx].lat
        longitude = pts[midIdx].lng
      }
    }

    if (latitude !== null && longitude !== null) {
      items.push({
        id: `kml_${i}_${Date.now()}`,
        name,
        description,
        latitude,
        longitude,
        route_points: routePoints,
        group_name: folderHint || '',
        category: '',
        selected: true,
      })
    }
  }

  return items
}

function parseGeoJSONDocument(jsonText) {
  const geojson = JSON.parse(jsonText)
  const features = geojson.type === 'FeatureCollection' ? (geojson.features || []) : [geojson]
  const items = []

  features.forEach((feat, i) => {
    if (!feat || !feat.geometry) return
    const props = feat.properties || {}
    const name = props.name || props.title || props.Name || props.TITLE || `ตำแหน่ง GIS #${i + 1}`
    const description = props.description || props.desc || props.Remark || ''
    const groupHint = props.group_name || props.group || props.Group || ''
    const categoryHint = props.category || props.type || props.Category || ''

    let latitude = null
    let longitude = null
    let routePoints = null

    const { type, coordinates } = feat.geometry

    if (type === 'Point' && Array.isArray(coordinates) && coordinates.length >= 2) {
      longitude = coordinates[0]
      latitude = coordinates[1]
    } else if (type === 'LineString' && Array.isArray(coordinates) && coordinates.length >= 2) {
      routePoints = coordinates.map(c => ({ lng: c[0], lat: c[1] }))
      const mid = Math.floor(routePoints.length / 2)
      longitude = routePoints[mid].lng
      latitude = routePoints[mid].lat
    } else if (type === 'Polygon' && Array.isArray(coordinates) && coordinates[0]?.length >= 2) {
      routePoints = coordinates[0].map(c => ({ lng: c[0], lat: c[1] }))
      const mid = Math.floor(routePoints.length / 2)
      longitude = routePoints[mid].lng
      latitude = routePoints[mid].lat
    }

    if (latitude !== null && longitude !== null && !isNaN(latitude) && !isNaN(longitude)) {
      items.push({
        id: `geojson_${i}_${Date.now()}`,
        name,
        description,
        latitude,
        longitude,
        route_points: routePoints,
        group_name: groupHint,
        category: categoryHint,
        selected: true,
      })
    }
  })

  return items
}

function parseCSVDocument(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length < 2) throw new Error('ไฟล์ CSV ไม่มีข้อมูลเพียงพอ (ต้องมีบรรทัดหัวตาราง)')

  const parseRow = row => {
    const result = []
    let inside = false
    let current = ''
    for (let i = 0; i < row.length; i++) {
      const char = row[i]
      if (char === '"' || char === "'") {
        inside = !inside
      } else if (char === ',' && !inside) {
        result.push(current.trim().replace(/^["']|["']$/g, ''))
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim().replace(/^["']|["']$/g, ''))
    return result
  }

  const headers = parseRow(lines[0]).map(h => h.toLowerCase())

  const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('ชื่อ') || h.includes('title'))
  const latIdx  = headers.findIndex(h => h.includes('lat') || h.includes('ละติจูด'))
  const lngIdx  = headers.findIndex(h => h.includes('lng') || h.includes('lon') || h.includes('ลองจิจูด'))
  const groupIdx = headers.findIndex(h => h.includes('group') || h.includes('กลุ่ม'))
  const catIdx = headers.findIndex(h => h.includes('cat') || h.includes('ประเภท'))
  const descIdx = headers.findIndex(h => h.includes('desc') || h.includes('รายละเอียด') || h.includes('หมายเหตุ'))

  if (latIdx === -1 || lngIdx === -1) {
    throw new Error('ไม่พบคอลัมน์ Latitude หรือ Longitude ในไฟล์ CSV (ต้องระบุ lat, lng หรือ ละติจูด, ลองจิจูด)')
  }

  const items = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i])
    if (cols.length <= Math.max(latIdx, lngIdx)) continue

    const lat = parseFloat(cols[latIdx])
    const lng = parseFloat(cols[lngIdx])
    if (isNaN(lat) || isNaN(lng)) continue

    const name = nameIdx !== -1 && cols[nameIdx] ? cols[nameIdx] : `สถานที่ #${i}`
    const description = descIdx !== -1 ? cols[descIdx] || '' : ''
    const group_name = groupIdx !== -1 ? cols[groupIdx] || '' : ''
    const category = catIdx !== -1 ? cols[catIdx] || '' : ''

    items.push({
      id: `csv_${i}_${Date.now()}`,
      name,
      description,
      latitude: lat,
      longitude: lng,
      route_points: null,
      group_name,
      category,
      selected: true,
    })
  }

  return items
}

// ── Main Import Modal Component ───────────────────────────────────────────────

export default function DataCenterImportModal({ tenant, profile, onClose, onImportComplete }) {
  const fileInputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState(null)

  const [parsedItems, setParsedItems] = useState([])
  const [defaultGroup, setDefaultGroup] = useState('โครงสร้างพื้นฐาน')
  const [defaultCategory, setDefaultCategory] = useState('พิกัดนำเข้า')

  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [importSuccessCount, setImportSuccessCount] = useState(null)

  async function handleFileSelected(e) {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    setFile(selectedFile)
    setParsing(true)
    setParseError(null)
    setParsedItems([])

    try {
      const fileName = selectedFile.name.toLowerCase()
      let items = []

      if (fileName.endsWith('.kml')) {
        const text = await selectedFile.text()
        items = parseKMLDocument(text)
      } else if (fileName.endsWith('.kmz')) {
        const zip = await JSZip.loadAsync(selectedFile)
        const kmlFile = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith('.kml'))
        if (!kmlFile) throw new Error('ไม่พบไฟล์ doc.kml ภายในไฟล์ KMZ นี้')
        const xmlText = await kmlFile.async('string')
        items = parseKMLDocument(xmlText)
      } else if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
        const text = await selectedFile.text()
        items = parseGeoJSONDocument(text)
      } else if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
        const text = await selectedFile.text()
        items = parseCSVDocument(text)
      } else {
        throw new Error('รูปแบบไฟล์ไม่รองรับ (รองรับเฉพาะ .kml, .kmz, .geojson, .json, .csv)')
      }

      if (items.length === 0) {
        throw new Error('ไม่พบพิกัดสถานที่ในไฟล์ดังกล่าว')
      }

      setParsedItems(items)
    } catch (err) {
      console.error('Error parsing file:', err)
      setParseError(err.message || 'ไม่สามารถอ่านข้อมูลในไฟล์ได้')
    } finally {
      setParsing(false)
      e.target.value = ''
    }
  }

  function toggleSelectItem(id) {
    setParsedItems(prev => prev.map(item => item.id === id ? { ...item, selected: !item.selected } : item))
  }

  function toggleSelectAll(selectAll) {
    setParsedItems(prev => prev.map(item => ({ ...item, selected: selectAll })))
  }

  async function executeBatchImport() {
    const selectedItems = parsedItems.filter(item => item.selected)
    if (selectedItems.length === 0 || !tenant?.id) return

    setImporting(true)
    setProgress(0)
    setImportSuccessCount(null)

    const BATCH_SIZE = 50
    let insertedTotal = 0

    try {
      for (let i = 0; i < selectedItems.length; i += BATCH_SIZE) {
        const batch = selectedItems.slice(i, i + BATCH_SIZE).map(item => ({
          municipality_id: tenant.id,
          group_name: (item.group_name || defaultGroup).trim(),
          category: (item.category || defaultCategory).trim(),
          name: item.name.trim(),
          description: item.description ? item.description.trim() : null,
          latitude: item.latitude,
          longitude: item.longitude,
          route_points: item.route_points,
          route_color: item.route_points ? '#3b82f6' : null,
          status: 'active',
          created_by: profile?.id ?? null,
          department_id: profile?.department_id ?? null,
        }))

        const { error } = await supabase.from('data_center_entries').insert(batch)
        if (error) throw error

        insertedTotal += batch.length
        setProgress(Math.round((insertedTotal / selectedItems.length) * 100))
      }

      setImportSuccessCount(insertedTotal)
      setTimeout(() => {
        onImportComplete?.()
      }, 1500)
    } catch (err) {
      console.error('Error batch inserting data center entries:', err)
      alert('เกิดข้อผิดพลาดขณะนำเข้าข้อมูล: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const selectedCount = parsedItems.filter(i => i.selected).length

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400">
              <Upload size={18} />
            </div>
            <div>
              <h2 className="font-bold text-base leading-tight">นำเข้าพิกัด GIS / Google Earth</h2>
              <p className="text-xs text-slate-400">รองรับไฟล์ .KML, .KMZ, .GeoJSON, .CSV</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body Area */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          
          {/* Step 1: File Drop Zone */}
          {parsedItems.length === 0 && !importSuccessCount && (
            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-blue-200 hover:border-blue-500 bg-blue-50/40 hover:bg-blue-50 rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center group"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelected}
                  accept=".kml,.kmz,.geojson,.json,.csv,.txt"
                  className="hidden"
                />
                {parsing ? (
                  <div className="flex flex-col items-center py-4">
                    <Loader2 size={36} className="animate-spin text-blue-600 mb-3" />
                    <p className="font-bold text-gray-700 text-sm">กำลังถอดรหัสไฟล์พิกัด GIS...</p>
                    <p className="text-xs text-gray-400 mt-1">{file?.name}</p>
                  </div>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-2xl bg-white border border-blue-100 shadow-sm flex items-center justify-center text-blue-600 mb-3 group-hover:scale-110 transition-transform">
                      <FileText size={28} />
                    </div>
                    <p className="font-bold text-gray-800 text-base">คลิกที่นี่เพื่อเลือกไฟล์จากคอมพิวเตอร์</p>
                    <p className="text-xs text-gray-500 mt-1 max-w-sm">
                      ลากหรือเลือกไฟล์ <span className="font-semibold text-blue-600">.KML / .KMZ (Google Earth)</span>, <span className="font-semibold text-emerald-600">.GeoJSON</span> หรือ <span className="font-semibold text-orange-600">.CSV</span>
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
                  <li><strong>Google Earth (KML/KMZ)</strong>: ระบบจะอ่านชื่อสถานที่ (Placemark Name), รายละเอียด, พิกัดจุด (Point) และเส้นทาง (Polyline) โดยอัตโนมัติ</li>
                  <li><strong>GeoJSON (.geojson)</strong>: รองรับ FeatureCollection แบบ Point และ LineString</li>
                  <li><strong>CSV File (.csv)</strong>: ต้องมีหัวตารางระบุ <code>name</code> (ชื่อ), <code>lat</code> (ละติจูด), <code>lng</code> (ลองจิจูด)</li>
                </ul>
              </div>
            </div>
          )}

          {/* Success screen */}
          {importSuccessCount !== null && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center animate-bounce">
                <CheckCircle2 size={36} />
              </div>
              <h3 className="text-xl font-bold text-gray-800">นำเข้าข้อมูลสำเร็จ!</h3>
              <p className="text-sm text-gray-600 max-w-sm">
                บันทึกพิกัดสถานที่เข้าสู่ระบบศูนย์ข้อมูลดิจิทัลเรียบร้อยจำนวน <span className="font-bold text-emerald-600 text-base">{importSuccessCount}</span> รายการ
              </p>
            </div>
          )}

          {/* Step 2: Preview & Configuration */}
          {parsedItems.length > 0 && importSuccessCount === null && (
            <div className="space-y-4">
              
              {/* Top Configuration */}
              <div className="bg-blue-50/70 border border-blue-100 rounded-2xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                    <Filter size={14} className="text-blue-600" /> กำหนดกลุ่ม/หมวดหมู่เริ่มต้น (กรณีในไฟล์ไม่ได้ระบุ)
                  </span>
                  <span className="text-[11px] font-semibold text-blue-700 bg-white px-2.5 py-1 rounded-full border border-blue-200">
                    พบทั้งหมด {parsedItems.length} รายการ
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 mb-1 block">กลุ่มหลัก *</label>
                    <input
                      type="text"
                      list="import-seed-groups"
                      value={defaultGroup}
                      onChange={e => setDefaultGroup(e.target.value)}
                      placeholder="เช่น โครงสร้างพื้นฐาน, สาธารณสุข"
                      className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-800 focus:ring-2 focus:ring-blue-200 focus:outline-none"
                    />
                    <datalist id="import-seed-groups">
                      {SEED_GROUPS.map(g => <option key={g} value={g} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 mb-1 block">ประเภทย่อย *</label>
                    <input
                      type="text"
                      value={defaultCategory}
                      onChange={e => setDefaultCategory(e.target.value)}
                      placeholder="เช่น เสาไฟส่องสว่าง, จุดทิ้งขยะ"
                      className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-800 focus:ring-2 focus:ring-blue-200 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Items List Preview */}
              <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white">
                <div className="px-3.5 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedCount === parsedItems.length}
                      onChange={e => toggleSelectAll(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                    />
                    <span className="font-bold text-gray-700">เลือกทั้งหมด ({selectedCount}/{parsedItems.length})</span>
                  </div>
                  <button
                    onClick={() => { setParsedItems([]); setFile(null); }}
                    className="text-gray-400 hover:text-red-600 font-medium transition-colors flex items-center gap-1"
                  >
                    <Trash2 size={13} /> เปลี่ยนไฟล์
                  </button>
                </div>

                <div className="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">
                  {parsedItems.map(item => (
                    <div key={item.id} className={`p-3 flex items-start gap-3 hover:bg-slate-50 transition-colors ${!item.selected ? 'opacity-40 bg-gray-50' : ''}`}>
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => toggleSelectItem(item.id)}
                        className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-xs text-gray-900 truncate">{item.name}</p>
                          {item.route_points ? (
                            <span className="shrink-0 text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                              <Route size={10} /> เส้นทาง ({item.route_points.length} จุด)
                            </span>
                          ) : (
                            <span className="shrink-0 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-md flex items-center gap-1">
                              <MapPin size={10} /> จุดพิกัด
                            </span>
                          )}
                        </div>

                        {item.description && (
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">{item.description}</p>
                        )}

                        <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
                          <span>Lat: {item.latitude.toFixed(6)}, Lng: {item.longitude.toFixed(6)}</span>
                          {item.group_name && <span className="bg-gray-100 text-gray-600 px-1.5 py-0.2 rounded">กลุ่ม: {item.group_name}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Progress bar during upload */}
              {importing && (
                <div className="space-y-1.5 bg-blue-50 p-3 rounded-xl border border-blue-200">
                  <div className="flex justify-between text-xs font-bold text-blue-900">
                    <span>กำลังบันทึกข้อมูลเข้าสู่ฐานข้อมูล...</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            disabled={importing}
            className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
          >
            ยกเลิก
          </button>

          {parsedItems.length > 0 && importSuccessCount === null && (
            <button
              onClick={executeBatchImport}
              disabled={importing || selectedCount === 0 || !defaultGroup.trim() || !defaultCategory.trim()}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-xs font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-all flex items-center gap-2"
            >
              {importing ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> กำลังนำเข้า ({progress}%)
                </>
              ) : (
                <>
                  <Upload size={14} /> นำเข้า {selectedCount} รายการที่เลือก
                </>
              )}
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
