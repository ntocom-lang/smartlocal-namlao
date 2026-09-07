import { useState, useEffect } from 'react'
import { Plus, X, Store, Pencil, RotateCcw, Ban } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { logAction } from '../../lib/auditLog'
import FleetEmptyState from './FleetEmptyState'
import { normalizeTaxId } from '../../lib/fleetVendors'

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'

const EMPTY = { name: '', tax_id: '', branch: '', phone: '', address: '', notes: '' }

export default function FleetVendors({ tenant, canWrite }) {
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  function load() {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('fleet_vendors').select('*')
      .eq('municipality_id', tenant.id)
      .order('is_active', { ascending: false })
      .order('name')
      .then(({ data, error }) => {
        if (error) console.error('fleet_vendors SELECT error:', error)
        setVendors(data ?? [])
      })
      .finally(() => setLoading(false))
  }

  // load เป็นค่าคงที่ต่อ render ไม่ต้องอยู่ใน dependency array (แนวเดียวกับ FleetFuelLog)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { queueMicrotask(load) }, [tenant?.id])

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  function openNew() {
    setEditingId(null)
    setForm(EMPTY)
    setModal(true)
  }

  function openEdit(v) {
    setEditingId(v.id)
    setForm({
      name: v.name ?? '', tax_id: v.tax_id ?? '', branch: v.branch ?? '',
      phone: v.phone ?? '', address: v.address ?? '', notes: v.notes ?? '',
    })
    setModal(true)
  }

  async function save() {
    const name = form.name.trim()
    if (!name) return alert('กรุณากรอกชื่อผู้ขายตามใบกำกับภาษี')
    if (name.length > 200) return alert('ชื่อผู้ขายยาวเกิน 200 ตัวอักษร')
    const taxId = normalizeTaxId(form.tax_id)
    if (taxId && taxId.length !== 13)
      return alert('เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก (กรอกให้ครบ 13 หลัก หรือเว้นว่างถ้าผู้ขายไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม)')
    const branch = form.branch.trim()
    if (branch.length > 30) return alert('สาขายาวเกิน 30 ตัวอักษร')

    setSaving(true)
    const payload = {
      name, tax_id: taxId || null, branch: branch || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    }
    const { error } = editingId
      ? await supabase.from('fleet_vendors').update(payload).eq('id', editingId)
      : await supabase.from('fleet_vendors').insert({ ...payload, municipality_id: tenant.id })
    setSaving(false)

    if (error) {
      // unique index กันผู้ขายซ้ำ (เลขผู้เสียภาษี + สาขาเดียวกัน) — ข้อความดิบอ่านไม่รู้เรื่อง
      if (error.code === '23505') return alert('มีผู้ขายรายนี้ (เลขผู้เสียภาษีและสาขาเดียวกัน) ในทะเบียนแล้ว')
      return alert('บันทึกไม่สำเร็จ: ' + error.message)
    }
    logAction({
      action: editingId ? 'update' : 'create', resourceType: 'fleet_vendor',
      resourceId: editingId ?? undefined, resourceLabel: name, municipalityId: tenant.id,
    })
    setModal(false)
    load()
  }

  // ห้ามลบทิ้ง บันทึกการเติมน้ำมันเก่ายังอ้าง vendor_id อยู่ ปิดใช้งานแทนแล้วกู้คืนได้
  async function toggleActive(v) {
    const next = !v.is_active
    if (!confirm(next ? `เปิดใช้งาน "${v.name}" อีกครั้ง?` : `ปิดใช้งาน "${v.name}"? รายการเดิมที่อ้างผู้ขายรายนี้ยังอยู่ครบ`)) return
    const { error } = await supabase.from('fleet_vendors').update({ is_active: next }).eq('id', v.id)
    if (error) return alert('ทำรายการไม่สำเร็จ: ' + error.message)
    logAction({
      action: next ? 'restore' : 'archive', resourceType: 'fleet_vendor',
      resourceId: v.id, resourceLabel: v.name, municipalityId: tenant.id,
    })
    load()
  }

  const shown = showInactive ? vendors : vendors.filter(v => v.is_active)
  const inactiveCount = vendors.filter(v => !v.is_active).length

  if (loading) return (
    <div className="flex justify-center py-8">
      <div className="w-5 h-5 border-4 border-gray-200 rounded-full animate-spin"
           style={{ borderTopColor: 'var(--color-primary)' }} />
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-700">
        กรอก <strong>ชื่อนิติบุคคลตามใบกำกับภาษี</strong> ไม่ใช่ชื่อแบรนด์ — เช่น
        “บริษัท พลกฤตเซอร์วิสเอ็นเนอร์ยี่ จำกัด” ไม่ใช่ “ปตท.” เพราะผู้ตรวจสอบเทียบกับคู่สัญญาในใบกำกับภาษี
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] md:text-xs font-bold text-gray-500 uppercase tracking-wide">
          ผู้ขาย/ปั๊ม <span className="text-gray-400 normal-case">({shown.length})</span>
        </p>
        <div className="flex items-center gap-2">
          {inactiveCount > 0 && (
            <button onClick={() => setShowInactive(s => !s)}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200">
              {showInactive ? 'ซ่อนที่ปิดใช้งาน' : `แสดงที่ปิดใช้งาน (${inactiveCount})`}
            </button>
          )}
          {canWrite && (
            <button onClick={openNew}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              <Plus size={13} /> เพิ่มผู้ขาย
            </button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <FleetEmptyState icon={Store} title="ยังไม่มีผู้ขายในทะเบียน"
          hint={canWrite
            ? <>กด <strong className="text-gray-500">เพิ่มผู้ขาย</strong> เพื่อตั้งค่าก่อนบันทึกเชื้อเพลิง</>
            : 'ให้ผู้ดูแลระบบยานพาหนะเป็นผู้ตั้งค่า'} />
      ) : (
        <div className="space-y-1.5">
          {shown.map(v => (
            <div key={v.id}
              className={`bg-white rounded-xl border p-3 flex items-start justify-between gap-3 ${
                v.is_active ? 'border-gray-200' : 'border-gray-200 bg-gray-50 opacity-70'}`}>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-800 truncate">
                  {v.name}
                  {!v.is_active && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500">ปิดใช้งาน</span>}
                </p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {v.tax_id ? `เลขผู้เสียภาษี ${v.tax_id}` : 'ไม่มีเลขผู้เสียภาษี'}
                  {v.branch ? ` · สาขา ${v.branch}` : ''}
                  {v.phone ? ` · โทร ${v.phone}` : ''}
                </p>
                {v.address && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{v.address}</p>}
              </div>
              {canWrite && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => openEdit(v)} title="แก้ไข"
                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><Pencil size={14} /></button>
                  <button onClick={() => toggleActive(v)} title={v.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                    className={`p-1.5 rounded-lg ${v.is_active ? 'text-gray-400 hover:bg-gray-100' : 'text-emerald-600 hover:bg-emerald-50'}`}>
                    {v.is_active ? <Ban size={14} /> : <RotateCcw size={14} />}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-black text-gray-800">
                {editingId ? 'แก้ไขผู้ขาย' : 'เพิ่มผู้ขาย'}
              </h2>
              <button onClick={() => setModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <div className="overflow-y-auto p-5 space-y-3 flex-1">
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">ชื่อผู้ขายตามใบกำกับภาษี *</label>
                <input value={form.name} onChange={set('name')}
                  placeholder="เช่น บริษัท พลกฤตเซอร์วิสเอ็นเนอร์ยี่ จำกัด" className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขประจำตัวผู้เสียภาษี</label>
                  <input value={form.tax_id} onChange={set('tax_id')} inputMode="numeric"
                    placeholder="0545550000062" className={inp} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">สาขา</label>
                  <input value={form.branch} onChange={set('branch')}
                    placeholder="00001 หรือ สำนักงานใหญ่" className={inp} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">โทรศัพท์</label>
                <input value={form.phone} onChange={set('phone')} placeholder="081-234-5678" className={inp} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">ที่อยู่</label>
                <input value={form.address} onChange={set('address')}
                  placeholder="302/3 หมู่ 6 ต.ร้องเข็ม อ.ร้องกวาง จ.แพร่ 54140" className={inp} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">หมายเหตุ</label>
                <input value={form.notes} onChange={set('notes')} className={inp} />
              </div>
            </div>
            <div className="px-5 pb-5 pt-3 border-t border-gray-100">
              <button onClick={save} disabled={saving}
                className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
