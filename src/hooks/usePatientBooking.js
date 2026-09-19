import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * โหลดข้อมูลและสั่งงานของระบบจองรถรับส่งผู้ป่วย ใช้ร่วมกันระหว่างหน้าประชาชนกับหน้าทำงานเจ้าหน้าที่
 *
 * หน้าประชาชนส่ง privateRpc = 'patient_booking_mine' (เฉพาะคำขอของตัวเอง)
 * หน้าทำงานส่ง 'patient_booking_workspace' (คิวทั้งหน่วยงานตามขอบเขตของบทบาท)
 * ⚠️ ห้ามให้หน้าประชาชนเรียก workspace — หน้านั้นไม่ได้ใช้คิวทั้งหน่วยงาน การโหลดมาแล้วซ่อนด้วย UI
 * ทำให้เส้นแบ่งสองฝั่งเหลือแค่การซ่อนบนหน้าจอ
 */
export default function usePatientBooking(tenantId, uid, privateRpc) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const sequence = useRef(0)
  const lockRef = useRef(false)
  const operations = useRef(new Map())
  const reload = useCallback(() => {
    if (!tenantId) return
    const generation = ++sequence.current
    return Promise.all([
      supabase.rpc('patient_booking_info', { p_muni: tenantId }),
      uid ? supabase.rpc(privateRpc, { p_muni: tenantId }) : Promise.resolve({ data: null }),
    ]).then(([publicResult, privateResult]) => {
      if (generation !== sequence.current) return
      if (publicResult.error || privateResult.error) throw publicResult.error || privateResult.error
      setData({ tenantId, uid, info: publicResult.data, workspace: privateResult.data })
      setError('')
    }).catch(e => {
      if (generation !== sequence.current) return
      setData(null)
      setError(['PGRST202', '42883'].includes(e.code) ? 'ระบบจองรถยังไม่พร้อมใช้งาน กรุณาติดต่อเจ้าหน้าที่' : `โหลดข้อมูลไม่สำเร็จ: ${e.message || 'กรุณาลองใหม่'}`)
    })
  }, [tenantId, uid, privateRpc])
  useEffect(() => {
    const requestSequence = sequence
    reload()
    const refresh = () => { if (document.visibilityState === 'visible' && !lockRef.current) reload() }
    // Visible session only; no new paid realtime service or background polling.
    const timer = uid ? window.setInterval(refresh, 60000) : null
    window.addEventListener('focus', refresh)
    return () => { requestSequence.current++; if (timer) clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [reload, uid])
  function op(key) { if (!operations.current.has(key)) operations.current.set(key, crypto.randomUUID()); return operations.current.get(key) }
  async function mutate(name, args, success, after) {
    if (lockRef.current) return false
    lockRef.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await supabase.rpc(name, { p_muni: tenantId, ...args })
      if (result.error) throw result.error
      setNotice(success)
      if (after) after(result.data)
      await reload()
      return true
    } catch (e) { if (e.message?.includes('เปลี่ยนแล้ว')) await reload(); setError(`ยังไม่ยืนยันผลสำเร็จ: ${e.message || 'เครือข่ายขัดข้อง กรุณาลองใหม่ด้วยรายการเดิม'}`); return false }
    finally { lockRef.current = false; setBusy(false) }
  }
  const current = data?.tenantId === tenantId && data?.uid === uid ? data : null
  return { current, info: current?.info, workspace: current?.workspace, error, setError, notice, setNotice, busy, setBusy, lockRef, reload, mutate, op }
}
