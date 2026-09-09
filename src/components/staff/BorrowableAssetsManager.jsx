import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, Loader2, Package, PackageOpen, Pencil, Plus, Trash2, X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-transparent'

// หน่วยนับที่ อปท. ใช้จริงกับของที่เปิดให้ยืม — เลือกจากลิสต์ได้ หรือพิมพ์เองก็ได้
// (ช่องเป็น input + datalist ไม่ใช่ select เพราะของบางอย่างมีหน่วยเฉพาะ เช่น "ผืน" "ชุด")
const UNIT_SUGGESTIONS = ['ชิ้น', 'ตัว', 'ชุด', 'หลัง', 'อัน', 'ผืน', 'เครื่อง', 'คัน', 'ใบ']

const EMPTY_FORM = {
  department_id: '',
  asset_code: '',
  name: '',
  unit: 'ชิ้น',
  total_quantity: '1',
  is_public_borrowable: false,
  notes: '',
}

/**
 * ทะเบียนพัสดุ/ครุภัณฑ์ที่เปิดให้ยืม — ต้นทางของรายการที่ผู้ยืมเลือกได้ในแบบคำขอ
 * และเป็นที่มาของช่อง "เลขที่หรือรหัส / รายการ / จำนวน" บนใบ บย.
 *
 * ⚠️ ช่อง "ให้ประชาชนยืมได้" คือสวิตช์เดียวที่ตัดสินว่าประชาชนทั่วไปเห็นของชิ้นนั้นหรือไม่
 * ไม่ติ๊ก = ไม่ปรากฏในหน้าประชาชนเลย แม้แต่ชื่อ (บังคับด้วย RLS ฝั่งฐานข้อมูล ไม่ใช่แค่ซ่อน UI)
 * ครุภัณฑ์มูลค่าสูงจึงไม่ต้องเปิดเผยรหัสและจำนวนต่อสาธารณะ
 *
 * ⚠️ ระบบไม่ตัดจำนวนของที่สูญหายออกจากทะเบียนให้อัตโนมัติ — การจำหน่ายพัสดุออกจากทะเบียน
 * ต้องผ่านการสอบข้อเท็จจริงและขั้นตอนตามระเบียบพัสดุก่อน ไม่ใช่ผลของการกดปุ่มในระบบ
 * หน้านี้จึงขึ้นแบนเนอร์เตือนรายการที่มีของหายค้างอยู่แทน ให้เจ้าหน้าที่ไปลดจำนวนเอง
 * แล้วกด "ปรับทะเบียนแล้ว" เพื่อปิดการเตือน
 *
 * สิทธิ์: คุมด้วย profiles.asset_role ที่แอดมินมอบให้เป็นรายคน ไม่ใช่ role หลัก
 *   asset_admin  — ทุกกองใน อปท. รวมของที่ยังไม่ผูกกอง (admin/superadmin ได้ระดับนี้อัตโนมัติ)
 *   asset_staff  — เฉพาะของในกองตัวเอง
 *   asset_viewer — อ่านอย่างเดียว
 * หน้าจอปิดปุ่มที่ทำไม่ได้ให้ล่วงหน้า แต่ตัวบังคับจริงคือ RLS ฝั่งฐานข้อมูล (asset_can_manage)
 * ไม่ใช่การซ่อนปุ่ม — ปิด UI อย่างเดียวกันคนที่เปิด devtools ไม่ได้
 */
export default function BorrowableAssetsManager({ tenant, assetRole, myDepartmentId }) {
  const isManager = assetRole === 'asset_admin'
  const canWrite = isManager || assetRole === 'asset_staff'
  // asset_staff แก้ได้เฉพาะกองตัวเอง ของที่ยังไม่ผูกกอง (department_id = null) เป็นของ
  // ผู้ดูแลระดับ อปท. เท่านั้น ไม่งั้นเจ้าหน้าที่กองไหนก็ยึดของกลางไปเป็นของกองตัวเองได้
  const canEditAsset = useCallback(
    asset => isManager
      || (assetRole === 'asset_staff' && asset.department_id
          && asset.department_id === myDepartmentId),
    [isManager, assetRole, myDepartmentId],
  )
  const [departments, setDepartments] = useState([])
  const [assets, setAssets] = useState([])
  const [losses, setLosses] = useState([])
  const [loading, setLoading] = useState(true)
  // ⚠️ ต้องแยก "โหลดไม่สำเร็จ" ออกจาก "ทะเบียนว่างจริง" — สองอย่างนี้เคยแสดงผลเหมือนกันเป๊ะ
  // เพราะเขียน `data ?? []` แล้วกลืน error ทิ้ง เจ้าหน้าที่ที่เจอจอว่างตอนเน็ตมีปัญหาจะเข้าใจว่า
  // ข้อมูลในทะเบียนหายไปทั้งหมด แล้วกรอกซ้ำใหม่ทับของเดิม
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true)
    const [deptRes, assetRes] = await Promise.all([
      supabase.from('departments')
        .select('id, name, short_name')
        .eq('municipality_id', tenant.id).eq('is_active', true).order('sort_order'),
      supabase.from('borrowable_assets')
        .select('id, department_id, asset_code, name, unit, total_quantity, is_public_borrowable, notes, is_active, losses_adjusted_at')
        .eq('municipality_id', tenant.id).order('name'),
    ])
    if (assetRes.error) {
      setLoadError(assetRes.error.message)
      setLoading(false)
      return
    }
    setLoadError('')
    setDepartments(deptRes.data ?? [])
    setAssets(assetRes.data ?? [])

    // รายการที่มีของสูญหาย — ต้องรู้ "เมื่อไหร่" ด้วย เพื่อเทียบกับ losses_adjusted_at
    // ระบุชื่อ FK ให้ชัด: PostgREST เลือกความสัมพันธ์ไม่ถูกถ้ามีเส้นเชื่อมมากกว่าหนึ่ง
    const { data: lossRows } = await supabase.from('asset_borrow_items')
      .select('asset_id, lost_qty, request:asset_borrow_requests!asset_borrow_items_request_id_fkey(returned_at, settled_at)')
      .eq('municipality_id', tenant.id)
      .gt('lost_qty', 0)
    setLosses(lossRows ?? [])
    setLoading(false)
  }, [tenant?.id])

  useEffect(() => { load() }, [load])

  const deptName = useCallback(
    id => departments.find(d => d.id === id)?.name ?? 'ไม่ระบุกอง',
    [departments],
  )

  // ของหายที่ยังไม่ได้ปรับทะเบียน = เกิดหลังหมุดเวลาที่เจ้าหน้าที่กดยืนยันครั้งล่าสุด
  const pendingLosses = useMemo(() => {
    const byAsset = new Map()
    for (const row of losses) {
      const asset = assets.find(a => a.id === row.asset_id)
      if (!asset) continue
      const at = row.request?.settled_at ?? row.request?.returned_at
      if (!at) continue
      // ⚠️ ต้องแปลงเป็น Date ก่อนเทียบ ห้ามเทียบสตริงตรงๆ — PostgREST คืน "…+00:00"
      // แต่ toISOString() ของเบราว์เซอร์ให้ "….000Z" เวลาเดียวกันเป๊ะแต่เรียงสตริงกลับด้าน
      // ('+' < '.') ทำให้ของที่เคลียร์ไปแล้วโผล่เตือนซ้ำ
      if (asset.losses_adjusted_at
          && new Date(at) <= new Date(asset.losses_adjusted_at)) continue
      const current = byAsset.get(asset.id) ?? { asset, qty: 0 }
      current.qty += row.lost_qty
      byAsset.set(asset.id, current)
    }
    return [...byAsset.values()]
  }, [losses, assets])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const asset of assets) {
      const key = asset.department_id ?? '__none__'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(asset)
    }
    return [...map.entries()].map(([key, items]) => ({
      key,
      label: key === '__none__' ? 'ไม่ระบุกอง' : deptName(key),
      items,
    }))
  }, [assets, deptName])

  const set = key => event => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm(current => ({ ...current, [key]: value }))
  }

  function startAdd() {
    // asset_staff เพิ่มของเข้ากองตัวเองได้อย่างเดียว เติมให้ล่วงหน้าแล้วล็อกช่องไว้
    // ถ้าปล่อยว่างให้เลือกเอง จะกรอกครบทั้งฟอร์มแล้วโดนฐานข้อมูลปฏิเสธตอนกดบันทึก
    setForm(isManager ? EMPTY_FORM : { ...EMPTY_FORM, department_id: myDepartmentId ?? '' })
    setEditId(null)
    setShowForm(true)
  }

  function startEdit(asset) {
    setForm({
      department_id: asset.department_id ?? '',
      asset_code: asset.asset_code ?? '',
      name: asset.name,
      unit: asset.unit,
      total_quantity: String(asset.total_quantity),
      is_public_borrowable: asset.is_public_borrowable,
      notes: asset.notes ?? '',
    })
    setEditId(asset.id)
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditId(null)
    setForm(EMPTY_FORM)
  }

  async function handleSave() {
    const name = form.name.trim()
    if (!name) return alert('กรุณากรอกชื่อพัสดุ/ครุภัณฑ์')
    const quantity = Number.parseInt(form.total_quantity, 10)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
      return alert('จำนวนทั้งหมดต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 9999')
    }
    if (!form.unit.trim()) return alert('กรุณาระบุหน่วยนับ')

    setSaving(true)
    const payload = {
      department_id: form.department_id || null,
      asset_code: form.asset_code.trim() || null,
      name,
      unit: form.unit.trim(),
      total_quantity: quantity,
      is_public_borrowable: form.is_public_borrowable,
      notes: form.notes.trim() || null,
    }

    const { error } = editId
      ? await supabase.from('borrowable_assets').update(payload).eq('id', editId)
      : await supabase.from('borrowable_assets').insert({ ...payload, municipality_id: tenant.id })

    setSaving(false)
    if (error) {
      // 23505 = ชนดัชนีรหัสครุภัณฑ์ซ้ำ ซึ่งเป็นข้อผิดพลาดที่ผู้ใช้แก้เองได้ ต้องบอกให้ตรง
      alert(error.code === '23505'
        ? `รหัสครุภัณฑ์ "${payload.asset_code}" มีอยู่แล้วในทะเบียน กรุณาใช้รหัสอื่น`
        : `บันทึกไม่สำเร็จ: ${error.message}`)
      return
    }
    closeForm()
    load()
  }

  async function toggleActive(asset) {
    setBusyId(asset.id)
    const { error } = await supabase.from('borrowable_assets')
      .update({ is_active: !asset.is_active }).eq('id', asset.id)
    setBusyId(null)
    if (error) return alert(`เปลี่ยนสถานะไม่สำเร็จ: ${error.message}`)
    setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, is_active: !a.is_active } : a))
  }

  async function togglePublic(asset) {
    setBusyId(asset.id)
    const { error } = await supabase.from('borrowable_assets')
      .update({ is_public_borrowable: !asset.is_public_borrowable }).eq('id', asset.id)
    setBusyId(null)
    if (error) return alert(`เปลี่ยนสิทธิ์การยืมไม่สำเร็จ: ${error.message}`)
    setAssets(prev => prev.map(a =>
      a.id === asset.id ? { ...a, is_public_borrowable: !a.is_public_borrowable } : a))
  }

  async function markLossesAdjusted(asset) {
    if (!confirm(
      `ยืนยันว่าได้ปรับจำนวนใน "${asset.name}" ตามผลการจำหน่ายพัสดุเรียบร้อยแล้ว?\n\n`
      + 'ระบบจะหยุดเตือนเรื่องของสูญหายของรายการนี้ จนกว่าจะมีรายงานสูญหายครั้งใหม่',
    )) return
    setBusyId(asset.id)
    const now = new Date().toISOString()
    const { error } = await supabase.from('borrowable_assets')
      .update({ losses_adjusted_at: now }).eq('id', asset.id)
    setBusyId(null)
    if (error) return alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, losses_adjusted_at: now } : a))
  }

  async function handleDelete(asset) {
    if (!confirm(
      `ลบ "${asset.name}" ออกจากทะเบียน?\n\n`
      + 'ถ้าเคยมีคนยืมของชิ้นนี้ ระบบจะไม่ยอมให้ลบ เพราะประวัติการยืมยังอ้างถึงอยู่\n'
      + 'กรณีนั้นให้ใช้ปุ่ม "ปิดการให้ยืม" แทน',
    )) return
    setBusyId(asset.id)
    const { error } = await supabase.from('borrowable_assets').delete().eq('id', asset.id)
    setBusyId(null)
    if (error) {
      // 23503 = FK RESTRICT จาก asset_borrow_items — ตั้งใจให้ลบไม่ได้ ประวัติการยืมต้องอ่านย้อนหลังได้
      alert(error.code === '23503'
        ? `ลบ "${asset.name}" ไม่ได้ เพราะมีประวัติการยืมอ้างถึงอยู่\nให้ใช้ปุ่ม "ปิดการให้ยืม" แทน ของจะหายจากรายการที่ยืมได้ แต่ประวัติเดิมยังอยู่ครบ`
        : `ลบไม่สำเร็จ: ${error.message}`)
      return
    }
    setAssets(prev => prev.filter(a => a.id !== asset.id))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">ทะเบียนของให้ยืม</h2>
          <p className="text-xs text-gray-500">
            พัสดุ/ครุภัณฑ์ที่เปิดให้ยืม ใช้เป็นตัวเลือกในแบบคำขอและรายการบนใบ บย.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
            {isManager ? 'ดูแลได้ทุกกอง' : assetRole === 'asset_staff' ? 'ดูแลเฉพาะกองของท่าน' : 'อ่านอย่างเดียว'}
          </span>
          {canWrite && (
            <button onClick={startAdd}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700">
              <Plus size={16} /> เพิ่มรายการ
            </button>
          )}
        </div>
      </div>

      {pendingLosses.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-900">มีรายงานของสูญหายที่ยังไม่ได้ปรับทะเบียน</p>
              <p className="mt-1 text-xs text-amber-800">
                ระบบไม่ลดจำนวนให้อัตโนมัติ เพราะการจำหน่ายพัสดุออกจากทะเบียนต้องผ่านการสอบข้อเท็จจริง
                และดำเนินการตามระเบียบพัสดุก่อน — จนกว่าจะปรับ ระบบจะยังนับของจำนวนนี้ว่าว่างให้ยืมอยู่
              </p>
              <ul className="mt-2 space-y-2">
                {pendingLosses.map(({ asset, qty }) => (
                  <li key={asset.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
                    <span className="font-semibold">{asset.name}</span>
                    <span>สูญหาย {qty} {asset.unit} (ทะเบียนยังระบุ {asset.total_quantity} {asset.unit})</span>
                    <button onClick={() => markLossesAdjusted(asset)}
                      disabled={busyId === asset.id || !canEditAsset(asset)}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
                      <Check size={13} /> ปรับทะเบียนแล้ว
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">
              {editId ? 'แก้ไขรายการ' : 'เพิ่มรายการใหม่'}
            </h3>
            <button onClick={closeForm} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100">
              <X size={18} />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-gray-500">
                ชื่อพัสดุ/ครุภัณฑ์ <span className="text-rose-600">*</span>
              </span>
              <input className={inp} value={form.name} onChange={set('name')} maxLength={200}
                placeholder="เช่น เต็นท์ผ้าใบ ขนาด 4x8 เมตร" />
            </label>

            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">กองเจ้าของพัสดุ</span>
              <select className={inp} value={form.department_id} onChange={set('department_id')}
                disabled={!isManager}>
                {isManager && <option value="">— ไม่ระบุกอง —</option>}
                {(isManager ? departments : departments.filter(d => d.id === myDepartmentId))
                  .map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              {/* กองนี้คือช่อง "ไปจากส่วนราชการ" บนใบ บย. และเป็นกองที่คำขอจะวิ่งไปหา
                  ไม่ระบุกอง = คำขอตกไปที่งานพัสดุตามผังงานปกติ */}
              <span className="mt-1 block text-[11px] text-gray-400">
                แสดงเป็น &quot;ส่วนราชการ&quot; บนใบยืม และเป็นกองที่ต้องจ่าย/รับของคืน
              </span>
            </label>

            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">เลขที่หรือรหัสครุภัณฑ์</span>
              <input className={inp} value={form.asset_code} onChange={set('asset_code')} maxLength={60}
                placeholder="ปล่อยว่างได้ถ้าไม่มีรหัส" />
            </label>

            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">
                จำนวนทั้งหมด <span className="text-rose-600">*</span>
              </span>
              <input className={inp} type="number" inputMode="numeric" min="1" max="9999"
                value={form.total_quantity} onChange={set('total_quantity')} />
            </label>

            <label>
              <span className="mb-1 block text-xs font-semibold text-gray-500">
                หน่วยนับ <span className="text-rose-600">*</span>
              </span>
              <input className={inp} value={form.unit} onChange={set('unit')} maxLength={30}
                list="borrowable-unit-options" />
              <datalist id="borrowable-unit-options">
                {UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}
              </datalist>
            </label>

            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-gray-500">หมายเหตุ</span>
              <input className={inp} value={form.notes} onChange={set('notes')}
                placeholder="เช่น ต้องมารับเองที่ที่ทำการ ไม่มีบริการขนส่ง" />
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-gray-200 p-3 sm:col-span-2">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-sky-600"
                checked={form.is_public_borrowable} onChange={set('is_public_borrowable')} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900">ให้ประชาชนทั่วไปยืมได้</span>
                <span className="block text-xs text-gray-500">
                  ไม่ติ๊ก = ประชาชนไม่เห็นรายการนี้เลยแม้แต่ชื่อ ยืมได้เฉพาะบุคลากรหรือผ่านเจ้าหน้าที่รับเรื่องแทน
                  — ครุภัณฑ์มูลค่าสูงไม่ควรติ๊ก
                </span>
              </span>
            </label>
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              {editId ? 'บันทึกการแก้ไข' : 'เพิ่มเข้าทะเบียน'}
            </button>
            <button onClick={closeForm}
              className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-600 hover:bg-gray-50">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {loadError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
          <AlertTriangle size={30} className="mx-auto text-rose-500" />
          <p className="mt-2 text-sm font-semibold text-rose-900">โหลดทะเบียนไม่สำเร็จ</p>
          <p className="mt-1 text-xs text-rose-700">{loadError}</p>
          <p className="mt-2 text-xs text-rose-800">
            นี่ไม่ใช่ทะเบียนว่าง — ข้อมูลเดิมยังอยู่ ห้ามกรอกใหม่ทับ ให้ลองโหลดอีกครั้งก่อน
          </p>
          <button onClick={load}
            className="mt-3 min-h-[44px] rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-700">
            ลองใหม่
          </button>
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-12 text-center">
          <PackageOpen size={32} className="mx-auto text-gray-300" />
          <p className="mt-2 text-sm font-semibold text-gray-500">ยังไม่มีของในทะเบียน</p>
          <p className="mt-1 text-xs text-gray-400">
            {canWrite
              ? 'เพิ่มของที่ อปท. เปิดให้ยืม เช่น เต็นท์ โต๊ะ เก้าอี้ เครื่องเสียง'
              : 'ท่านมีสิทธิ์อ่านอย่างเดียว ให้เจ้าหน้าที่พัสดุของแต่ละกองเป็นผู้เพิ่มรายการ'}
          </p>
        </div>
      ) : (
        grouped.map(group => (
          <div key={group.key} className="rounded-2xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <h3 className="text-sm font-bold text-gray-900">{group.label}</h3>
              <p className="text-[11px] text-gray-400">{group.items.length} รายการ</p>
            </div>
            <ul className="divide-y divide-gray-100">
              {group.items.map(asset => (
                <li key={asset.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Package size={15} className="shrink-0 text-gray-400" />
                        <span className={`text-sm font-semibold ${asset.is_active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                          {asset.name}
                        </span>
                        {asset.asset_code && (
                          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                            {asset.asset_code}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        ทั้งหมด {asset.total_quantity} {asset.unit}
                        {asset.notes && ` · ${asset.notes}`}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button onClick={() => togglePublic(asset)}
                          disabled={busyId === asset.id || !canEditAsset(asset)}
                          className={`min-h-[40px] rounded-lg px-3 text-[11px] font-semibold disabled:opacity-50 ${
                            asset.is_public_borrowable
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}>
                          {asset.is_public_borrowable ? 'ประชาชนยืมได้' : 'เฉพาะภายใน'}
                        </button>
                        <button onClick={() => toggleActive(asset)}
                          disabled={busyId === asset.id || !canEditAsset(asset)}
                          className={`min-h-[40px] rounded-lg px-3 text-[11px] font-semibold disabled:opacity-50 ${
                            asset.is_active
                              ? 'bg-sky-50 text-sky-700 hover:bg-sky-100'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}>
                          {asset.is_active ? 'เปิดให้ยืม' : 'ปิดการให้ยืม'}
                        </button>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => startEdit(asset)} disabled={!canEditAsset(asset)}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 disabled:hover:bg-transparent"
                        aria-label={`แก้ไข ${asset.name}`}>
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => handleDelete(asset)}
                        disabled={busyId === asset.id || !canEditAsset(asset)}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 disabled:hover:bg-transparent"
                        aria-label={`ลบ ${asset.name}`}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
