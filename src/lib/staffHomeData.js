// ดึงข้อมูลหน้าแรกเจ้าหน้าที่จาก RPC 2 ตัว — ไม่ poll ไม่ subscribe realtime
//
// ทำไมไม่ poll: หน้าแรกคือหน้าที่เปิดบ่อยที่สุดในระบบ และ Supabase แผนฟรีเคยโดนตัด 402 เพราะ egress เกินโควตา
// (ดู docs/ai/NOTES.md ข้อ 15) — ตัวเลขนิ่งได้ระดับ "ตอนเปิดหน้า" เพียงพอ ไม่ใช่จอมอนิเตอร์
// เรียกตอน (1) เปิดหน้าแรก (2) กลับมาโฟกัสแท็บ/แอปหลังผ่านไป ≥ 60 วินาที เท่านั้น
//
// มีแคชในหน่วยความจำ 30 วินาที (ต่อ อปท. + บัญชี): เจ้าหน้าที่สลับไปมาระหว่างหน้าแรกกับโมดูลทั้งวัน ทุกครั้งที่กลับมา
// component ถูกสร้างใหม่ ถ้าไม่มีแคชจะยิง RPC ทุกครั้งที่กดกลับ · แคชหายเมื่อรีเฟรชหน้า และผูกกับ id บัญชี
// จึงไม่ข้ามบัญชีเมื่อสลับผู้ใช้ในแท็บเดียวกัน
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

const CACHE_TTL_MS = 30_000
const REFOCUS_MIN_MS = 60_000
const cache = new Map()
// คำขอที่กำลังบินอยู่ (ต่อคีย์เดียวกัน) — หน้าที่เรนเดอร์เนื้อหาซ้ำสองชุดพร้อมกัน (หน้ายานพาหนะวางทั้งชุดมือถือและเดสก์ท็อป ซ่อนด้วย CSS)
// เรียก hook เดียวกันสองครั้งในจังหวะเดียว ไม่ควรยิง RPC สองรอบ
const inflight = new Map()

/**
 * ล้างแคชของ RPC หนึ่งตัว (ทุก อปท./บัญชี) — เรียกหลังคนทำรายการที่เปลี่ยนตัวเลขบนหน้าแรก (เช่น ยืนยันประกาศน้ำ-ฝน)
 * ไม่งั้นกลับหน้าแรกภายใน 30 วินาทีแล้วยังเห็นงานที่ทำเสร็จไปแล้วค้างอยู่
 */
export function clearHomeRpcCache(rpc) {
  for (const key of [...cache.keys()]) if (key.startsWith(`${rpc}:`)) cache.delete(key)
}

/**
 * @param {{ rpc: string, tenantId?: string, profileId?: string, enabled: boolean, args?: object }} opts
 *   args = อาร์กิวเมนต์ของ RPC · ไม่ส่ง = { p_muni: tenantId } (RPC ของหน้าแรกชุดเดิม) · ส่ง {} สำหรับฟังก์ชันที่ไม่รับอาร์กิวเมนต์
 *   (PostgREST หาฟังก์ชันจากชุดชื่ออาร์กิวเมนต์ ส่ง p_muni เกินไปให้ฟังก์ชันที่ไม่รับ = PGRST202)
 * @returns {{ status: 'idle'|'loading'|'ok'|'error', data: any, reload: () => void }}
 *   status 'idle' = ไม่ได้เปิดใช้ (บทบาทนี้ไม่ต้องดึง) · ระหว่างรีเฟรชเบื้องหลังยังคงค่าเดิมไว้ ไม่กระพริบเป็น loading
 *   reload = ทิ้งแคชแล้วดึงใหม่ทันที (ใช้หลังคนทำรายการที่เปลี่ยนตัวเลขของ RPC นี้ เช่น ลงนามเสร็จ) · ค่าเดิมยังโชว์ระหว่างรอ
 */
export function useHomeRpc({ rpc, tenantId, profileId, enabled, args }) {
  // อาร์กิวเมนต์เก็บเป็นสตริง: ผู้เรียกส่งอ็อบเจ็กต์ใหม่ทุกรอบเรนเดอร์ ถ้าใช้เป็น dependency ตรงๆ effect จะวนดึงซ้ำไม่จบ
  const argsJson = args == null ? null : JSON.stringify(args)
  const key = tenantId && profileId ? `${rpc}:${tenantId}:${profileId}${argsJson == null ? '' : `:${argsJson}`}` : null
  const [reloadTick, setReloadTick] = useState(0)
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
      let request = inflight.get(key)
      if (!request) {
        // .then(() => …) ไม่ใช่ Promise.resolve(…): ถ้า supabase.rpc โยนทันที (ไม่ใช่ reject) ต้องถูก catch เหมือนเดิม
        request = Promise.resolve().then(() => supabase.rpc(rpc, argsJson == null ? { p_muni: tenantId } : JSON.parse(argsJson)))
          .catch(error => ({ error }))
          .finally(() => { if (inflight.get(key) === request) inflight.delete(key) })
        inflight.set(key, request)
      }
      const result = await request
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
  }, [active, rpc, tenantId, key, argsJson, reloadTick])

  const reload = useCallback(() => {
    if (key) { cache.delete(key); inflight.delete(key) } // คำขอที่ค้างอยู่เป็นของก่อนทำรายการ — ห้ามเอาผลมาใช้
    setReloadTick(tick => tick + 1)
  }, [key])

  // เปลี่ยน อปท./บัญชี ระหว่างที่ component ยังอยู่ → ห้ามแสดงค่าของบัญชีก่อนหน้า
  if (state.key !== key) return { status: active ? 'loading' : 'idle', data: null, reload }
  return { status: active ? state.status : 'idle', data: active ? state.data : null, reload }
}
