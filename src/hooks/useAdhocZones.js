import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { indexCounts, normalizeRadii } from '../lib/adhocZones'

// โหลด "วงรัศมีเรื่องเฉพาะกิจ" ของ อปท. ที่กำลังดูอยู่ + สิทธิ์ของผู้ใช้ + ตัวนับคำร้องในแต่ละวง
// และมีฟังก์ชันเพิ่ม/แก้/ปิดเรื่อง/ลบ — ตาราง adhoc_impact_zones (20261012120000/20261012120100)
//
// ฝั่งเจ้าหน้าที่เท่านั้น: enabled=false (แผนที่ประชาชน) ไม่ยิงอะไรเลย ทั้งที่ RLS ก็ไม่ให้ประชาชนอ่านอยู่แล้ว
// เพราะไม่ควรเสียคำขอเปล่า และไม่ให้ชื่อตาราง/ฟังก์ชันโผล่ใน network ของหน้าสาธารณะ
//
// สิทธิ์ตัดสินที่ DB เสมอ (RLS + can_manage_adhoc_overlay) — canManage ในนี้มีไว้ซ่อน/โชว์ปุ่มเท่านั้น
// ถ้า DB ปฏิเสธ (เช่น ผู้รับผิดชอบถูกมอบหมายใหม่ระหว่างที่หน้าเปิดค้าง) จะได้ข้อความไทยจาก friendlyError()

// UPDATE/DELETE ที่ RLS ปฏิเสธ "ไม่ error" แต่กระทบ 0 แถว — ต้องขอแถวที่โดนกลับมาแล้วเช็คเอง ไม่งั้นหน้าจอบอกว่าบันทึกแล้ว
// ทั้งที่ไม่มีอะไรเปลี่ยน (เช่น ผู้รับผิดชอบถูกมอบหมายใหม่ระหว่างที่หน้าเปิดค้างอยู่)
const NO_ROWS_MESSAGE = 'ไม่มีสิทธิ์แก้รายการนี้ หรือรายการถูกลบไปแล้ว — โหลดหน้าใหม่แล้วลองอีกครั้ง'

const EMPTY = { zones: [], counts: new Map(), canManage: false, categories: [], loading: false, error: null }

function friendlyError(error) {
  const code = error?.code
  const message = String(error?.message ?? '')
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'ไม่มีสิทธิ์ทำรายการนี้ (เฉพาะแอดมินและผู้รับผิดชอบเรื่องเฉพาะกิจ)'
  }
  if (code === '23514') return 'ค่ารัศมีหรือพิกัดไม่ถูกต้อง ตรวจสอบอีกครั้ง (รัศมี 50 ม. – 20 กม. ไม่เกิน 6 วง)'
  if (code === '42P01' || code === 'PGRST205') return 'ระบบวงรัศมียังไม่พร้อมใช้งานในฐานข้อมูลนี้'
  return message || 'บันทึกไม่สำเร็จ'
}

export default function useAdhocZones({ tenantId, enabled }) {
  const [state, setState] = useState(() => ({ ...EMPTY, loading: Boolean(enabled && tenantId) }))
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion(v => v + 1), [])

  useEffect(() => {
    if (!enabled || !tenantId) return undefined
    let active = true

    ;(async () => {
      const [zonesRes, manageRes, categoriesRes] = await Promise.all([
        supabase.from('adhoc_impact_zones')
          .select('id, municipality_id, category, label, source_entry_id, latitude, longitude, radii_m, is_active, created_at, updated_at')
          .eq('municipality_id', tenantId)
          .order('created_at', { ascending: false }),
        supabase.rpc('can_manage_adhoc_overlay', { p_municipality_id: tenantId }),
        supabase.from('complaint_categories')
          .select('value, label, emoji, sort_order')
          .eq('municipality_id', tenantId)
          .eq('is_adhoc', true)
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
      ])
      if (!active) return

      if (zonesRes.error) {
        // ตารางยังไม่มี/ไม่มีสิทธิ์อ่าน → ถือว่าไม่มีวงรัศมี ไม่ทำให้แผนที่ทั้งหน้าพัง
        console.error('adhoc_impact_zones:', zonesRes.error.message)
        setState({ ...EMPTY, error: friendlyError(zonesRes.error) })
        return
      }

      const zones = zonesRes.data ?? []
      const activeIds = zones.filter(z => z.is_active).map(z => z.id)
      let counts = new Map()
      if (activeIds.length > 0) {
        const countRes = await supabase.rpc('adhoc_zone_counts', { p_zone_ids: activeIds })
        if (!active) return
        if (countRes.error) console.error('adhoc_zone_counts:', countRes.error.message)
        else counts = indexCounts(countRes.data)
      }

      setState({
        zones,
        counts,
        canManage: manageRes.data === true,
        categories: categoriesRes.data ?? [],
        loading: false,
        error: null,
      })
    })()

    return () => { active = false }
  }, [enabled, tenantId, version])

  // values: { category, label, latitude, longitude, radii_m, source_entry_id }
  const saveZone = useCallback(async (values, id = null) => {
    const payload = {
      category: values.category,
      label: String(values.label ?? '').trim(),
      latitude: values.latitude,
      longitude: values.longitude,
      radii_m: normalizeRadii(values.radii_m),
      source_entry_id: values.source_entry_id ?? null,
    }
    const { data, error } = id
      ? await supabase.from('adhoc_impact_zones').update(payload).eq('id', id).select('id')
      : await supabase.from('adhoc_impact_zones').insert({ ...payload, municipality_id: tenantId }).select('id')
    if (error) return { error: friendlyError(error) }
    if (!data?.length) return { error: NO_ROWS_MESSAGE }
    reload()
    return { error: null }
  }, [tenantId, reload])

  const setZoneActive = useCallback(async (id, isActive) => {
    const { data, error } = await supabase.from('adhoc_impact_zones').update({ is_active: isActive }).eq('id', id).select('id')
    if (error) return { error: friendlyError(error) }
    if (!data?.length) return { error: NO_ROWS_MESSAGE }
    reload()
    return { error: null }
  }, [reload])

  const deleteZone = useCallback(async id => {
    const { data, error } = await supabase.from('adhoc_impact_zones').delete().eq('id', id).select('id')
    if (error) return { error: friendlyError(error) }
    if (!data?.length) return { error: NO_ROWS_MESSAGE }
    reload()
    return { error: null }
  }, [reload])

  const effective = enabled && tenantId ? state : EMPTY
  return { ...effective, reload, saveZone, setZoneActive, deleteZone }
}
