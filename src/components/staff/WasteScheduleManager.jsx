import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, CalendarOff, Check, CheckCircle2, ExternalLink, Loader2, Pencil, Plus,
  Printer, Trash2, X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { appUrl } from '../../lib/basename'
import { todayStr } from '../../lib/thaiDate'
import { missingHolidayYears } from '../../lib/workingDays'
import {
  HOLIDAY_POLICIES, NTH_LABELS, WASTE_TYPES, WEEKDAYS_TH, addDays, computeCollections,
  describeRule, mooListText, ruleOccursOn, thaiLongDate, thaiShortDate, timeText, validateSchedule,
} from '../../lib/wasteSchedule'
import { buildWasteSchedulePosterHtml } from '../../lib/wasteSchedulePosterPrint'

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-transparent'
const label = 'mb-1 block text-xs font-semibold text-gray-500'
const chip = (on) => `min-h-[40px] rounded-xl border px-3 text-sm font-semibold transition-colors ${on
  ? 'border-emerald-600 bg-emerald-600 text-white'
  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`

const SCHEDULE_COLS = 'id, waste_type, moo_nos, rule, interval_weeks, weekdays, nth, time_from, time_to, holiday_policy, starts_on, ends_on, note, is_active'
// จันทร์ก่อน — เจ้าหน้าที่นึกถึงสัปดาห์ทำงาน ไม่ใช่ปฏิทินที่เริ่มวันอาทิตย์
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const PREVIEW_DAYS = 30

const emptySchedule = (today) => ({
  waste_type: 'general', moo_nos: [], rule: 'weekly', interval_weeks: 1, weekdays: [], nth: 2,
  time_from: '', time_to: '', holiday_policy: '', starts_on: today, ends_on: '', note: '',
})

const emptyException = () => ({
  on_date: '', waste_type: '', moo_nos: [], action: 'cancel', new_date: '', reason: '',
})

// Postgres คืนเวลาเป็น 'HH:MM:SS' แต่ <input type="time"> กับตัวคำนวณใช้ 'HH:MM'
const normalizeSchedule = (s) => ({
  ...s,
  time_from: s.time_from?.slice(0, 5) ?? null,
  time_to: s.time_to?.slice(0, 5) ?? null,
})

function toggleIn(list, value) {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value].sort((a, b) => a - b)
}

function MooPicker({ villages, value, onChange }) {
  if (villages.length === 0) {
    return <p className="text-xs text-gray-500">ยังไม่ได้ตั้งจำนวนหมู่ — รอบนี้จะใช้กับทุกหมู่</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={chip(value.length === 0)} onClick={() => onChange([])}>ทุกหมู่</button>
      {villages.map(v => (
        <button key={v.moo_no} type="button" className={chip(value.includes(v.moo_no))}
          title={v.name || undefined}
          onClick={() => onChange(toggleIn(value, v.moo_no))}>
          หมู่ {v.moo_no}
        </button>
      ))}
    </div>
  )
}

/**
 * ตารางรอบเก็บขยะ — ฝั่งเจ้าหน้าที่
 *
 * หลักการ (เจ้าของระบบกำหนด 2569-09-14): ระบบต้องช่วยงาน ไม่เพิ่มงานให้เจ้าหน้าที่
 *   1. ตั้งจำนวนหมู่ครั้งเดียว
 *   2. ตั้งรอบเก็บครั้งเดียว — รวมถึงนโยบายวันหยุดราชการ ระบบเลื่อน/งดให้เองทุกปี
 *   3. กด "งดเก็บ/เลื่อนวัน" เฉพาะตอนมีเหตุจริง
 * ที่เหลือหน้าประชาชน /waste คำนวณเองทั้งหมด ไม่มีงานรายวัน/รายเดือน
 * หน้านี้จึงไม่มีปุ่ม "ยืนยันว่าเก็บแล้ว" หรือช่องบันทึกปริมาณขยะโดยตั้งใจ
 *
 * สิทธิ์แก้ไขตัดสินที่ฐานข้อมูล (can_manage_waste_schedule): แอดมิน + เจ้าหน้าที่กองที่ดูแลงานขยะ
 * (กองสาธารณสุขถ้ามีคนอยู่ ไม่งั้นสำนักปลัด) ปุ่มที่ซ่อนตรงนี้เป็นแค่ความสะดวก ตัวบังคับจริงคือ RLS
 */
export default function WasteScheduleManager({ tenant }) {
  const { holidaysVersion } = useTenant()
  const today = todayStr()
  const [canManage, setCanManage] = useState(false)
  const [villages, setVillages] = useState([])
  const [schedules, setSchedules] = useState([])
  const [exceptions, setExceptions] = useState([])
  const [loading, setLoading] = useState(true)
  // แยก "โหลดไม่สำเร็จ" ออกจาก "ยังไม่ได้ตั้งค่า" — ถ้าแสดงเหมือนกัน เจ้าหน้าที่จะตั้งรอบซ้ำทับของเดิม
  const [loadError, setLoadError] = useState('')

  const [mooCount, setMooCount] = useState('')
  const [mooNames, setMooNames] = useState({})
  const [showNames, setShowNames] = useState(false)
  const [savingVillages, setSavingVillages] = useState(false)

  const [scheduleForm, setScheduleForm] = useState(null)
  const [editId, setEditId] = useState(null)
  const [exceptionForm, setExceptionForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState('')

  const tenantId = tenant?.id
  const [reloadKey, setReloadKey] = useState(0)
  // โหลดซ้ำหลังบันทึกโดยไม่ตั้ง loading ใหม่ — หน้าจอไม่กระพริบหายระหว่างรอ
  const load = () => setReloadKey(k => k + 1)

  useEffect(() => {
    if (!tenantId) return
    let alive = true
    Promise.all([
      supabase.from('waste_villages').select('id, moo_no, name')
        .eq('municipality_id', tenantId).order('moo_no'),
      supabase.from('waste_schedules').select(SCHEDULE_COLS)
        .eq('municipality_id', tenantId).order('waste_type').order('created_at'),
      supabase.from('waste_schedule_exceptions')
        .select('id, on_date, waste_type, moo_nos, action, new_date, reason')
        .eq('municipality_id', tenantId).gte('on_date', addDays(todayStr(), -7)).order('on_date'),
      supabase.rpc('can_manage_waste_schedule', { p_municipality_id: tenantId }),
    ]).then(([vRes, sRes, eRes, permRes]) => {
      if (!alive) return
      const failed = vRes.error || sRes.error || eRes.error
      setLoading(false)
      if (failed) { setLoadError(failed.message); return }
      setLoadError('')
      setVillages(vRes.data ?? [])
      setSchedules((sRes.data ?? []).map(normalizeSchedule))
      setExceptions(eRes.data ?? [])
      setCanManage(Boolean(permRes.data))
      setMooCount(vRes.data?.length ? String(Math.max(...vRes.data.map(v => v.moo_no))) : '')
      setMooNames(Object.fromEntries((vRes.data ?? []).map(v => [v.moo_no, v.name ?? ''])))
    })
    return () => { alive = false }
  }, [tenantId, reloadKey])

  const activeSchedules = useMemo(() => schedules.filter(s => s.is_active), [schedules])

  // holidaysVersion เป็น dependency โดยตั้งใจ — วันหยุดโหลดจากฐานข้อมูลทีหลังหน้าจอ
  // ถ้าไม่คำนวณใหม่ ตัวอย่างจะไม่เห็นรอบที่ระบบเลื่อนเพราะวันหยุด
  const preview = useMemo(() => {
    void holidaysVersion
    return computeCollections({ schedules: activeSchedules, exceptions, from: today, days: PREVIEW_DAYS })
  }, [activeSchedules, exceptions, today, holidaysVersion])

  const missingYears = useMemo(() => {
    void holidaysVersion
    const needsHolidays = activeSchedules.some(s => s.holiday_policy !== 'collect')
    if (!needsHolidays) return []
    const thisYear = Number(today.slice(0, 4))
    return missingHolidayYears(thisYear, Number(addDays(today, 60).slice(0, 4)))
      .filter(y => y >= thisYear)
  }, [activeSchedules, today, holidaysVersion])

  const upcomingExceptions = exceptions.filter(e => (e.new_date ?? e.on_date) >= today || e.on_date >= today)
  const isSetUp = activeSchedules.length > 0

  // ─── หมู่ ───────────────────────────────────────────────────────────────────

  async function saveVillages() {
    const count = Number.parseInt(mooCount, 10)
    if (!Number.isInteger(count) || count < 1 || count > 99) return alert('จำนวนหมู่ต้องอยู่ระหว่าง 1 ถึง 99')

    const orphan = schedules.filter(s => s.moo_nos.some(n => n > count))
    if (orphan.length > 0 && !confirm(
      `มีรอบเก็บ ${orphan.length} รอบที่ระบุหมู่เกิน ${count}\n`
      + 'หมู่ที่เกินจะไม่ขึ้นให้ประชาชนเลือก ควรแก้รอบเหล่านั้นด้วย\n\nบันทึกต่อหรือไม่?',
    )) return

    setSavingVillages(true)
    const rows = Array.from({ length: count }, (_, i) => ({
      municipality_id: tenant.id,
      moo_no: i + 1,
      name: (mooNames[i + 1] ?? '').trim() || null,
    }))
    const { error } = await supabase.from('waste_villages')
      .upsert(rows, { onConflict: 'municipality_id,moo_no' })
    if (!error && villages.some(v => v.moo_no > count)) {
      const { error: delError } = await supabase.from('waste_villages').delete()
        .eq('municipality_id', tenant.id).gt('moo_no', count)
      if (delError) alert(`ลดจำนวนหมู่ไม่สำเร็จ: ${delError.message}`)
    }
    setSavingVillages(false)
    if (error) return alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    setShowNames(false)
    load()
  }

  // ─── รอบเก็บ ────────────────────────────────────────────────────────────────

  function startAddSchedule(wasteType = 'general') {
    setEditId(null)
    // ขยะอันตรายของ อปท. ส่วนใหญ่เป็นรถวนเดือนละครั้ง ตั้งรูปแบบรายเดือนไว้ให้ก่อน
    setScheduleForm({ ...emptySchedule(today), waste_type: wasteType, rule: wasteType === 'hazardous' ? 'monthly' : 'weekly' })
  }

  function startEditSchedule(s) {
    setEditId(s.id)
    setScheduleForm({
      ...s,
      time_from: s.time_from ?? '', time_to: s.time_to ?? '', ends_on: s.ends_on ?? '',
      note: s.note ?? '', nth: s.nth ?? 2,
    })
  }

  const setField = (key, value) => setScheduleForm(f => ({ ...f, [key]: value }))

  async function saveSchedule() {
    const f = scheduleForm
    const payload = {
      waste_type: f.waste_type,
      moo_nos: f.moo_nos,
      rule: f.rule,
      interval_weeks: f.rule === 'monthly' ? 1 : Number(f.interval_weeks),
      weekdays: f.rule === 'monthly' ? f.weekdays.slice(0, 1) : f.weekdays,
      nth: f.rule === 'monthly' ? Number(f.nth) : null,
      time_from: f.time_from || null,
      time_to: f.time_to || null,
      holiday_policy: f.holiday_policy,
      starts_on: f.starts_on,
      ends_on: f.ends_on || null,
      note: f.note.trim() || null,
    }
    const errors = validateSchedule(payload)
    if (errors.length) return alert(`กรุณาแก้ไข:\n- ${errors.join('\n- ')}`)

    const before = editId ? schedules.find(s => s.id === editId) : null
    setSaving(true)
    const { error } = editId
      ? await supabase.from('waste_schedules').update(payload).eq('id', editId)
      : await supabase.from('waste_schedules').insert({ ...payload, municipality_id: tenant.id })
    setSaving(false)
    if (error) return alert(`บันทึกไม่สำเร็จ: ${error.message}`)

    // หน้าประชาชนอัปเดตเอง แต่ใบที่ติดบอร์ดไว้ไม่ — เตือนเฉพาะตอนที่ข้อความบนใบเปลี่ยนจริง
    const printedChanged = !before
      || describeRule(before) !== describeRule(payload)
      || timeText(before) !== timeText(payload)
      || mooListText(before.moo_nos) !== mooListText(payload.moo_nos)
      || before.holiday_policy !== payload.holiday_policy
    setNotice(printedChanged
      ? 'บันทึกแล้ว หน้าประชาชนอัปเดตทันที — ถ้าติดใบตารางไว้ที่บอร์ดหมู่บ้าน ให้พิมพ์ใบใหม่ไปเปลี่ยน'
      : 'บันทึกแล้ว หน้าประชาชนอัปเดตทันที')
    setScheduleForm(null)
    setEditId(null)
    load()
  }

  async function toggleActive(s) {
    if (s.is_active && !confirm(`หยุดใช้รอบ "${WASTE_TYPES[s.waste_type].label} ${describeRule(s)}"?\nรอบนี้จะหายจากหน้าประชาชน แต่ยังเปิดกลับได้`)) return
    setBusyId(s.id)
    const { error } = await supabase.from('waste_schedules').update({ is_active: !s.is_active }).eq('id', s.id)
    setBusyId(null)
    if (error) return alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    load()
  }

  async function deleteSchedule(s) {
    if (!confirm(`ลบรอบ "${WASTE_TYPES[s.waste_type].label} ${describeRule(s)}" ถาวร?`)) return
    setBusyId(s.id)
    const { error } = await supabase.from('waste_schedules').delete().eq('id', s.id)
    setBusyId(null)
    if (error) return alert(`ลบไม่สำเร็จ: ${error.message}`)
    load()
  }

  // ─── งดเก็บ/เลื่อนวัน ────────────────────────────────────────────────────────

  const affected = useMemo(() => {
    const f = exceptionForm
    if (!f?.on_date) return []
    return activeSchedules.filter(s =>
      ruleOccursOn(s, f.on_date)
      && (!f.waste_type || s.waste_type === f.waste_type)
      && (f.moo_nos.length === 0 || s.moo_nos.length === 0 || s.moo_nos.some(n => f.moo_nos.includes(n))))
  }, [exceptionForm, activeSchedules])

  async function saveException() {
    const f = exceptionForm
    if (!f.on_date) return alert('เลือกวันที่ที่มีเหตุ')
    if (affected.length === 0) return alert('วันที่เลือกไม่มีรอบเก็บตามที่ตั้งไว้ ไม่ต้องบันทึกงดเก็บ')
    if (f.action === 'move' && (!f.new_date || f.new_date === f.on_date)) return alert('เลือกวันใหม่ที่จะไปเก็บ')
    if (f.action === 'move' && f.new_date < today) return alert('วันใหม่ต้องไม่ใช่วันที่ผ่านมาแล้ว')

    setSaving(true)
    const { error } = await supabase.from('waste_schedule_exceptions').insert({
      municipality_id: tenant.id,
      on_date: f.on_date,
      waste_type: f.waste_type || null,
      moo_nos: f.moo_nos,
      action: f.action,
      new_date: f.action === 'move' ? f.new_date : null,
      reason: f.reason.trim() || null,
    })
    setSaving(false)
    if (error) return alert(`บันทึกไม่สำเร็จ: ${error.message}`)
    setNotice('บันทึกแล้ว หน้าประชาชนขึ้นแถบแจ้งเตือนทันที')
    setExceptionForm(null)
    load()
  }

  async function deleteException(e) {
    if (!confirm('ยกเลิกประกาศงดเก็บ/เลื่อนวันนี้ แล้วกลับไปใช้รอบปกติ?')) return
    setBusyId(e.id)
    const { error } = await supabase.from('waste_schedule_exceptions').delete().eq('id', e.id)
    setBusyId(null)
    if (error) return alert(`ลบไม่สำเร็จ: ${error.message}`)
    load()
  }

  // ─── ใบประกาศ ───────────────────────────────────────────────────────────────

  async function printPoster() {
    // เปิดหน้าต่างก่อน await — เบราว์เซอร์บล็อก popup ที่ไม่ได้เปิดตรงจากการคลิก
    const win = window.open('', '_blank', 'width=860,height=1100')
    if (!win) return alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต popup ของเว็บนี้แล้วลองใหม่')
    const pageUrl = appUrl('/waste')
    let qrDataUrl = ''
    try {
      const QRCode = await import('qrcode')
      qrDataUrl = await QRCode.toDataURL(pageUrl, { margin: 1, width: 480, errorCorrectionLevel: 'M' })
    } catch (err) {
      // ไม่มี QR ยังพิมพ์ได้ — ใบยังมีลิงก์เป็นตัวอักษร
      console.warn('[waste poster] สร้าง QR ไม่สำเร็จ:', err?.message || err)
    }
    const html = buildWasteSchedulePosterHtml({ tenant, schedules: activeSchedules, pageUrl, qrDataUrl, today })
    win.document.open()
    win.document.write(html)
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 600)
  }

  // ─── แสดงผล ─────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        <p className="font-semibold">โหลดตารางเก็บขยะไม่สำเร็จ</p>
        <p className="mt-1 text-xs">{loadError}</p>
        <button onClick={load} className="mt-3 min-h-[40px] rounded-xl border border-rose-300 bg-white px-4 font-semibold">ลองใหม่</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500 max-w-xl">
          ตั้งค่าครั้งเดียว ระบบคำนวณวันเก็บให้ประชาชนเองทุกเดือน รวมถึงเลื่อน/งดตามวันหยุดราชการ
          — กลับมาที่หน้านี้เฉพาะเมื่อเปลี่ยนวันเก็บ หรือมีเหตุต้องงด/เลื่อน
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
            {canManage ? 'แก้ไขได้' : 'อ่านอย่างเดียว'}
          </span>
          <a href={appUrl('/waste')} target="_blank" rel="noreferrer"
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            <ExternalLink size={15} /> หน้าประชาชน
          </a>
          {isSetUp && (
            <button onClick={printPoster}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50">
              <Printer size={15} /> พิมพ์ใบติดบอร์ด
            </button>
          )}
        </div>
      </div>

      {!canManage && (
        <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
          แก้ไขได้เฉพาะแอดมิน และเจ้าหน้าที่กองที่ดูแลงานขยะ (กองสาธารณสุข ถ้ายังไม่มีคือสำนักปลัด)
        </p>
      )}

      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice('')} className="text-emerald-600"><X size={16} /></button>
        </div>
      )}

      {missingYears.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            ปฏิทินวันหยุดราชการปี พ.ศ. {missingYears.map(y => y + 543).join(', ')} ยังไม่มีในระบบ
            รอบที่ตั้งให้งด/เลื่อนตามวันหยุดจะยังไม่ถูกเลื่อนในปีนั้น — แจ้งแอดมินเพิ่มวันหยุดประจำปี
            (ตัวเดียวกับที่ใช้นับวันทำการของคำร้อง ทำปีละครั้ง)
          </span>
        </div>
      )}

      {/* 1. หมู่ */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="w-40">
            <span className={label}>1. จำนวนหมู่ในพื้นที่</span>
            <input className={inp} type="number" inputMode="numeric" min="1" max="99"
              value={mooCount} onChange={e => setMooCount(e.target.value)} disabled={!canManage} placeholder="เช่น 12" />
          </label>
          {canManage && (
            <>
              <button onClick={() => setShowNames(v => !v)}
                className="min-h-[44px] rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                {showNames ? 'ซ่อนชื่อหมู่บ้าน' : 'ใส่ชื่อหมู่บ้าน (ไม่บังคับ)'}
              </button>
              <button onClick={saveVillages} disabled={savingVillages}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {savingVillages ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} บันทึก
              </button>
            </>
          )}
          {villages.length > 0 && !showNames && (
            <p className="text-xs text-gray-500">ตั้งไว้ {villages.length} หมู่ ประชาชนเลือกหมู่ของตัวเองได้ในหน้าตาราง</p>
          )}
        </div>
        {showNames && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: Math.min(99, Number.parseInt(mooCount, 10) || 0) }, (_, i) => i + 1).map(n => (
              <label key={n} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-sm font-semibold text-gray-600">หมู่ {n}</span>
                <input className={inp} maxLength={120} value={mooNames[n] ?? ''}
                  onChange={e => setMooNames(m => ({ ...m, [n]: e.target.value }))} placeholder="บ้าน..." />
              </label>
            ))}
          </div>
        )}
      </section>

      {/* 2. รอบเก็บ */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-gray-900">2. รอบเก็บขยะ</h3>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              {Object.values(WASTE_TYPES).map(t => (
                <button key={t.key} onClick={() => startAddSchedule(t.key)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold"
                  style={{ borderColor: t.color, color: t.color }}>
                  <Plus size={15} /> {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {schedules.length === 0 ? (
          <p className="rounded-xl bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
            ยังไม่ได้ตั้งรอบเก็บ — หน้าประชาชนจะแจ้งว่า &quot;ยังไม่มีข้อมูลรอบเก็บขยะ&quot;
          </p>
        ) : (
          <ul className="space-y-2">
            {schedules.map(s => {
              const t = WASTE_TYPES[s.waste_type]
              return (
                <li key={s.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5 ${s.is_active ? '' : 'opacity-50'}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: t.bg }}>{t.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900">
                      {describeRule(s)} {timeText(s) && <span className="font-semibold text-gray-500">· {timeText(s)}</span>}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t.label} · {mooListText(s.moo_nos)} · {HOLIDAY_POLICIES[s.holiday_policy]?.short}
                      {!s.is_active && ' · หยุดใช้อยู่'}
                      {s.ends_on && ` · ถึง ${thaiShortDate(s.ends_on)}`}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEditSchedule(s)} disabled={busyId === s.id}
                        className="min-h-[40px] rounded-lg px-2.5 text-gray-500 hover:bg-gray-100" title="แก้ไข"><Pencil size={16} /></button>
                      <button onClick={() => toggleActive(s)} disabled={busyId === s.id}
                        className="min-h-[40px] rounded-lg px-2.5 text-xs font-semibold text-gray-500 hover:bg-gray-100">
                        {s.is_active ? 'หยุดใช้' : 'เปิดใช้'}
                      </button>
                      <button onClick={() => deleteSchedule(s)} disabled={busyId === s.id}
                        className="min-h-[40px] rounded-lg px-2.5 text-rose-500 hover:bg-rose-50" title="ลบ"><Trash2 size={16} /></button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* 3. งดเก็บ/เลื่อนวัน */}
      {isSetUp && (
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-gray-900">3. งดเก็บ / เลื่อนวัน</h3>
              <p className="text-xs text-gray-500">ใช้เฉพาะเมื่อมีเหตุ เช่น รถเสีย — วันหยุดราชการระบบจัดการให้แล้ว ไม่ต้องกด</p>
            </div>
            {canManage && (
              <button onClick={() => setExceptionForm(emptyException())}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-white hover:bg-amber-600">
                <CalendarOff size={16} /> แจ้งงดเก็บ/เลื่อนวัน
              </button>
            )}
          </div>
          {upcomingExceptions.length === 0 ? (
            <p className="text-xs text-gray-400">ไม่มีประกาศงดเก็บหรือเลื่อนวันที่ยังไม่ถึง</p>
          ) : (
            <ul className="space-y-2">
              {upcomingExceptions.map(e => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span className="font-semibold">
                    {e.action === 'cancel'
                      ? `งดเก็บ ${thaiShortDate(e.on_date)}`
                      : `เลื่อน ${thaiShortDate(e.on_date)} → ${thaiShortDate(e.new_date)}`}
                  </span>
                  <span className="text-xs">
                    {e.waste_type ? WASTE_TYPES[e.waste_type].label : 'ทุกประเภท'} · {mooListText(e.moo_nos)}
                    {e.reason && ` · ${e.reason}`}
                  </span>
                  {canManage && (
                    <button onClick={() => deleteException(e)} disabled={busyId === e.id}
                      className="ml-auto min-h-[36px] rounded-lg px-2 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                      ยกเลิกประกาศ
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 4. ตัวอย่างที่ประชาชนเห็น */}
      {isSetUp && (
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900">รอบเก็บ {PREVIEW_DAYS} วันข้างหน้า (ระบบคำนวณให้)</h3>
          <p className="mb-3 text-xs text-gray-500">ตรวจดูได้ว่าระบบเลื่อน/งดตรงวันหยุดถูกต้องหรือไม่ — ไม่ต้องทำอะไรกับรายการนี้</p>
          {preview.length === 0 ? (
            <p className="text-xs text-gray-400">ไม่มีรอบเก็บในช่วงนี้</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {preview.map((item, i) => (
                <li key={`${item.schedule.id}-${item.originalDate}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="w-28 shrink-0 font-semibold text-gray-800">{thaiShortDate(item.status === 'cancelled' ? item.originalDate : item.date)}</span>
                  <span className="text-gray-800">{WASTE_TYPES[item.waste_type].emoji} {WASTE_TYPES[item.waste_type].label}</span>
                  <span className="text-xs text-gray-500">{mooListText(item.schedule.moo_nos)}</span>
                  {item.status !== 'normal' && (
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${item.status === 'cancelled' ? 'bg-rose-50 text-rose-700' : 'bg-sky-50 text-sky-700'}`}>
                      {item.status === 'cancelled' ? 'งดเก็บ' : `เลื่อนจาก ${thaiShortDate(item.originalDate)}`}
                      {item.auto ? ' (อัตโนมัติ)' : ''}{item.reason ? ` · ${item.reason}` : ''}
                      {item.exceptionMoo ? ` · เฉพาะ${mooListText(item.exceptionMoo)}` : ''}
                    </span>
                  )}
                  {item.status === 'normal' && item.holiday && (
                    <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">ตรง{item.holiday} · เก็บตามปกติ</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {scheduleForm && (
        <ScheduleFormModal form={scheduleForm} editId={editId} villages={villages} saving={saving}
          setField={setField} onSave={saveSchedule} onClose={() => { setScheduleForm(null); setEditId(null) }} />
      )}

      {exceptionForm && (
        <ExceptionFormModal form={exceptionForm} setForm={setExceptionForm} villages={villages}
          affected={affected} saving={saving} today={today}
          onSave={saveException} onClose={() => setExceptionForm(null)} />
      )}
    </div>
  )
}

function ModalShell({ title, onClose, children, footer }) {
  // ไม่ปิดเมื่อคลิกฉากหลังโดยตั้งใจ — เผลอแตะนอกกล่องแล้วที่กรอกไว้หาย (แบบเดียวกับฟอร์มอื่นในระบบ)
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
      <div className="flex max-h-[93vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl md:max-w-2xl md:rounded-3xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">{children}</div>
        <div className="flex shrink-0 gap-2 border-t border-gray-100 px-4 py-3">{footer}</div>
      </div>
    </div>
  )
}

function SaveButtons({ saving, onSave, onClose, text }) {
  return (
    <>
      <button onClick={onSave} disabled={saving}
        className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {text}
      </button>
      <button onClick={onClose}
        className="min-h-[44px] rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-600 hover:bg-gray-50">ยกเลิก</button>
    </>
  )
}

function ScheduleFormModal({ form, editId, villages, saving, setField, onSave, onClose }) {
  const monthly = form.rule === 'monthly'
  return (
    <ModalShell title={editId ? 'แก้ไขรอบเก็บ' : 'เพิ่มรอบเก็บ'} onClose={onClose}
      footer={<SaveButtons saving={saving} onSave={onSave} onClose={onClose} text={editId ? 'บันทึกการแก้ไข' : 'เพิ่มรอบเก็บ'} />}>
      <div>
        <span className={label}>ประเภทขยะ</span>
        <div className="flex flex-wrap gap-2">
          {Object.values(WASTE_TYPES).map(t => (
            <button key={t.key} type="button" className={chip(form.waste_type === t.key)}
              onClick={() => setField('waste_type', t.key)}>{t.emoji} {t.label}</button>
          ))}
        </div>
      </div>

      <div>
        <span className={label}>หมู่ที่รถวิ่งผ่านในรอบนี้</span>
        <MooPicker villages={villages} value={form.moo_nos} onChange={v => setField('moo_nos', v)} />
        <span className="mt-1 block text-[11px] text-gray-400">ถ้าแต่ละหมู่เก็บคนละวัน ให้เพิ่มเป็นคนละรอบ</span>
      </div>

      <div>
        <span className={label}>รูปแบบรอบ</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(!monthly && Number(form.interval_weeks) === 1)}
            onClick={() => { setField('rule', 'weekly'); setField('interval_weeks', 1) }}>ทุกสัปดาห์</button>
          <button type="button" className={chip(!monthly && Number(form.interval_weeks) === 2)}
            onClick={() => { setField('rule', 'weekly'); setField('interval_weeks', 2) }}>2 สัปดาห์ครั้ง</button>
          <button type="button" className={chip(monthly)}
            onClick={() => { setField('rule', 'monthly'); setField('interval_weeks', 1); setField('weekdays', form.weekdays.slice(0, 1)) }}>เดือนละครั้ง</button>
        </div>
      </div>

      <div>
        <span className={label}>{monthly ? 'วัน (เลือก 1 วัน)' : 'วันที่ออกเก็บ (เลือกได้หลายวัน)'}</span>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_ORDER.map(d => (
            <button key={d} type="button" className={chip(form.weekdays.includes(d))}
              onClick={() => setField('weekdays', monthly ? [d] : toggleIn(form.weekdays, d))}>
              {WEEKDAYS_TH[d]}
            </button>
          ))}
        </div>
      </div>

      {monthly && (
        <label className="block">
          <span className={label}>สัปดาห์ที่เท่าไรของเดือน</span>
          <select className={inp} value={form.nth} onChange={e => setField('nth', Number(e.target.value))}>
            {[1, 2, 3, 4, -1].map(n => <option key={n} value={n}>{NTH_LABELS[n]}</option>)}
          </select>
        </label>
      )}

      {form.weekdays.length > 0 && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{describeRule(form)}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className={label}>เวลาเริ่ม (ไม่บังคับ)</span>
          <input className={inp} type="time" value={form.time_from} onChange={e => setField('time_from', e.target.value)} /></label>
        <label><span className={label}>เวลาสิ้นสุด (ไม่บังคับ)</span>
          <input className={inp} type="time" value={form.time_to} onChange={e => setField('time_to', e.target.value)} /></label>
      </div>

      <div>
        <span className={label}>ถ้ารอบเก็บตรงกับวันหยุดราชการ <span className="text-rose-600">*</span></span>
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(HOLIDAY_POLICIES).map(([key, p]) => (
            <button key={key} type="button" className={chip(form.holiday_policy === key)}
              onClick={() => setField('holiday_policy', key)}>{p.label}</button>
          ))}
        </div>
        <span className="mt-1 block text-[11px] text-gray-400">ตั้งครั้งเดียว ระบบเลื่อน/งดให้เองทุกปีตามปฏิทินวันหยุดราชการ</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className={label}>เริ่มใช้รอบนี้ตั้งแต่</span>
          <input className={inp} type="date" value={form.starts_on} onChange={e => setField('starts_on', e.target.value)} /></label>
        <label><span className={label}>ใช้ถึงวันที่ (ว่าง = ไม่มีกำหนด)</span>
          <input className={inp} type="date" value={form.ends_on} onChange={e => setField('ends_on', e.target.value)} /></label>
      </div>

      <label className="block"><span className={label}>หมายเหตุถึงประชาชน (ไม่บังคับ)</span>
        <input className={inp} maxLength={300} value={form.note} onChange={e => setField('note', e.target.value)}
          placeholder="เช่น นำถุงขยะวางหน้าบ้านก่อน 07:00 น." /></label>
    </ModalShell>
  )
}

function ExceptionFormModal({ form, setForm, villages, affected, saving, today, onSave, onClose }) {
  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))
  return (
    <ModalShell title="แจ้งงดเก็บ / เลื่อนวัน" onClose={onClose}
      footer={<SaveButtons saving={saving} onSave={onSave} onClose={onClose} text="ประกาศให้ประชาชนทราบ" />}>
      <label className="block"><span className={label}>วันที่มีเหตุ</span>
        <input className={inp} type="date" min={addDays(today, -1)} value={form.on_date} onChange={e => set('on_date', e.target.value)} /></label>

      <div>
        <span className={label}>ประเภทขยะ</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(!form.waste_type)} onClick={() => set('waste_type', '')}>ทุกประเภท</button>
          {Object.values(WASTE_TYPES).map(t => (
            <button key={t.key} type="button" className={chip(form.waste_type === t.key)} onClick={() => set('waste_type', t.key)}>
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className={label}>หมู่ที่ได้รับผล</span>
        <MooPicker villages={villages} value={form.moo_nos} onChange={v => set('moo_nos', v)} />
      </div>

      <div>
        <span className={label}>ทำอย่างไร</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(form.action === 'cancel')} onClick={() => set('action', 'cancel')}>งดเก็บรอบนี้</button>
          <button type="button" className={chip(form.action === 'move')} onClick={() => set('action', 'move')}>เลื่อนไปวันอื่น</button>
        </div>
      </div>

      {form.action === 'move' && (
        <label className="block"><span className={label}>วันใหม่ที่จะไปเก็บ</span>
          <input className={inp} type="date" min={today} value={form.new_date} onChange={e => set('new_date', e.target.value)} /></label>
      )}

      <label className="block"><span className={label}>เหตุผล (ประชาชนเห็น)</span>
        <input className={inp} maxLength={200} value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="เช่น รถเก็บขยะเข้าซ่อม" /></label>

      {form.on_date && (
        affected.length === 0 ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {thaiLongDate(form.on_date)} ไม่มีรอบเก็บตามที่ตั้งไว้
          </p>
        ) : (
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-semibold">รอบที่ได้รับผล {affected.length} รอบ</p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {affected.map(s => (
                <li key={s.id}>{WASTE_TYPES[s.waste_type].label} · {mooListText(s.moo_nos)} · {describeRule(s)}</li>
              ))}
            </ul>
          </div>
        )
      )}
    </ModalShell>
  )
}
