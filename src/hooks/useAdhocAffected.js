import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// โหลด/เพิ่ม/แก้/ลบ "ผู้ได้รับผลกระทบ" (พิกัดบุคคล) ของจุดต้นทางเรื่องเฉพาะกิจ — ตาราง adhoc_affected_points
// อ่าน/เขียนผ่านฟังก์ชัน adhoc_affected_list / adhoc_affected_save / adhoc_affected_delete เท่านั้น (ตารางไม่ให้ใครอ่านตรงๆ)
// เพื่อให้ audit log บังคับได้ที่ต้นทาง — สิทธิ์ตัดสินที่ DB เสมอ ฝั่งนี้แค่ซ่อน/โชว์ปุ่ม
//
// ⚠️ ดึงข้อมูลเฉพาะตอนผู้ใช้ "เปิดชั้นนี้เอง" (enabled) และดึงใหม่ทุกครั้งที่เปิด (session เพิ่มขึ้น) เพราะทุกการดึงที่มีจุด
// คือการเปิดดูข้อมูลบุคคลที่ต้องมีรอยใน audit log · ไม่เก็บค้างข้ามการปิด/เปิด ไม่เก็บใน localStorage
// หลังเพิ่ม/แก้/ลบ อัปเดต state ในเครื่องเลย ไม่ดึงซ้ำ (ไม่ให้การแก้ของตัวเองกลายเป็นรอย "เปิดดู" เพิ่มอีกแถว)

function friendlyAffectedError(error) {
  const code = error?.code
  const message = String(error?.message ?? '')
  // ข้อความที่ฟังก์ชัน DB เขียนเป็นภาษาไทยเอง (จุดต้นทางปิดเรื่องแล้ว / เกินเพดาน / ไม่พบรายการ) ใช้ตามนั้น
  if (code === '55000' || code === '54000' || code === 'P0002') return message
  if (code === '42501' || /permission denied|row-level security/i.test(message)) {
    return 'ไม่มีสิทธิ์ทำรายการนี้ (เฉพาะแอดมินและผู้รับผิดชอบเรื่องเฉพาะกิจ)'
  }
  if (code === '23514') {
    if (/note_no_ids/.test(message)) return 'หมายเหตุมีตัวเลขยาวคล้ายเบอร์โทรหรือเลขบัตร — ห้ามใส่ข้อมูลที่ระบุตัวบุคคลได้'
    if (/note_len/.test(message)) return 'หมายเหตุยาวเกิน 120 ตัวอักษร'
    return 'ชนิดหรือพิกัดไม่ถูกต้อง (พิกัดต้องอยู่ในประเทศไทย)'
  }
  if (code === '42883' || code === 'PGRST202' || code === '42P01') return 'ระบบผู้ได้รับผลกระทบยังไม่พร้อมใช้งานในฐานข้อมูลนี้'
  return message || 'บันทึกไม่สำเร็จ'
}

// zoneIds: id ของจุดต้นทางที่ยังเปิดเรื่องอยู่ · enabled: ผู้ใช้เปิดชั้นนี้ + มีสิทธิ์จัดการ · session: นับครั้งที่เปิดชั้น
export default function useAdhocAffected({ zoneIds, enabled, session }) {
  const key = Array.isArray(zoneIds) ? [...zoneIds].sort().join(',') : ''
  const fetchKey = `${session}:${key}`
  const [state, setState] = useState({ points: [], error: null, loadedKey: '' })

  useEffect(() => {
    if (!enabled || !key) return undefined
    let active = true
    ;(async () => {
      const { data, error } = await supabase.rpc('adhoc_affected_list', { p_zone_ids: key.split(',') })
      if (!active) return
      if (error) {
        console.error('adhoc_affected_list:', error.message)
        setState({ points: [], error: friendlyAffectedError(error), loadedKey: fetchKey })
        return
      }
      setState({ points: data ?? [], error: null, loadedKey: fetchKey })
    })()
    return () => { active = false }
  }, [enabled, key, fetchKey])

  // ผลที่เห็นขึ้นกับว่า "ดึงรอบนี้เสร็จหรือยัง" ไม่ใช่ค่าที่ค้างจากรอบก่อน — ปิดแล้วเปิดใหม่ต้องไม่โชว์ของเก่าก่อนดึงใหม่
  const ready = Boolean(enabled && key) && state.loadedKey === fetchKey
  const loading = Boolean(enabled && key) && !ready

  // values: { zone_id, kind, latitude, longitude, note }
  const save = useCallback(async (values, id = null) => {
    const note = String(values.note ?? '').trim() || null
    const { data, error } = await supabase.rpc('adhoc_affected_save', {
      p_id: id,
      p_zone_id: values.zone_id,
      p_kind: values.kind,
      p_latitude: values.latitude,
      p_longitude: values.longitude,
      p_note: note,
    })
    if (error) return { error: friendlyAffectedError(error) }
    const row = { id: data, zone_id: values.zone_id, kind: values.kind, latitude: values.latitude, longitude: values.longitude, note }
    setState(prev => ({
      ...prev,
      points: id
        ? prev.points.map(p => (p.id === id ? { ...p, ...row, created_at: p.created_at } : p))
        : [...prev.points, { ...row, created_at: new Date().toISOString() }],
    }))
    return { error: null, id: data }
  }, [])

  const remove = useCallback(async id => {
    const { error } = await supabase.rpc('adhoc_affected_delete', { p_id: id })
    if (error) return { error: friendlyAffectedError(error) }
    setState(prev => ({ ...prev, points: prev.points.filter(p => p.id !== id) }))
    return { error: null }
  }, [])

  return { points: ready ? state.points : [], loading, error: ready ? state.error : null, save, remove }
}
