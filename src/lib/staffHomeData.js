// ดึงข้อมูลหน้าแรกเจ้าหน้าที่จาก RPC 2 ตัว — ไม่ poll ไม่ subscribe realtime
//
// ทำไมไม่ poll: หน้าแรกคือหน้าที่เปิดบ่อยที่สุดในระบบ และ Supabase แผนฟรีเคยโดนตัด 402 เพราะ egress เกินโควตา
// (ดู docs/ai/NOTES.md ข้อ 15) — ตัวเลขนิ่งได้ระดับ "ตอนเปิดหน้า" เพียงพอ ไม่ใช่จอมอนิเตอร์
// เรียกตอน (1) เปิดหน้าแรก (2) กลับมาโฟกัสแท็บ/แอปหลังผ่านไป ≥ 60 วินาที เท่านั้น
//
// มีแคชในหน่วยความจำ 30 วินาที (ต่อ อปท. + บัญชี): เจ้าหน้าที่สลับไปมาระหว่างหน้าแรกกับโมดูลทั้งวัน ทุกครั้งที่กลับมา
// component ถูกสร้างใหม่ ถ้าไม่มีแคชจะยิง RPC ทุกครั้งที่กดกลับ · แคชหายเมื่อรีเฟรชหน้า และผูกกับ id บัญชี
// จึงไม่ข้ามบัญชีเมื่อสลับผู้ใช้ในแท็บเดียวกัน
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const CACHE_TTL_MS = 30_000
const REFOCUS_MIN_MS = 60_000
const cache = new Map()

/**
 * ล้างแคชของ RPC หนึ่งตัว (ทุก อปท./บัญชี) — เรียกหลังคนทำรายการที่เปลี่ยนตัวเลขบนหน้าแรก (เช่น ยืนยันประกาศน้ำ-ฝน)
 * ไม่งั้นกลับหน้าแรกภายใน 30 วินาทีแล้วยังเห็นงานที่ทำเสร็จไปแล้วค้างอยู่
 */
export function clearHomeRpcCache(rpc) {
  for (const key of [...cache.keys()]) if (key.startsWith(`${rpc}:`)) cache.delete(key)
}

/**
 * @param {{ rpc: string, tenantId?: string, profileId?: string, enabled: boolean }} opts
 * @returns {{ status: 'idle'|'loading'|'ok'|'error', data: any }}
 *   status 'idle' = ไม่ได้เปิดใช้ (บทบาทนี้ไม่ต้องดึง) · ระหว่างรีเฟรชเบื้องหลังยังคงค่าเดิมไว้ ไม่กระพริบเป็น loading
 */
export function useHomeRpc({ rpc, tenantId, profileId, enabled }) {
  const key = tenantId && profileId ? `${rpc}:${tenantId}:${profileId}` : null
  const active = Boolean(enabled && key)
  const [state, setState] = useState(() => {
    const hit = key && cache.get(key)
    return hit ? { key, status: 'ok', data: hit.data } : { key, status: active ? 'loading' : 'idle', data: null }
  })

  // ฟังก์ชันดึงอยู่ "ในตัว effect" (แบบเดียวกับ badge รถผู้ป่วยใน StaffDashboard) เพื่อให้ผูก cancelled กับรอบนี้ตรงๆ
  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    let latest = 0
    let lastFetchAt = 0
    const load = async () => {
      const mine = ++latest
      lastFetchAt = Date.now()
      let result
      try {
        result = await supabase.rpc(rpc, { p_muni: tenantId })
      } catch (error) {
        result = { error }
      }
      if (cancelled || mine !== latest) return
      if (result.error || result.data == null) {
        console.error(`${rpc} error:`, result.error?.message ?? 'empty response')
        // มีค่าเดิมอยู่แล้ว (เน็ตสะดุดตอนรีเฟรชเบื้องหลัง) → คงค่าเดิมไว้ ไม่ทิ้งเป็น error; ตัวเลขค้างยังดีกว่าไฟเขียวปลอม
        setState(prev => (prev.key === key && prev.status === 'ok' ? prev : { key, status: 'error', data: null }))
        return
      }
      cache.set(key, { at: Date.now(), data: result.data })
      setState({ key, status: 'ok', data: result.data })
    }
    const hit = cache.get(key)
    if (!hit || Date.now() - hit.at > CACHE_TTL_MS) load()
    const onBack = () => {
      if (!document.hidden && Date.now() - lastFetchAt >= REFOCUS_MIN_MS) load()
    }
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
    return () => {
      cancelled = true // ทิ้งผลที่ยังค้างหลัง unmount/เปลี่ยนบัญชี
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
    }
  }, [active, rpc, tenantId, key])

  // เปลี่ยน อปท./บัญชี ระหว่างที่ component ยังอยู่ → ห้ามแสดงค่าของบัญชีก่อนหน้า
  if (state.key !== key) return { status: active ? 'loading' : 'idle', data: null }
  return { status: active ? state.status : 'idle', data: active ? state.data : null }
}
