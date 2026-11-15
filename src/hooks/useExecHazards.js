import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchTmdForecast } from '../lib/tmdForecast'

// ภัยที่กำลังมาของห้องผู้บริหารแบบเรียบ — พยากรณ์ฝนกรมอุตุนิยมวิทยา (RPC get_public_tmd_forecast) + ฝุ่น PM2.5 (/api/air-quality ของระบบเอง)
// ไม่มี SQL/RPC ใหม่ · ไม่มี interval/useVisibleRefresh ของตัวเอง: ดึงตอนเปิดหน้า + ทุกครั้งที่ tick เปลี่ยน
//   (tick มาจาก refreshAll ของหน้าแม่ ซึ่ง useExecAutoRefresh คุมแท็บมองเห็น + 06:00–20:00 น. ไว้แล้ว — นอกเวลาไม่ดึงอะไรเลย)
// throttle ต่อแหล่ง (พยากรณ์เปลี่ยนทุก 3 ชม. · Air4Thai ทุกชั่วโมง) — tick ถี่กว่านี้ข้ามไป ไม่ยิงซ้ำ
//   พยากรณ์ 30 นาที (RPC ของ Supabase = นับ egress) · ฝุ่น 10 นาที (ไม่ใช่ egress ของ Supabase)
// ดึงพลาด = คงค่าเดิม (ไม่เคลียร์ — ความเก่าตัดสินที่ฟังก์ชันคำนวณ: พยากรณ์เกิน 12 ชม./สถานีฝุ่นเกิน 3 ชม. = ไม่เตือน) · เปลี่ยน อปท. = เคลียร์
export const HAZARD_FORECAST_MIN_MS = 30 * 60 * 1000
export const HAZARD_AIR_MIN_MS = 10 * 60 * 1000
const AIR_TIMEOUT_MS = 15_000

/** ดึง /api/air-quality แบบเดียวกับหน้า PM2.5 (ตรวจรูปแบบข้อมูลก่อนใช้) · พลาด = โยน */
async function fetchAirFeed(signal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort)
  const timeout = window.setTimeout(abort, AIR_TIMEOUT_MS)
  try {
    const response = await fetch('/api/air-quality', { signal: controller.signal })
    if (!response.ok) throw new Error('Unavailable')
    const data = await response.json()
    if (data?.source !== 'Air4Thai' || !Array.isArray(data.stations)) throw new Error('Invalid feed')
    return data
  } finally {
    window.clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}

const EMPTY = { tenantId: null, value: null, at: null }
const NOT_SETTLED = { tenantId: null, forecast: false, air: false }

/**
 * @param {{ tenant: object|null, enabled: boolean, tick: number }} opts
 * @returns {{ forecast: object|null, air: object|null, fetchedAt: { forecast: number|null, air: number|null }, settled: boolean }}
 *   forecast = ผล normalizeForecast (null = ไม่มี/โหลดไม่ได้) · air = ผล /api/air-quality ทั้งก้อน
 *   settled = ทั้งสองแหล่งดึงรอบแรกจบแล้ว (สำเร็จหรือพลาดก็นับ) — หน้าแม่ใช้รอก่อนจะติดป้าย "ใหม่"/ขึ้นบรรทัดเขียว "ไม่มีเรื่องผิดปกติ"
 *   (ไม่งั้นของที่มาช้ากว่าตัวเลขหลัก 1–2 วินาทีจะถูกติดป้าย "ใหม่" ทั้งที่เป็นแค่ข้อมูลรอบแรก)
 */
export default function useExecHazards({ tenant, enabled, tick }) {
  const tenantId = tenant?.id
  const active = Boolean(enabled && tenantId)
  const [forecastState, setForecastState] = useState(EMPTY)
  const [airState, setAirState] = useState(EMPTY)
  const [settledState, setSettledState] = useState(NOT_SETTLED)
  // สถานะการดึงของแต่ละแหล่ง: at = เวลาที่ได้ผลสำเร็จล่าสุด · token = รอบที่กำลังดึงอยู่ (null = ว่าง) · tenantId กันค่าข้าม อปท.
  const sourcesRef = useRef({ forecast: { tenantId: null, at: 0, token: null }, air: { tenantId: null, at: 0, token: null } })

  // ปิดหน้า = ยกเลิกรอบที่ค้างอยู่ทั้งหมด (แยกจาก effect ดึงข้อมูล เพื่อไม่ให้ยกเลิกทุกครั้งที่ tick เปลี่ยน)
  useEffect(() => {
    const sources = sourcesRef.current
    return () => {
      for (const src of Object.values(sources)) {
        src.token?.abort()
        src.token = null
      }
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const sources = sourcesRef.current
    const settle = (name) => setSettledState((prev) => {
      const base = prev.tenantId === tenantId ? prev : { tenantId, forecast: false, air: false }
      return base[name] ? base : { ...base, [name]: true }
    })
    const run = (name, minMs, load, apply) => {
      const src = sources[name]
      if (src.tenantId !== tenantId) { src.token?.abort(); src.token = null; src.tenantId = tenantId; src.at = 0 }
      if (src.token) return // รอบก่อนยังไม่จบ
      if (Date.now() - src.at < minMs) return // ยังไม่ถึงรอบ (throttle)
      const token = new AbortController()
      src.token = token
      load(token.signal).then((result) => {
        if (src.token === token) src.token = null
        if (token.signal.aborted) return
        const done = apply(result)
        if (done) src.at = Date.now() // พลาด = ไม่ตั้งเวลา → tick ถัดไป (5 นาที) ลองใหม่
        settle(name)
      }).catch(() => {
        if (src.token === token) src.token = null
        if (!token.signal.aborted) settle(name)
      })
    }

    run('forecast', HAZARD_FORECAST_MIN_MS,
      () => fetchTmdForecast(supabase, tenantId),
      ({ forecast, error }) => {
        // พลาดรอบนี้แต่เคยได้ของ อปท. เดิมแล้ว = คงของเดิม · ไม่มีข้อมูลจริง (ไม่ error) = เคลียร์
        setForecastState((prev) => (error && prev.tenantId === tenantId ? prev : { tenantId, value: forecast, at: Date.now() }))
        return !error
      })
    run('air', HAZARD_AIR_MIN_MS,
      (signal) => fetchAirFeed(signal),
      (feed) => {
        setAirState({ tenantId, value: feed, at: Date.now() })
        return true
      })
  }, [active, tenantId, tick])

  const forecastOk = active && forecastState.tenantId === tenantId
  const airOk = active && airState.tenantId === tenantId
  const settled = active && settledState.tenantId === tenantId && settledState.forecast && settledState.air
  return {
    settled,
    forecast: forecastOk ? forecastState.value : null,
    air: airOk ? airState.value : null,
    fetchedAt: { forecast: forecastOk ? forecastState.at : null, air: airOk ? airState.at : null },
  }
}
