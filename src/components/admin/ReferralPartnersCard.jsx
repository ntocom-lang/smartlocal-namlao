import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Plus, Save } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { PATIENT_TRANSPORT_TYPE } from '../../lib/patientTransport'

const inputCls = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm'
const EMPTY = { name: '', recipient_title: '', address: '', phone: '', min_lead_days: '3', is_active: true }

/**
 * ทะเบียนหน่วยงานรับเรื่องต่อ (referral_partners) — ตอนนี้ใช้กับคำขอรถรับ-ส่งผู้ป่วยอย่างเดียว
 *
 * อยู่ฝั่งแอดมินตามกติกา 3 ส่วน: เป็นการตั้งค่า ไม่ใช่งานประจำวัน
 * RLS ให้เฉพาะแอดมินของ อปท. เขียนได้ (20260910100100) — หัวหน้ากองแก้ไม่ได้โดยตั้งใจ
 * เพราะชื่อหน่วยงานในนี้คือผู้รับข้อมูลสุขภาพของประชาชน
 *
 * ไม่มีปุ่มลบ — คำขอเก่าอ้าง partner_id อยู่ (FK RESTRICT) เลิกใช้ให้ปิดสวิตช์ "เปิดรับเรื่อง"
 */
export default function ReferralPartnersCard({ tenant }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  // reloadKey แทนการเรียก load() ตรงๆ ใน effect — กติกา react-hooks/set-state-in-effect ของโปรเจกต์นี้
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!tenant?.id) return undefined
    let cancelled = false
    supabase.from('referral_partners')
      .select('id, name, recipient_title, address, phone, min_lead_days, is_active')
      .eq('municipality_id', tenant.id)
      .contains('document_types', [PATIENT_TRANSPORT_TYPE])
      .order('name')
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) {
          setError(`โหลดทะเบียนหน่วยงานไม่สำเร็จ: ${loadError.message}`)
        } else {
          setError('')
          setRows(data ?? [])
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [tenant?.id, reloadKey])

  const set = key => event => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setEditing(current => ({ ...current, [key]: value }))
  }

  const leadDays = Number(editing?.min_lead_days)
  const canSave = Boolean(
    editing
    && editing.name.trim()
    && editing.recipient_title.trim()
    && Number.isInteger(leadDays) && leadDays >= 0 && leadDays <= 30,
  )

  async function handleSave() {
    if (!canSave || saving) return
    setSaving(true)
    setError('')
    setJustSaved(false)
    const payload = {
      name: editing.name.trim(),
      recipient_title: editing.recipient_title.trim(),
      address: editing.address.trim() || null,
      phone: editing.phone.trim() || null,
      min_lead_days: leadDays,
      is_active: editing.is_active,
    }
    const { error: saveError } = editing.id
      ? await supabase.from('referral_partners').update(payload).eq('id', editing.id)
      : await supabase.from('referral_partners').insert({
        ...payload,
        municipality_id: tenant.id,
        document_types: [PATIENT_TRANSPORT_TYPE],
      })
    setSaving(false)
    if (saveError) {
      setError(saveError.code === '23505'
        ? 'มีหน่วยงานชื่อนี้อยู่แล้ว'
        : `บันทึกไม่สำเร็จ: ${saveError.message}`)
      return
    }
    setEditing(null)
    setJustSaved(true)
    setReloadKey(k => k + 1)
  }

  const activeCount = rows.filter(row => row.is_active).length

  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-800">🚑 หน่วยงานรับเรื่องต่อ — รถรับ-ส่งผู้ป่วย</p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500">
            มีหน่วยงานที่เปิดรับเรื่องอย่างน้อย 1 แห่ง ประชาชนจึงจะเห็นบริการ “ขออนุเคราะห์รถรับ-ส่งผู้ป่วย”
            ({activeCount > 0 ? `เปิดอยู่ ${activeCount} แห่ง` : 'ตอนนี้ยังไม่แสดง'})
          </p>
        </div>
        {!editing && (
          <button type="button" onClick={() => { setJustSaved(false); setEditing({ ...EMPTY }) }}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gray-800 px-3 py-2 text-xs font-semibold text-white">
            <Plus size={14} /> เพิ่มหน่วยงาน
          </button>
        )}
      </div>

      {/* ⚠️ ความเห็นเชิงวิชาชีพ: หน่วยงานปลายทางไม่ใช่ส่วนราชการ ควรมีข้อตกลงการใช้ข้อมูลก่อนเปิดรับ */}
      <div className="rounded-xl bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
        ชื่อหน่วยงานจะแสดงในข้อความขอความยินยอมของประชาชน ต้องตรงกับผู้รับข้อมูลจริง
        และควรทำบันทึกข้อตกลงการใช้ข้อมูลส่วนบุคคลกับหน่วยงานนั้นก่อนเปิดรับเรื่อง
        เพราะข้อมูลที่ส่งไปเป็นข้อมูลสุขภาพ
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
          <AlertCircle size={14} /> {error}
        </p>
      )}
      {!error && justSaved && !editing && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
          <CheckCircle2 size={14} /> บันทึกแล้ว
        </p>
      )}

      {editing && (
        <div className="space-y-2.5 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-gray-500">ชื่อหน่วยงาน *</label>
            <input className={inputCls} value={editing.name} onChange={set('name')} maxLength={200}
              placeholder="เช่น กองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-gray-500">เรียน (บรรทัดในหนังสือนำส่ง) *</label>
            <input className={inputCls} value={editing.recipient_title} onChange={set('recipient_title')} maxLength={300}
              placeholder="เช่น ประธานคณะกรรมการกองทุนสวัสดิการชุมชนตำบลทุ่งแค้ว" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-gray-500">ที่อยู่</label>
            <input className={inputCls} value={editing.address} onChange={set('address')} maxLength={500} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-gray-500">โทรศัพท์</label>
              <input className={inputCls} value={editing.phone} onChange={set('phone')} maxLength={60} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-gray-500">ต้องยื่นล่วงหน้า (วัน)</label>
              <input className={inputCls} type="number" min={0} max={30} value={editing.min_lead_days}
                onChange={set('min_lead_days')} />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-gray-400">
            ค่าเริ่มต้น 3 วันเป็นสมมติฐานของระบบ — ปรับให้ตรงกับระเบียบของหน่วยงานนั้น
          </p>
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
            <input type="checkbox" checked={editing.is_active} onChange={set('is_active')} />
            เปิดรับเรื่อง
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={handleSave} disabled={!canSave || saving}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-800 py-2.5 text-xs font-bold text-white disabled:opacity-40">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} บันทึก
            </button>
            <button type="button" onClick={() => setEditing(null)} disabled={saving}
              className="flex-1 rounded-xl border border-gray-200 bg-white py-2.5 text-xs font-semibold text-gray-600">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-gray-300" /></div>
      ) : rows.length === 0 ? (
        !editing && <p className="text-xs text-gray-400">ยังไม่มีหน่วยงานในทะเบียน</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map(row => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-800">{row.name}</p>
                <p className="truncate text-[11px] text-gray-400">
                  เรียน {row.recipient_title} · ยื่นล่วงหน้า {row.min_lead_days} วัน
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  row.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {row.is_active ? 'เปิดรับ' : 'ปิด'}
                </span>
                <button type="button" disabled={Boolean(editing)}
                  onClick={() => {
                    setJustSaved(false)
                    setEditing({
                      id: row.id,
                      name: row.name,
                      recipient_title: row.recipient_title,
                      address: row.address ?? '',
                      phone: row.phone ?? '',
                      min_lead_days: String(row.min_lead_days),
                      is_active: row.is_active,
                    })
                  }}
                  className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 disabled:opacity-40">
                  แก้ไข
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
