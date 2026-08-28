import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, Check, Globe2, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { fetchHolidayRows } from '../../lib/holidaysSource'
import { holidaysOfYear, missingHolidayYears } from '../../lib/workingDays'
import { logAction } from '../../lib/auditLog'

const MONTHS_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
const DOW_TH = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์']

// แสดงวันที่จากสตริง 'YYYY-MM-DD' ตรงๆ ห้ามผ่าน new Date(str) เพราะ JS ตีความเป็น UTC
// แล้วเลื่อนวันย้อนหลังไป 1 วันในเขตเวลาไทย (ดูเหตุผลเต็มใน src/lib/thaiDate.js)
function fmtThai(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = DOW_TH[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${dow}ที่ ${d} ${MONTHS_TH[m - 1]} ${y + 543}`
}

const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100'

const EMPTY_FORM = { holiday_date: '', name: '', is_working_day: false, scope: 'tenant' }

export default function HolidaysAdmin({ tenant, currentUserRole }) {
  const { reloadHolidays } = useTenant()
  const isSuperadmin = currentUserRole === 'superadmin'

  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showForm, setShowForm] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  // ตั้งสถานะกำลังโหลดตรงนี้ ไม่ใช่ในตัว effect — การ setState ตรงๆ ในตัว effect ทำให้เกิด
  // การเรนเดอร์ซ้อน (react-hooks/set-state-in-effect) ส่วนนี่เป็น event handler จึงไม่มีปัญหา
  const load = () => { setLoading(true); setErr(''); setRefreshKey(k => k + 1) }

  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    fetchHolidayRows(tenant.id)
      .then(async data => {
        if (cancelled) return
        setRows(data)
        // ป้อนเข้าตัวคำนวณกลางด้วย เพื่อให้ทั้งแอป (ป้าย SLA, รายงาน) เห็นค่าใหม่ทันที
        // โดยไม่ต้องรีเฟรชหน้า และเพื่อให้รายการ "ที่ระบบใช้นับจริง" ข้างล่างตรงกับของจริง
        await reloadHolidays(tenant.id)
      })
      .catch(e => { if (!cancelled) setErr(e?.message || 'โหลดข้อมูลวันหยุดไม่สำเร็จ') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tenant?.id, refreshKey, reloadHolidays])

  // ผลลัพธ์จริงหลังรวมตาราง static ในโค้ดกับแถวใน DB แล้ว — นี่คือสิ่งที่ระบบใช้นับ SLA จริง
  // คำนวณสดทุก render เพราะอ่านจาก module state ของ workingDays.js ที่ React มองไม่เห็น
  // (ราว 50 รายการต่อปี จะ memo ก็ไม่คุ้มและเสี่ยงค้างค่าเก่า)
  const effective = holidaysOfYear(year)
  const missing = missingHolidayYears(thisYear, thisYear + 1)

  const dbRowsOfYear = rows.filter(r => String(r.holiday_date).startsWith(`${year}-`))
  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2]

  async function handleSave(e) {
    e.preventDefault()
    if (!form.holiday_date || !form.name.trim()) {
      setErr('กรุณาระบุวันที่และชื่อวันหยุด')
      return
    }
    if (form.scope === 'global' && !isSuperadmin) {
      setErr('เฉพาะ Super Admin เท่านั้นที่แก้วันหยุดทั่วประเทศได้')
      return
    }
    setSaving(true)
    setErr('')
    const municipalityId = form.scope === 'global' ? null : tenant.id
    const payload = {
      municipality_id: municipalityId,
      holiday_date: form.holiday_date,
      name: form.name.trim(),
      is_working_day: form.is_working_day,
      updated_at: new Date().toISOString(),
    }
    // onConflict ต้องระบุคอลัมน์ให้ตรงกับ partial unique index ทั้งสองตัวใน migration
    // (แถวทั่วประเทศ unique ที่ holiday_date อย่างเดียว เพราะ municipality_id เป็น NULL)
    const { error } = await supabase
      .from('public_holidays')
      .upsert(payload, { onConflict: municipalityId ? 'municipality_id,holiday_date' : 'holiday_date' })
    setSaving(false)
    if (error) {
      setErr(`บันทึกไม่สำเร็จ: ${error.message}`)
      return
    }
    logAction({
      action: 'update', resourceType: 'public_holiday',
      resourceId: `${municipalityId ?? 'global'}:${form.holiday_date}`,
      resourceLabel: `${form.is_working_day ? 'ยกเลิกวันหยุด' : 'วันหยุด'} ${form.holiday_date} ${form.name.trim()}`,
      municipalityId: tenant.id,
      metadata: { scope: form.scope, ...payload },
    })
    setForm(EMPTY_FORM)
    setShowForm(false)
    load()
  }

  async function handleDelete(row) {
    if (!window.confirm(`ลบ "${row.name}" (${fmtThai(row.holiday_date)}) ออกจากรายการวันหยุด?`)) return
    const { error } = await supabase.from('public_holidays').delete().eq('id', row.id)
    if (error) {
      setErr(`ลบไม่สำเร็จ: ${error.message}`)
      return
    }
    logAction({
      action: 'delete', resourceType: 'public_holiday', resourceId: row.id,
      resourceLabel: `${row.holiday_date} ${row.name}`,
      municipalityId: tenant.id,
      metadata: { scope: row.municipality_id ? 'tenant' : 'global', ...row },
    })
    load()
  }

  const canEditRow = row => (row.municipality_id ? true : isSuperadmin)

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-slate-950 via-blue-950 to-indigo-950 px-5 py-5 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10"><CalendarDays size={18} /></span>
            <div>
              <h2 className="text-base font-extrabold">วันหยุดราชการ</h2>
              <p className="text-xs text-white/60">ใช้คำนวณ SLA คำร้องเป็น &ldquo;วันทำการ&rdquo; ทั้งระบบ</p>
            </div>
          </div>
          <button type="button" onClick={load} disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-white/20 px-3 py-2 text-xs font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> โหลดใหม่
          </button>
        </div>

        <div className="space-y-4 p-5">
          {missing.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="text-xs leading-relaxed text-amber-900">
                <p className="font-bold">ยังไม่มีข้อมูลวันหยุดของปี พ.ศ. {missing.map(y => y + 543).join(', ')}</p>
                <p className="mt-0.5 text-amber-800">
                  ระหว่างที่ยังไม่กรอก ระบบจะนับวันทำการโดยตัดเฉพาะเสาร์-อาทิตย์ ทำให้ตัวเลข
                  &ldquo;เหลือกี่วันทำการ&rdquo; และรายงาน SLA ของช่วงนั้นคลาดเคลื่อน
                </p>
              </div>
            </div>
          )}

          {err && (
            <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
              <X size={14} className="mt-0.5 shrink-0" /> {err}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
              {years.map(y => (
                <button key={y} type="button" onClick={() => setYear(y)}
                  className={`min-h-9 rounded-lg px-3 text-xs font-bold transition ${year === y ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>
                  {y + 543}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { setForm({ ...EMPTY_FORM, scope: isSuperadmin ? 'global' : 'tenant' }); setShowForm(s => !s); setErr('') }}
              className="ml-auto flex min-h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-xs font-bold text-white transition hover:bg-blue-700">
              <Plus size={14} /> เพิ่มวันหยุด
            </button>
          </div>

          {showForm && (
            <form onSubmit={handleSave} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-700">วันที่ *</label>
                  <input type="date" required value={form.holiday_date} className={inputCls}
                    onChange={e => setForm(p => ({ ...p, holiday_date: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-700">ชื่อวันหยุด *</label>
                  <input type="text" required maxLength={200} value={form.name} className={inputCls}
                    placeholder="เช่น วันสงกรานต์ / ประเพณีบุญบั้งไฟ"
                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-700">ขอบเขต</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => setForm(p => ({ ...p, scope: 'tenant' }))}
                    className={`rounded-xl border px-3 py-2.5 text-left text-xs transition ${form.scope === 'tenant' ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600'}`}>
                    <span className="font-bold">เฉพาะหน่วยงานนี้</span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">วันหยุดตามประเพณีท้องถิ่นที่ {tenant?.name} ประกาศเอง</span>
                  </button>
                  <button type="button" disabled={!isSuperadmin} onClick={() => setForm(p => ({ ...p, scope: 'global' }))}
                    className={`rounded-xl border px-3 py-2.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${form.scope === 'global' ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600'}`}>
                    <span className="flex items-center gap-1.5 font-bold"><Globe2 size={12} /> ทั่วประเทศ</span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      {isSuperadmin ? 'มีผลกับทุกหน่วยงานในระบบ' : 'เฉพาะ Super Admin เท่านั้น'}
                    </span>
                  </button>
                </div>
              </div>

              <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <input type="checkbox" checked={form.is_working_day} className="mt-0.5"
                  onChange={e => setForm(p => ({ ...p, is_working_day: e.target.checked }))} />
                <span className="text-xs text-slate-600">
                  <span className="font-bold text-slate-800">ยกเลิกวันหยุดของวันนี้</span>
                  <span className="mt-0.5 block text-[11px]">
                    ใช้เมื่อ ครม. ถอนวันหยุดพิเศษที่เคยประกาศ หรือหน่วยงานสั่งให้มาปฏิบัติงาน
                    — วันนั้นจะกลับไปนับเป็นวันทำการ แม้จะอยู่ในตารางมาตรฐานของระบบ
                  </span>
                </span>
              </label>

              <div className="flex items-center gap-2 pt-1">
                <button type="submit" disabled={saving}
                  className="flex min-h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} บันทึก
                </button>
                <button type="button" onClick={() => { setShowForm(false); setErr('') }}
                  className="min-h-10 rounded-xl px-3 text-xs font-semibold text-slate-500 transition hover:bg-slate-100">
                  ยกเลิก
                </button>
              </div>
            </form>
          )}

          {/* รายการที่แอดมินตั้งเอง — แก้/ลบได้ */}
          <div>
            <h3 className="mb-2 text-xs font-bold text-slate-700">รายการที่ตั้งค่าไว้ ปี พ.ศ. {year + 543}</h3>
            {loading ? (
              <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-300" /></div>
            ) : dbRowsOfYear.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-400">
                ยังไม่มีรายการที่ตั้งค่าเอง — ระบบใช้ตารางวันหยุดมาตรฐานที่ติดมากับโปรแกรม
              </p>
            ) : (
              <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
                {dbRowsOfYear.map(row => (
                  <div key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-slate-800">
                        {row.name}
                        {row.is_working_day && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">ยกเลิกวันหยุด</span>}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {fmtThai(row.holiday_date)}
                        {' · '}
                        {row.municipality_id ? 'เฉพาะหน่วยงานนี้' : 'ทั่วประเทศ'}
                      </p>
                    </div>
                    {canEditRow(row) ? (
                      <button type="button" onClick={() => handleDelete(row)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-300 transition hover:bg-red-50 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <span className="shrink-0 text-[10px] font-semibold text-slate-300">Super Admin เท่านั้น</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ผลลัพธ์จริงที่ระบบใช้นับ — รวมตารางมาตรฐานในโปรแกรมกับรายการข้างบนแล้ว */}
          <div>
            <h3 className="mb-2 text-xs font-bold text-slate-700">
              วันหยุดที่ระบบใช้นับจริง ปี พ.ศ. {year + 543}
              <span className="ml-2 font-normal text-slate-400">{effective.length} วัน</span>
            </h3>
            {effective.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/50 px-4 py-6 text-center text-xs text-amber-700">
                ไม่มีวันหยุดของปีนี้เลย — ระบบจะนับวันทำการโดยตัดเฉพาะเสาร์-อาทิตย์
              </p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {effective.map(h => (
                  <div key={h.date} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${h.source === 'db' ? 'bg-blue-500' : 'bg-slate-300'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold text-slate-700">{h.name}</p>
                      <p className="text-[10px] text-slate-400">{fmtThai(h.date)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 px-1 text-[11px] leading-relaxed text-slate-400">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-slate-300 align-middle" /> มาจากตารางมาตรฐานในโปรแกรม
              <span className="ml-3 mr-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 align-middle" /> ตั้งค่าเองในหน้านี้
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
