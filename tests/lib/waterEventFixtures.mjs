// ข้อมูลจำลองหน้าตาเดียวกับผลของ get_water_event() — ใช้ร่วมเทสต์ใบพิมพ์สรุปเหตุการณ์น้ำ-ฝน (ตรรกะ + เลย์เอาต์)
const HOUR = 3600_000
export const T0 = Date.parse('2026-10-20T00:00:00Z')
const at = (h) => new Date(T0 + h * HOUR).toISOString()

export const TENANT = { name: 'องค์การบริหารส่วนตำบลทุ่งแค้ว' }
export const PRINTED_AT = new Date(T0 + 30 * HOUR)

const rainRows = (peak, gap = true) => (gap ? [0, 1, 2, 3, 9, 10, 11] : [0, 1, 2, 3, 4, 5, 6]).map((h, i) => ({ t: at(h), rain_24h: [20, peak - 10, peak, peak - 30, 5, 2, 0][i], ...(i === 2 ? { rain_1h: 14 } : {}) }))
const levelRows = () => [0, 1, 2, 3].map((h, i) => ({ t: at(h), ...(i === 1 ? {} : { level_msl: 150 + i * 0.5 }), bank_diff: [2.5, 1.2, 0.8, 1.3][i] }))
const damRows = () => [0, 24, 48].map(h => ({ t: at(h - 24), storage_pct: 101.2, dam_storage: 6.1, dam_inflow: 0.2, dam_released: 0.1 }))
const blankRows = () => [{ t: at(1) }, { t: at(2) }]

/**
 * @param {object} [options]
 * @param {number} [options.stations]  จำนวนสถานีทั้งหมด (วนชนิด ฝน/ระดับน้ำ/อ่าง)
 * @param {number} [options.blank]     กี่สถานีที่ไม่มีค่าที่วัดได้เลย (นับจากท้าย)
 * @param {number} [options.warnings]
 * @param {boolean} [options.open]     เหตุการณ์ยังเปิดอยู่
 * @param {boolean} [options.long]     ชื่อสถานี/ข้อความเตือนยาวสุดที่คาดว่าจะเจอ
 * @param {boolean} [options.gaps]     สถานีฝนมีช่วงที่ไม่ส่งค่า 6 ชม. (ค่าเริ่มต้น มี)
 * @param {boolean} [options.dam]      มีอ่างในชุดสถานี (ค่าเริ่มต้น มี)
 */
export function eventDetail({ stations = 5, blank = 0, warnings = 2, open = false, long = false, gaps = true, dam = true } = {}) {
  const kinds = dam ? ['rain', 'waterlevel', 'dam'] : ['rain', 'waterlevel']
  const list = Array.from({ length: stations }, (_, i) => {
    const type = kinds[i % kinds.length]
    const isBlank = i >= stations - blank
    const base = long ? 'อ่างเก็บน้ำห้วยขึมโยธินอุทกพัฒนาตามพระราชดำริ ' : 'สถานี'
    return {
      station_type: type,
      station_code: `${type}-${i}`,
      station_name: `${base}${i + 1}`,
      readings: isBlank ? blankRows() : type === 'rain' ? rainRows(112 + i, gaps) : type === 'waterlevel' ? levelRows() : damRows(),
    }
  })
  const message = long
    ? 'ประกาศเตือนภัยน้ำท่วมฉับพลันและน้ำป่าไหลหลาก บริเวณลำน้ำแม่คำปองและลำห้วยสาขา ขอให้ประชาชนในพื้นที่ลุ่มต่ำริมน้ำเฝ้าระวังเป็นพิเศษ และติดตามข่าวสารอย่างใกล้ชิด\nบรรทัดที่สอง ตามต้นฉบับ'
    : 'เตือนภัยน้ำท่วมฉับพลัน\nบรรทัดสอง'
  return {
    now: at(29), // ของฐานข้อมูลตอนโหลด — ต่างจากเวลาพิมพ์ (PRINTED_AT) 1 ชม. เพื่อจับบั๊กใช้เวลาผิดตัว
    event: {
      id: '11111111-1111-4111-8111-111111111111',
      opened_at: at(2),
      ended_at: open ? null : at(26),
      closed_at: open ? null : at(27),
      close_reason: open ? null : 'calm',
      last_fresh_at: at(29.7),
      open_reason: {
        rule_version: 1,
        triggers: [
          { kind: 'rain', station_name: 'สถานี1', value: 114.3, recorded_at: at(2) },
          { kind: 'waterlevel', station_name: 'สถานี2', value: 0.8, recorded_at: at(2) },
          { kind: 'warning', station_name: 'น้ำท่วมฉับพลัน', value: null, recorded_at: at(2) },
        ],
      },
    },
    stations: list,
    warnings: Array.from({ length: warnings }, (_, i) => ({
      issued_at: at(3 + i), message: `${message} (${i + 1})`, station_name: 'สสน.', tambon_name: 'ต.บ้านเวียง',
    })),
  }
}

export const PREPARER = { name: 'นางสาวประกายมาศ ศรีวิชัยเลิศสกุลวงศ์', title: 'เจ้าพนักงานธุรการปฏิบัติงาน' }
export const ACKNOWLEDGER = { name: 'นายสมศักดิ์ ตั้งใจพัฒนาชุมชน', title: 'ผู้อำนวยการกองช่าง รักษาราชการแทน ปลัดองค์การบริหารส่วนตำบลทุ่งแค้ว' }
