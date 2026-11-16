// ตรรกะล้วนของการ์ด "สถานการณ์ในพื้นที่วันนี้" (หน้าแรกเจ้าหน้าที่) — แยกจากคอมโพเนนต์เพราะ react-refresh ไม่ให้ไฟล์คอมโพเนนต์ export ฟังก์ชัน
// แสดงเฉพาะแถวที่มีข้อมูลจริง (ไม่มี/เก่าเกินเกณฑ์ = ไม่ขึ้นแถวนั้น ห้ามขึ้นค่าเดา)
// ใช้ฟังก์ชันคำนวณเดียวกับห้องผู้บริหาร (heavyRainInsight / pm25Insight) — import ใช้อย่างเดียว ไม่แก้
import { dailyRainLevel, dayLabel, forecastFreshness, upcomingDays } from './tmdForecast.js'
import { heavyRainInsight, pm25Insight } from './execSimpleInsights.js'
import { isFresh, nearbyStations, pm25Level } from './pm25.js'

export const AREA_OUTLOOK_DAYS = 3

/**
 * @param {{ forecast: object|null, air: object|null }} hazards
 * @param {object|null} tenant  ต้องมี province / latitude / longitude (nearbyStations ใช้)
 * @param {Date} now
 * @returns {{ rainRow: object[]|null, rainInsight: object|null, dustRow: object|null, dustInsight: object|null, hazards: object[] }}
 *   hazards = insight ฝนหนัก/ฝุ่น ที่ขึ้นเตือน (ไปทำบรรทัด "สรุปวันนี้")
 */
export function buildAreaSituation({ forecast, air } = {}, tenant, now = new Date()) {
  const fresh = forecast && !forecastFreshness(forecast, now).stale
  const days = fresh ? upcomingDays(forecast.daily, now).slice(0, AREA_OUTLOOK_DAYS) : []
  // ทุกวันไม่มีค่าฝน = ไม่ขึ้นแถว (วันที่ไม่มีค่าเดี่ยวๆ ขึ้น "–" ไม่แปลงเป็น 0)
  const rainRow = days.length > 0 && days.some((d) => d.rain !== null)
    ? days.map((d) => ({ time: d.time, label: dayLabel(d.time, now), mm: d.rain, level: dailyRainLevel(d.rain) }))
    : null
  const rainInsight = heavyRainInsight(forecast, now)

  const stations = Array.isArray(air?.stations) ? nearbyStations(air.stations, tenant).stations : []
  const station = stations.find((s) => s.pm25 !== null && isFresh(s, now.getTime())) ?? null
  const level = station ? pm25Level(station.pm25) : null
  const dustRow = station && level ? { name: station.name, value: station.pm25, level } : null
  const dustInsight = pm25Insight(air, tenant, now)

  return { rainRow, rainInsight, dustRow, dustInsight, hazards: [rainInsight, dustInsight].filter(Boolean) }
}
