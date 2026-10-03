// ส่งออกข้อมูลศูนย์รวมข้อมูลดิจิทัลเป็นไฟล์ — ใช้ร่วมกันระหว่างหน้าแผนที่สาธารณะ (ข้อมูลเปิด) กับฝั่งเจ้าหน้าที่
// (ส่งออก CSV ตามตัวกรองในตาราง) กันตรรกะเขียนซ้ำคนละแบบ
//
// ข้อมูลเปิด = เฉพาะ data_center_entries ที่ status='active' ของ อปท. นั้น ซึ่งเป็นชุดเดียวกับที่นโยบาย RLS
// "dce public read active" เปิดให้ anon อ่านและหน้าแผนที่สาธารณะแสดงอยู่แล้ว ⇒ ไม่เพิ่มข้อมูลที่เปิดเผย
// ไม่ส่งออก: created_by / verified_by / department_id (รหัสภายใน) และไม่แตะตารางอื่นเลย (คำร้อง/ข้อมูลบุคคลห้ามเข้าไฟล์นี้)

const OPEN_COLUMNS = 'id, name, group_name, category, description, latitude, longitude, route_points, route_color, photo_urls, external_url, created_at, updated_at, verified_at'

const PAGE_SIZE = 1000          // เท่ากับ max_rows ของ PostgREST — ดึงทีละหน้าเพราะเกินแล้วถูกตัดเงียบๆ (NOTES.md ข้อ 14)
const HARD_CAP_ROWS = 20000     // เพดานกันลูปไม่รู้จบถ้าฐานตอบผิดปกติ

// ดึงทุกหน้าแล้วเทียบกับ count จริง — ได้ไม่ครบต้อง throw ไม่ใช่ส่งไฟล์ที่ตกหล่นเงียบๆ
// เลื่อนหน้าตามจำนวนแถวที่ได้จริง ไม่ใช่ขนาดหน้าที่ขอ และเรียงด้วย id (คีย์ที่ไม่ซ้ำ)
export async function fetchOpenEntries(supabase, municipalityId, { pageSize = PAGE_SIZE } = {}) {
  if (!municipalityId) throw new Error('ไม่ทราบหน่วยงาน')

  const head = await supabase.from('data_center_entries')
    .select('id', { count: 'exact', head: true })
    .eq('municipality_id', municipalityId)
    .eq('status', 'active')
  if (head.error) throw new Error(head.error.message)
  const expected = head.count ?? 0
  if (expected > HARD_CAP_ROWS) throw new Error(`ข้อมูลมีมากกว่า ${HARD_CAP_ROWS} รายการ ไฟล์เดียวรองรับไม่ไหว`)

  const rows = []
  while (rows.length < expected) {
    const { data, error } = await supabase.from('data_center_entries')
      .select(OPEN_COLUMNS)
      .eq('municipality_id', municipalityId)
      .eq('status', 'active')
      .order('id')
      .range(rows.length, rows.length + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
  }
  if (rows.length < expected) {
    throw new Error(`ดึงข้อมูลได้ ${rows.length} จาก ${expected} รายการ — ยกเลิกการส่งออกเพื่อไม่ให้ไฟล์ตกหล่น ลองใหม่อีกครั้ง`)
  }
  return rows
}

// รายการฟิลด์ที่เผยแพร่/ไม่เผยแพร่ ที่แผง "ข้อมูลเปิด" แสดงให้เจ้าหน้าที่ดู — keys ต้องตรงกับ properties ของ GeoJSON
// (tests/data-center-hub.test.mjs เทียบให้ ถ้าเพิ่มฟิลด์ใน GeoJSON แต่ลืมแก้ที่นี่ เทสต์ล้ม)
export const OPEN_DATA_FIELDS = [
  { keys: ['id'], label: 'รหัสรายการ' },
  { keys: ['name'], label: 'ชื่อสถานที่/รายการ' },
  { keys: ['group', 'category'], label: 'กลุ่มหลักและประเภทย่อย' },
  { keys: ['description'], label: 'รายละเอียด (ข้อความที่เจ้าหน้าที่พิมพ์เอง)' },
  { keys: ['photo_urls'], label: 'ลิงก์รูปภาพ' },
  { keys: ['external_url'], label: 'ลิงก์ภายนอก (เฉพาะ http/https)' },
  { keys: ['route_color'], label: 'สีเส้นทาง (เฉพาะเส้นทาง)' },
  { keys: ['created_at', 'updated_at', 'last_verified_at'], label: 'วันที่บันทึก / แก้ไขล่าสุด / ตรวจทานล่าสุด' },
]

export const OPEN_DATA_EXCLUDED = [
  'รายการที่ปิดใช้งาน (archived)',
  'ชื่อหรือรหัสของเจ้าหน้าที่ผู้บันทึก/ผู้ยืนยัน และกองเจ้าของ',
  'ข้อมูลของโมดูลอื่นทั้งหมด เช่น คำร้อง คำขอเอกสาร รถรับ-ส่งผู้ป่วย — ไม่มีทางไหลเข้าไฟล์นี้',
]

// จุดพิกัดต้องเป็นตัวเลขจริงและอยู่ในช่วงโลก — ค่าเพี้ยนไม่ถูกแปลงเป็น 0 เงียบๆ แต่ข้ามรายการนั้น
function validLatLng(lat, lng) {
  const la = Number(lat)
  const lo = Number(lng)
  if (lat == null || lng == null || lat === '' || lng === '') return null
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null
  return { lat: la, lng: lo }
}

function routeCoordinates(routePoints) {
  if (!Array.isArray(routePoints)) return null
  const coords = []
  for (const p of routePoints) {
    const ll = validLatLng(p?.lat, p?.lng)
    if (ll) coords.push([ll.lng, ll.lat]) // GeoJSON เรียงเป็น [ลองจิจูด, ละติจูด]
  }
  return coords.length >= 2 ? coords : null
}

export function isRouteRow(row) {
  return Array.isArray(row.route_points) && row.route_points.length >= 2
}

export function entriesToGeoJSON(rows, { publisher = '', slug = '', now = new Date() } = {}) {
  const features = []
  let skipped = 0
  for (const row of rows) {
    const line = routeCoordinates(row.route_points)
    const ll = validLatLng(row.latitude, row.longitude)
    let geometry = null
    if (line) geometry = { type: 'LineString', coordinates: line }
    else if (ll) geometry = { type: 'Point', coordinates: [ll.lng, ll.lat] }
    if (!geometry) { skipped += 1; continue }
    features.push({
      type: 'Feature',
      id: row.id,
      geometry,
      properties: {
        id: row.id,
        name: row.name ?? '',
        group: row.group_name ?? '',
        category: row.category ?? '',
        description: row.description ?? '',
        external_url: safeHttpUrl(row.external_url) ?? '',
        photo_urls: Array.isArray(row.photo_urls) ? row.photo_urls.filter((u) => safeHttpUrl(u)) : [],
        route_color: line ? (row.route_color ?? null) : null,
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null,
        last_verified_at: row.verified_at ?? null,
      },
    })
  }
  return {
    type: 'FeatureCollection',
    name: slug ? `${slug}-data-center` : 'data-center',
    // สมาชิกพิเศษนอกมาตรฐาน GeoJSON (RFC 7946 อนุญาต) — ไม่ระบุสัญญาอนุญาตเอง เพราะเป็นการตัดสินใจของ อปท.
    metadata: {
      publisher,
      generated_at: now.toISOString(),
      record_count: features.length,
      skipped_invalid_coordinates: skipped,
      coordinate_system: 'WGS84 (EPSG:4326) ลำดับ [ลองจิจูด, ละติจูด]',
      source: 'SmartLocal ศูนย์รวมข้อมูลดิจิทัล',
      scope: 'เฉพาะรายการที่เปิดใช้งานและเผยแพร่บนแผนที่สาธารณะ — ไม่รวมข้อมูลส่วนบุคคลของประชาชน',
    },
    features,
  }
}

// ป้องกัน CSV/Formula injection: เซลล์ข้อความที่ขึ้นต้นด้วย = + - @ (หรือ tab/CR) ถูก Excel ตีความเป็นสูตร
// ชื่อสถานที่/รายละเอียดเป็นข้อความที่เจ้าหน้าที่พิมพ์เอง ผู้เปิดไฟล์คือคนอื่น จึงต้องกันที่ต้นทางส่งออก
// ตัวเลขจริง (number) ไม่แตะ ไม่งั้นพิกัดติดลบจะถูกใส่ ' นำหน้า
export function csvCell(value) {
  let s = value == null ? '' : String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

// BOM นำหน้ากัน Excel ภาษาไทยอ่านเพี้ยน (แบบเดียวกับ FleetReport.jsx)
export function toCsv(rows) {
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

function isoDate(v) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

function thaiDate(v) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// dateStyle 'iso' = เครื่องอ่านต่อได้ (ข้อมูลเปิด) · 'thai' = วัน/เดือน/ปี พ.ศ. (ใช้ในสำนักงาน)
// ละติจูด/ลองจิจูดแยกเป็นคอลัมน์ตัวเลขเสมอ — เดิมรวมเป็นข้อความ "lat, lng" ช่องเดียว นำเข้า GIS ไม่ได้
export function entriesToCsvRows(rows, { dateStyle = 'iso' } = {}) {
  const fmt = dateStyle === 'thai' ? thaiDate : isoDate
  return [
    ['ชื่อ', 'กลุ่มหลัก', 'ประเภทย่อย', 'สถานะ', 'ชนิดพิกัด', 'ละติจูด', 'ลองจิจูด', 'จำนวนจุดของเส้นทาง', 'รายละเอียด', 'ลิงก์ภายนอก', 'จำนวนรูป', 'บันทึกเมื่อ', 'แก้ไขล่าสุด', 'ตรวจทานล่าสุด', 'รหัสรายการ'],
    ...rows.map((e) => {
      const route = isRouteRow(e)
      const ll = validLatLng(e.latitude, e.longitude)
      return [
        e.name ?? '',
        e.group_name ?? '',
        e.category ?? '',
        e.status === 'archived' ? 'ไม่ใช้งาน' : 'ใช้งาน',
        route ? 'เส้นทาง' : 'จุด',
        ll ? ll.lat : '',
        ll ? ll.lng : '',
        route ? e.route_points.length : '',
        e.description ?? '',
        safeHttpUrl(e.external_url) ?? '',
        Array.isArray(e.photo_urls) ? e.photo_urls.length : 0,
        fmt(e.created_at),
        fmt(e.updated_at),
        fmt(e.verified_at),
        e.id ?? '',
      ]
    }),
  ]
}

export function entriesToCsv(rows, opts) {
  return toCsv(entriesToCsvRows(rows, opts))
}

// ลิงก์ที่เจ้าหน้าที่/ไฟล์นำเข้าใส่มาแสดงเป็น <a href> และลงไฟล์ส่งออกได้เฉพาะ http(s)
// กัน javascript:/data: URL ที่รันสคริปต์เมื่อมีคนกด (ฟิลด์นี้มาจากการนำเข้า KML ไม่ผ่านฟอร์มที่มีตัวกรอง)
export function safeHttpUrl(value) {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

export function datedFilename(base, ext, now = new Date()) {
  const day = now.toISOString().slice(0, 10)
  const safeBase = String(base || 'data-center').replace(/[\\/:*?"<>|\s]+/g, '_')
  return `${safeBase}_${day}.${ext}`
}

export function downloadTextFile(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
