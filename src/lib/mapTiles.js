import L from 'leaflet'

// แหล่ง tile ของแผนที่ทั้งระบบ + กลไก fallback
//
// ทำไมต้องมีไฟล์นี้: เดิมชั้นภาพดาวเทียมผูกกับ endpoint เดียว (server.arcgisonline.com)
// ถ้าวันไหน Esri ปิด endpoint นั้น แผนที่จะขาวพร้อมกันทุก อปท. โดยไม่มีอะไรรองรับ
// และไม่มีสัญญาณเตือนล่วงหน้า — Esri ประกาศให้ย้ายไป Static Basemap Tiles ตัวใหม่
// ที่ต้องใช้ API key ตั้งแต่ 30 เม.ย. 2565 แล้ว endpoint เดิมอยู่ในสถานะ mature/legacy
// (ยังตอบ HTTP 200 อยู่ ณ 2569-09-01 แต่เป็นการใช้นอกกรอบ ToS ปัจจุบัน)

// key เดียวใช้ร่วมกันทุก อปท. ตั้งเป็น build-time env ไม่เก็บลง DB และไม่มีหน้าตั้งค่า
// เพราะไม่ใช่ค่าที่ต่างกันรายหน่วยงาน — ป้องกันการถูกนำไปใช้ต่อด้วย HTTP referrer
// restriction ที่ฝั่ง ArcGIS ไม่ใช่ด้วยการซ่อนค่า (คีย์ฝั่ง browser ซ่อนไม่ได้อยู่แล้ว)
//
// ⚠️ ห้ามเปิด pay-as-you-go ในบัญชี ArcGIS: เมื่อใช้เกินโควตาฟรี Esri จะ "ปิดการเข้าถึง"
//    ไม่ใช่ออกใบเรียกเก็บเงิน ซึ่งเป็นพฤติกรรมที่เราต้องการตามนโยบายงบ 0 บาท
//    ถ้าเปิด PAYG เมื่อไหร่ ทราฟฟิกที่พุ่งขึ้นจะกลายเป็นค่าใช้จ่ายทันที
const ARCGIS_KEY = import.meta.env.VITE_ARCGIS_API_KEY?.trim() || ''

const ESRI_ATTRIB = 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
const OSM_ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

// เดิมชั้นแผนที่ถนนใช้ CartoDB Voyager — เลิกใช้แล้วเพราะ CARTO เปลี่ยนไปบังคับ API key
// ทุก tile ที่ได้กลับมาตอนนี้เป็นภาพพิมพ์ทับว่า "API KEY REQUIRED / carto.com/basemaps/apikey"
// เต็มใบ (ยืนยันด้วยการดึงภาพจริงมาดู: 27 สี ขณะที่ tile ปกติของ OSM มี 163 สี)
// ระวังกับดัก: CARTO ยังตอบ HTTP 200 พร้อมภาพลายน้ำ ไม่ได้ตอบ 4xx จึงตรวจด้วย status ไม่เจอ
//
// ใช้ tile มาตรฐานของ OSM แทน ซึ่งเป็นตัวเดียวกับที่ Traffy Fondue (NECTEC) ใช้บนระบบ
// ระดับ กทม. — ต้องส่ง Referer ที่ถูกต้อง (เบราว์เซอร์ทำให้เอง) และห้ามใช้หนักผิดปกติ
// ตาม OSMF Tile Usage Policy ถ้าวันหนึ่งโดนจำกัด ทางออกที่ยังฟรีคือ self-host tile server
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_OPTIONS = { attribution: OSM_ATTRIB, maxZoom: 19, subdomains: 'abc' }

// ลำดับความพยายามของชั้นภาพดาวเทียม — ตัวแรกที่โหลดสำเร็จคือตัวที่ได้ใช้
// ตัวสุดท้ายจงใจเป็นแผนที่ถนน (ไม่ใช่ภาพดาวเทียม) เพราะ "แผนที่ถนนที่ใช้งานได้"
// ยังดีกว่า "จอขาว" สำหรับประชาชนที่กำลังปักหมุดแจ้งเรื่อง
function satelliteSources() {
  const sources = []

  if (ARCGIS_KEY) {
    sources.push({
      name: 'arcgis-imagery',
      url: `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(ARCGIS_KEY)}`,
      options: { attribution: ESRI_ATTRIB, maxZoom: 19 },
    })
  }

  sources.push({
    name: 'esri-legacy',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { attribution: ESRI_ATTRIB, maxZoom: 19 },
  })

  sources.push({
    name: 'osm-fallback',
    url: OSM_URL,
    options: OSM_OPTIONS,
  })

  return sources
}

export function createStreetLayer() {
  return L.tileLayer(OSM_URL, OSM_OPTIONS)
}

// ป้ายชื่อสถานที่/ขอบเขตที่วางทับภาพดาวเทียม — ถ้าโหลดไม่ได้ก็แค่ไม่มีชื่อกำกับ
// ไม่ใช่เรื่องคอขาดบาดตาย จึงไม่ต้องมี fallback ให้ชั้นนี้
export function createHybridLabelLayer() {
  return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
  })
}

/**
 * ชั้นภาพดาวเทียมที่สลับไปแหล่งถัดไปเองเมื่อแหล่งปัจจุบันล่ม
 *
 * คืนเป็น LayerGroup ที่ "ตัวมันเองไม่เปลี่ยน" แล้วสลับ tileLayer ข้างในแทน — จำเป็น
 * เพราะผู้เรียกเก็บ reference นี้ไว้ใน baseLayersRef แล้วใช้ hasLayer/addLayer เทียบ
 * ถ้าคืน tileLayer ที่ถูกแทนที่ตอน fallback reference ฝั่งโน้นจะชี้ไปชั้นที่ถูกถอดไปแล้ว
 * แล้วปุ่มสลับแผนที่/ดาวเทียมจะเพี้ยนเงียบๆ
 *
 * เกณฑ์ตัดสินว่า "ล่ม": นับ tileerror ที่เกิดใน 8 วินาทีแรกหลังชั้นเริ่มโหลด ถ้าเกิน 4 ใบ
 * ถือว่าใช้ไม่ได้จริง — ไม่ใช้ error ใบเดียวเป็นเกณฑ์ เพราะ tile หลุดประปรายเป็นเรื่องปกติ
 * ของเน็ตมือถือต่างจังหวัด ถ้าสลับทันทีที่เจอใบแรกผู้ใช้จะเห็นแผนที่กระพริบโดยไม่จำเป็น
 *
 * @returns {L.LayerGroup & { disposeFallback: () => void }}
 */
export function createSatelliteLayer() {
  const sources = satelliteSources()
  const group = L.layerGroup()
  let index = 0
  let current = null
  let errorCount = 0
  let windowTimer = null
  let disposed = false

  function activate() {
    const source = sources[index]
    const layer = L.tileLayer(source.url, source.options)

    errorCount = 0
    clearTimeout(windowTimer)
    // พ้น 8 วินาทีแล้วยังรอดอยู่ ถือว่าแหล่งนี้ใช้ได้ เลิกจับตา ไม่ให้ error ที่เกิดตอน
    // ผู้ใช้ pan ไปพื้นที่ที่ไม่มีภาพ (ทะเล/ชายแดน) ไปกระตุ้นการสลับแหล่งโดยใช่เหตุ
    windowTimer = setTimeout(() => { errorCount = -Infinity }, 8000)

    layer.on('tileerror', () => {
      if (disposed || errorCount === -Infinity) return
      errorCount += 1
      if (errorCount <= 4) return
      if (index >= sources.length - 1) return // ถึงตัวสุดท้ายแล้ว ไม่มีที่ให้ถอยต่อ

      console.warn(`[mapTiles] "${source.name}" โหลดไม่ได้ สลับไป "${sources[index + 1].name}"`)
      index += 1
      if (current) {
        current.off('tileerror')
        group.removeLayer(current)
      }
      current = activate()
    })

    group.addLayer(layer)
    return layer
  }

  current = activate()

  group.disposeFallback = () => {
    disposed = true
    clearTimeout(windowTimer)
    current?.off('tileerror')
  }

  return group
}
