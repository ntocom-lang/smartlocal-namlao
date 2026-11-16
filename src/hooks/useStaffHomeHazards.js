import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchTmdForecast } from '../lib/tmdForecast'

// ภัยที่กำลังมาของหน้าแรกเจ้าหน้าที่ (การ์ด "สถานการณ์ในพื้นที่วันนี้" + บรรทัดสรุปวันนี้ในแถบหัว)
// แหล่งเดียวกับห้องผู้บริหาร: พยากรณ์ฝนกรมอุตุนิยมวิทยา (RPC get_public_tmd_forecast) + ฝุ่น PM2.5 (/api/air-quality ของระบบเอง)
//
// ⚠️ ทำไมไม่ใช้ useExecHazards ตรงๆ: ฮุกนั้น throttle ด้วย ref "ต่อ instance" — หน้าแรกถูกสร้างใหม่ทุกครั้งที่เจ้าหน้าที่
//    กดกลับจากโมดูลอื่น ref เริ่มใหม่ทุกครั้ง = ยิง RPC พยากรณ์ใหม่ทุกครั้งที่กลับหน้าแรก (นับ egress ของ Supabase แผนฟรี)
//    ฮุกนี้เก็บแคชระดับโมดูล (Map ตาม tenantId) รอดการ unmount/mount ของหน้า จึงยิงไม่เกิน 1 ครั้ง/30 นาที ต่อ อปท. ต่อแท็บ
// ไม่มี interval/poll · ดึงครั้งเดียวตอน mount (ถ้าแคชหมดอายุ) · แคชหายเมื่อรีเฟรชหน้า
// พลาด = คงค่าเดิมในแคช (ความเก่าตัดสินที่ฟังก์ชันคำนวณ: พยากรณ์เกิน 12 ชม./สถานีฝุ่นเกิน 3 ชม. = ไม่แสดง) · ไม่ลองซ้ำถี่ (พักก่อน HOME_RETRY_MIN_MS)
export const HOME_FORECAST_TTL_MS = 30 * 60 * 1000
export const HOME_AIR_TTL_MS = 10 * 60 * 1000
export const HOME_RETRY_MIN_MS = 2 * 60 * 1000
const AIR_TIMEOUT_MS = 15_000

/** ดึง /api/air-quality แบบเดียวกับหน้า PM2.5 (ตรวจรูปแบบข้อมูลก่อนใช้) · พลาด = โยน */
async function fetchAirFeed() {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), AIR_TIMEOUT_MS)
  try {
    const response = await fetch('/api/air-quality', { signal: controller.signal })
    if (!response.ok) throw new Error('Unavailable')
    const data = await response.json()
    if (data?.source !== 'Air4Thai' || !Array.isArray(data.stations)) throw new Error('Invalid feed')
    return data
  } finally {
    window.clearTimeout(timeout)
  }
}

// แต่ละแหล่ง: ttl อายุแคช · load คืน { ok, value } (ok=false = พลาด คงค่าเดิม)
const SOURCES = {
  forecast: {
    ttl: HOME_FORECAST_TTL_MS,
    load: async (tenantId) => {
      const { forecast, error } = await fetchTmdForecast(supabase, tenantId)
      return { ok: !error, value: forecast }
    },
  },
  air: {
    ttl: HOME_AIR_TTL_MS,
    load: async () => ({ ok: true, value: await fetchAirFeed() }),
  },
}

// tenantId → { forecast: {value, at}|null, air: {value, at}|null, failedAt: {…}, inflight: {…}, tried: {…} }
// tried = เคยพยายามดึงรอบแรกจบแล้ว (สำเร็จหรือพลาดก็นับ) — ใช้บอกว่า "ไม่มีข้อมูล" ต่างจาก "ยังไม่รู้"
const cache = new Map()

function entryOf(tenantId) {
  let entry = cache.get(tenantId)
  if (!entry) {
    entry = { forecast: null, air: null, failedAt: {}, inflight: {}, tried: { forecast: false, air: false } }
    cache.set(tenantId, entry)
  }
  return entry
}

function refreshSource(tenantId, name) {
  const entry = entryOf(tenantId)
  const source = SOURCES[name]
  const now = Date.now()
  if (entry[name] && now - entry[name].at < source.ttl) return Promise.resolve()
  if (entry.inflight[name]) return entry.inflight[name]
  if (entry.failedAt[name] && now - entry.failedAt[name] < HOME_RETRY_MIN_MS) return Promise.resolve()
  const request = source.load(tenantId)
    .then(({ ok, value }) => {
      if (ok) {
        entry[name] = { value, at: Date.now() }
        entry.failedAt[name] = 0
      } else {
        entry.failedAt[name] = Date.now()
      }
    })
    .catch(() => { entry.failedAt[name] = Date.now() })
    .finally(() => {
      entry.tried[name] = true
      if (entry.inflight[name] === request) entry.inflight[name] = null
    })
  entry.inflight[name] = request
  return request
}

/**
 * @param {{ tenantId?: string, enabled?: boolean }} opts
 * @returns {{ forecast: object|null, air: object|null, settled: boolean }}
 *   forecast = ผล normalizeForecast (null = ไม่มี/โหลดไม่ได้) · air = ผล /api/air-quality ทั้งก้อน
 *   settled = ทั้งสองแหล่งดึงรอบแรกจบแล้ว (สำเร็จหรือพลาดก็นับ) · ไม่ได้เปิดใช้ = true (ไม่มีอะไรให้รอ)
 */
export default function useStaffHomeHazards({ tenantId, enabled = true } = {}) {
  const [, setVersion] = useState(0)
  const active = Boolean(enabled && tenantId)

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    Promise.all([refreshSource(tenantId, 'forecast'), refreshSource(tenantId, 'air')])
      .then(() => { if (!cancelled) setVersion((v) => v + 1) })
    return () => { cancelled = true }
  }, [active, tenantId])

  if (!active) return { forecast: null, air: null, settled: true }
  // อ่านจากแคชตอนเรนเดอร์ — กลับมาหน้าแรกภายในอายุแคชจะได้ค่าทันที ไม่กระพริบ
  const entry = cache.get(tenantId)
  return {
    forecast: entry?.forecast?.value ?? null,
    air: entry?.air?.value ?? null,
    settled: Boolean(entry?.tried.forecast && entry?.tried.air),
  }
}
