import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Check, CheckCircle2, ClipboardList, Loader2, Pencil, Phone, Plus, RefreshCw, Settings, Undo2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  ISO_WEEKDAYS, bangkokToday, bookingStatus, hhmm, openingText, slotRange, slotStarts, slotsPerDay,
  sortBookings, summarizeBookings, thaiLongDay, weekdayShort,
} from '../../lib/queueBooking'

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-transparent'
const label = 'mb-1 block text-xs font-semibold text-gray-500'
const chip = (on) => `min-h-[40px] rounded-xl border px-3 text-sm font-semibold transition-colors ${on
  ? 'text-white'
  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`
const lightBtn = 'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50'

const SERVICE_COLS = 'id, department_id, name, description, location, open_weekdays, start_time, end_time, slot_minutes, per_slot_quota, book_ahead_days, is_active'
const BOOKING_COLS = 'id, service_id, citizen_name, contact_phone, note, booking_date, slot_time, queue_no, status'

const emptyForm = () => ({
  id: null, name: '', department_id: '', location: '', description: '', open_weekdays: [1, 2, 3, 4, 5],
  start_time: '08:30', end_time: '16:30', slot_minutes: 30, per_slot_quota: 3, book_ahead_days: 30, is_active: true,
})

const formOf = (s) => ({
  id: s.id, name: s.name ?? '', department_id: s.department_id ?? '', location: s.location ?? '', description: s.description ?? '',
  open_weekdays: [...(s.open_weekdays ?? [])].map(Number).sort((a, b) => a - b),
  start_time: hhmm(s.start_time), end_time: hhmm(s.end_time),
  slot_minutes: s.slot_minutes, per_slot_quota: s.per_slot_quota, book_ahead_days: s.book_ahead_days, is_active: s.is_active,
})

function StatusPill({ status }) {
  const s = bookingStatus(status)
  return <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: s.bg, color: s.color }}>{s.label}</span>
}

function Stat({ title, value, color }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-center shadow-sm">
      <p className="text-xl font-black" style={{ color }}>{value}</p>
      <p className="text-[11px] font-semibold text-gray-500">{title}</p>
    </div>
  )
}

/**
 * จองคิวรับบริการ — ฝั่งเจ้าหน้าที่ (2 แท็บ)
 *   "คิวรับบริการ"  ทุกคนที่เห็นเมนู: ดูคิวรายวันของบริการที่กองตัวเองถือเรื่อง (RLS + queue_can_staff_service ตัดสิน) แล้วกด มาแล้ว/ไม่มา
 *   "ตั้งค่าบริการ" เฉพาะ admin/superadmin: ตั้งครั้งเดียว (วันเปิด ช่วงเวลา โควตา) ระบบเปิดช่องจองให้ประชาชนเอง ไม่มีงานรายวัน
 * ปุ่มที่ซ่อนตรงนี้เป็นแค่ความสะดวก ตัวบังคับจริงคือ RLS/RPC ในฐานข้อมูล (ตารางเขียนตรงได้เฉพาะ admin ผ่านคอลัมน์ที่ GRANT ไว้)
 */
export default function QueueBookingStaff({ tenant, currentUserRole }) {
  const tenantId = tenant?.id
  const isAdmin = currentUserRole === 'admin' || currentUserRole === 'superadmin'
  const [tab, setTab] = useState('queue')
  const today = bangkokToday()

  const [services, setServices] = useState([])       // ทุกบริการของ อปท. (เจ้าหน้าที่อ่านได้ทั้งหมด)
  const [staffable, setStaffable] = useState(null)   // id บริการที่ผู้ใช้ดูแลคิวได้ · null = ยังไม่รู้
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey(k => k + 1)

  // ── โหลดบริการ + กอง + บริการที่ดูแลได้ ─────────────────────────────────────────
  useEffect(() => {
    if (!tenantId) return undefined
    let alive = true
    Promise.all([
      supabase.from('queue_services').select(SERVICE_COLS).eq('municipality_id', tenantId).order('name'),
      supabase.from('departments').select('id, name, short_name').eq('municipality_id', tenantId).eq('is_active', true).order('sort_order'),
    ]).then(async ([sRes, dRes]) => {
      if (!alive) return
      if (sRes.error) { setLoadError(sRes.error.message); setLoading(false); return }
      const list = sRes.data ?? []
      // แอดมินดูแลทุกบริการ · เจ้าหน้าที่อื่นถามฐานข้อมูลครั้งเดียว (ชุดเดียวกับที่ RLS ใช้) ไม่เดาสิทธิ์ฝั่งหน้าเว็บ
      let ids
      if (isAdmin) ids = list.map(s => s.id)
      else {
        const { data: mine } = await supabase.rpc('queue_my_staff_service_ids')
        const allowed = new Set(Array.isArray(mine) ? mine : [])
        ids = list.filter(s => allowed.has(s.id)).map(s => s.id)
      }
      if (!alive) return
      setLoadError('')
      setServices(list)
      setDepartments(dRes.data ?? [])
      setStaffable(ids)
      setLoading(false)
    })
    return () => { alive = false }
  }, [tenantId, isAdmin, reloadKey])

  const deptName = useMemo(() => Object.fromEntries(departments.map(d => [d.id, d.short_name || d.name])), [departments])
  const myServices = useMemo(() => services.filter(s => staffable?.includes(s.id)), [services, staffable])

  const tabs = [
    { id: 'queue', label: 'คิวรับบริการ', Icon: ClipboardList },
    ...(isAdmin ? [{ id: 'settings', label: 'ตั้งค่าบริการ', Icon: Settings }] : []),
  ]

  if (loading) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
  if (loadError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        <p className="font-semibold">โหลดข้อมูลจองคิวไม่สำเร็จ</p>
        <p className="mt-1 text-xs">{loadError}</p>
        <button onClick={reload} className="mt-3 min-h-[40px] rounded-xl border border-rose-300 bg-white px-4 font-semibold">ลองใหม่</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <nav className="flex items-center overflow-x-auto border-b border-gray-200 bg-white" style={{ scrollbarWidth: 'none' }} aria-label="งานจองคิวรับบริการ">
        {tabs.map(({ id, label: text, Icon }) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}
            className="flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13px] font-bold transition-colors"
            style={{ borderColor: tab === id ? 'var(--color-primary)' : 'transparent', color: tab === id ? 'var(--color-primary)' : '#9ca3af' }}>
            <Icon size={14} />{text}
          </button>
        ))}
      </nav>

      {tab === 'queue' && <QueueTab services={myServices} today={today} hasAnyService={services.length > 0} isAdmin={isAdmin} />}
      {tab === 'settings' && isAdmin && (
        <SettingsTab tenantId={tenantId} services={services} departments={departments} deptName={deptName} onChanged={reload} />
      )}
    </div>
  )
}

// ── แท็บ: คิวรับบริการ ──────────────────────────────────────────────────────────────
function QueueTab({ services, today, hasAnyService, isAdmin }) {
  const [date, setDate] = useState(today)
  const [serviceId, setServiceId] = useState('')   // '' = ทุกบริการที่ดูแล
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [warn, setWarn] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const serviceById = useMemo(() => Object.fromEntries(services.map(s => [s.id, s])), [services])
  const idsKey = services.map(s => s.id).join(',')

  useEffect(() => {
    if (services.length === 0 || !date) return undefined
    let alive = true
    let q = supabase.from('queue_bookings').select(BOOKING_COLS, { count: 'exact' }).eq('booking_date', date)
    q = serviceId ? q.eq('service_id', serviceId) : q.in('service_id', services.map(s => s.id))
    q.order('slot_time').order('queue_no').limit(1000).then(({ data, count, error: err }) => {
      if (!alive) return
      if (err) { setError(err.message); setRows([]); return }
      setError('')
      // เพดาน 1,000 แถวของ PostgREST ตัดเงียบๆ — วันหนึ่งไม่น่าถึง แต่ถ้าถึงต้องบอก ไม่ใช่แสดงตัวเลขสรุปที่ไม่ครบ
      setWarn(typeof count === 'number' && count > (data ?? []).length ? 'มีคิวมากกว่าที่แสดง (เกิน 1,000 รายการ) กรุณาเลือกบริการรายตัว' : '')
      setRows(data ?? [])
    })
    return () => { alive = false }
    // idsKey แทน services (อ้างอิงเปลี่ยนทุกรอบ) · reloadKey = ปุ่มโหลดใหม่/หลังบันทึก
  }, [date, serviceId, idsKey, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => sortBookings(rows), [rows])
  const summary = useMemo(() => summarizeBookings(rows), [rows])

  async function mark(b, status) {
    setBusyId(b.id); setError('')
    const { error: err } = await supabase.rpc('mark_queue_booking', { p_booking_id: b.id, p_status: status })
    setBusyId(null)
    if (err) { setError(err.message); return }
    setReloadKey(k => k + 1)
  }

  if (services.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
        <CalendarClock size={32} className="mx-auto text-gray-300" />
        <p className="mt-2 text-sm font-semibold text-gray-700">ยังไม่มีบริการที่ท่านดูแลคิวได้</p>
        <p className="mt-1 text-xs text-gray-500">
          {hasAnyService
            ? 'บริการต้องตั้ง "กองที่ถือเรื่อง" เป็นกองของท่านก่อน จึงจะเห็นคิว — แจ้งแอดมินให้ตั้งที่แท็บ "ตั้งค่าบริการ"'
            : isAdmin
              ? 'ยังไม่ได้ตั้งบริการ — ไปที่แท็บ "ตั้งค่าบริการ" เพื่อเพิ่มบริการแรก'
              : 'ยังไม่มีการตั้งบริการจองคิวในหน่วยงานนี้ — แจ้งแอดมินให้ตั้งบริการที่แท็บ "ตั้งค่าบริการ" และกำหนดกองที่ถือเรื่อง'}
        </p>
      </div>
    )
  }

  const canMark = date <= today

  const actions = (b) => {
    if (b.status === 'cancelled') return <span className="text-xs text-gray-400">—</span>
    if (!canMark) return <span className="text-xs text-gray-400">ยังไม่ถึงวันนัด</span>
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {b.status === 'booked' ? (
          <>
            <button disabled={busyId === b.id} onClick={() => mark(b, 'arrived')}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              <Check size={15} /> มาแล้ว
            </button>
            <button disabled={busyId === b.id} onClick={() => mark(b, 'no_show')}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50">
              <X size={15} /> ไม่มา
            </button>
          </>
        ) : (
          <button disabled={busyId === b.id} onClick={() => mark(b, 'booked')} className={lightBtn}>
            <Undo2 size={15} /> ย้อนกลับ
          </button>
        )}
      </div>
    )
  }

  const phoneLink = (b) => (b.contact_phone
    ? <a href={`tel:${b.contact_phone}`} className="inline-flex items-center gap-1 font-semibold text-blue-700 underline"><Phone size={13} />{b.contact_phone}</a>
    : <span className="text-gray-400">—</span>)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className={label}>วันที่</span>
          <input type="date" className={`${inp} w-44`} value={date} onChange={e => e.target.value && setDate(e.target.value)} />
        </label>
        <button onClick={() => setDate(today)} className={lightBtn}>วันนี้</button>
        {services.length > 1 && (
          <label className="min-w-[12rem]">
            <span className={label}>บริการ</span>
            <select className={inp} value={serviceId} onChange={e => setServiceId(e.target.value)}>
              <option value="">ทั้งหมด ({services.length} บริการ)</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <button onClick={() => setReloadKey(k => k + 1)} className={lightBtn}><RefreshCw size={15} /> โหลดใหม่</button>
      </div>
      <p className="text-sm font-bold text-gray-800">{thaiLongDay(date)}</p>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}
      {warn && <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{warn}</div>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat title="จองทั้งหมด" value={summary.total} color="#1f2937" />
        <Stat title="มาแล้ว" value={summary.arrived} color="#059669" />
        <Stat title="ไม่มา" value={summary.no_show} color="#b45309" />
        <Stat title="ยกเลิก" value={summary.cancelled} color="#6b7280" />
      </div>

      {rows === null ? (
        <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
      ) : sorted.length === 0 ? (
        <p className="rounded-2xl border border-gray-100 bg-white px-4 py-8 text-center text-sm text-gray-500">ไม่มีคิวในวันที่เลือก</p>
      ) : (
        <>
          {/* PC: ตาราง */}
          <div className="hidden overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-500">
                <tr>
                  <th className="px-3 py-2.5">คิวที่</th><th className="px-3 py-2.5">เวลา</th><th className="px-3 py-2.5">ชื่อ</th>
                  <th className="px-3 py-2.5">เบอร์โทร</th><th className="px-3 py-2.5">หมายเหตุ</th><th className="px-3 py-2.5">สถานะ</th>
                  <th className="sticky right-0 bg-gray-50 px-3 py-2.5">ดำเนินการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map(b => {
                  const svc = serviceById[b.service_id]
                  return (
                    <tr key={b.id} className={b.status === 'cancelled' ? 'opacity-50' : ''}>
                      <td className="px-3 py-2.5 text-base font-black text-gray-800">{b.queue_no}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-gray-800">{slotRange(b.slot_time, svc?.slot_minutes)}</td>
                      <td className="px-3 py-2.5 font-semibold text-gray-800">
                        {b.citizen_name}
                        {services.length > 1 && svc && <span className="block text-xs font-normal text-gray-500">{svc.name}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">{phoneLink(b)}</td>
                      <td className="max-w-[16rem] px-3 py-2.5 text-xs text-gray-600 [overflow-wrap:anywhere]">{b.note || <span className="text-gray-400">—</span>}</td>
                      <td className="px-3 py-2.5"><StatusPill status={b.status} /></td>
                      <td className="sticky right-0 bg-white px-3 py-2.5">{actions(b)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* มือถือ: การ์ด */}
          <ul className="space-y-2 md:hidden">
            {sorted.map(b => {
              const svc = serviceById[b.service_id]
              return (
                <li key={b.id} className={`space-y-2 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm ${b.status === 'cancelled' ? 'opacity-50' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-gray-50">
                      <span className="text-[10px] font-semibold text-gray-400">คิวที่</span>
                      <span className="text-lg font-black text-gray-800">{b.queue_no}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-gray-800 [overflow-wrap:anywhere]">{b.citizen_name}</p>
                        <StatusPill status={b.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-gray-600">{slotRange(b.slot_time, svc?.slot_minutes)} น.{services.length > 1 && svc ? ` · ${svc.name}` : ''}</p>
                      <p className="mt-0.5 text-xs">{phoneLink(b)}</p>
                      {b.note && <p className="mt-0.5 text-xs text-gray-500 [overflow-wrap:anywhere]">{b.note}</p>}
                    </div>
                  </div>
                  {actions(b)}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

// ── แท็บ: ตั้งค่าบริการ (admin/superadmin) ──────────────────────────────────────────
function SettingsTab({ tenantId, services, departments, deptName, onChanged }) {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const set = useCallback((patch) => setForm(f => ({ ...f, ...patch })), [])
  const toggleDay = (n) => set({ open_weekdays: form.open_weekdays.includes(n) ? form.open_weekdays.filter(d => d !== n) : [...form.open_weekdays, n].sort((a, b) => a - b) })

  const preview = form ? slotsPerDay({ start_time: form.start_time, end_time: form.end_time, slot_minutes: Number(form.slot_minutes), per_slot_quota: Number(form.per_slot_quota) }) : null
  const starts = form ? slotStarts({ start_time: form.start_time, end_time: form.end_time, slot_minutes: Number(form.slot_minutes) }) : []

  function validate(f) {
    if (!f.name.trim()) return 'กรุณากรอกชื่อบริการ'
    if (f.name.trim().length > 120) return 'ชื่อบริการยาวเกิน 120 ตัวอักษร'
    if (f.open_weekdays.length === 0) return 'เลือกวันเปิดอย่างน้อย 1 วัน'
    if (!f.start_time || !f.end_time || f.end_time <= f.start_time) return 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม'
    const mins = Number(f.slot_minutes), quota = Number(f.per_slot_quota), ahead = Number(f.book_ahead_days)
    if (!Number.isInteger(mins) || mins < 5 || mins > 240) return 'ความยาวต่อช่องต้องเป็น 5–240 นาที'
    if (!Number.isInteger(quota) || quota < 1 || quota > 100) return 'จำนวนคนต่อช่องต้องเป็น 1–100'
    if (!Number.isInteger(ahead) || ahead < 0 || ahead > 180) return 'จองล่วงหน้าได้ 0–180 วัน'
    if (slotStarts({ start_time: f.start_time, end_time: f.end_time, slot_minutes: mins }).length === 0) return 'ช่วงเวลาเปิดสั้นกว่าความยาวต่อช่อง — ไม่มีช่องให้จอง'
    if (f.location.length > 200) return 'สถานที่ยาวเกิน 200 ตัวอักษร'
    if (f.description.length > 1000) return 'รายละเอียดยาวเกิน 1,000 ตัวอักษร'
    return ''
  }

  async function save() {
    const problem = validate(form)
    if (problem) { setError(problem); return }
    setSaving(true); setError(''); setNotice('')
    // ส่งเฉพาะคอลัมน์ที่ GRANT ไว้ (ห้ามส่ง id/created_by/created_at/updated_at · UPDATE ห้ามส่ง municipality_id)
    const payload = {
      department_id: form.department_id || null,
      name: form.name.trim(),
      description: form.description.trim() || null,
      location: form.location.trim() || null,
      open_weekdays: form.open_weekdays,
      start_time: form.start_time,
      end_time: form.end_time,
      slot_minutes: Number(form.slot_minutes),
      per_slot_quota: Number(form.per_slot_quota),
      book_ahead_days: Number(form.book_ahead_days),
      is_active: form.is_active,
    }
    let err
    if (form.id) {
      const res = await supabase.from('queue_services').update(payload).eq('id', form.id).select('id')
      err = res.error ?? (res.data?.length ? null : { message: 'บันทึกไม่สำเร็จ (ไม่พบบริการนี้หรือไม่มีสิทธิ์แก้ไข)' })
    } else {
      const res = await supabase.from('queue_services').insert({ ...payload, municipality_id: tenantId })
      err = res.error
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    setNotice(form.id ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มบริการแล้ว — ประชาชนจองคิวได้ตามวัน-เวลาที่ตั้งไว้ทันที')
    setForm(null)
    onChanged()
  }

  // ไม่มีปุ่มลบ: ลบบริการ = ลบประวัติคิวทั้งหมด (ฐานข้อมูลให้เฉพาะ superadmin) แอดมินใช้ปิดบริการแทน
  async function toggleActive(s) {
    setBusyId(s.id); setError(''); setNotice('')
    const { data, error: err } = await supabase.from('queue_services').update({ is_active: !s.is_active }).eq('id', s.id).select('id')
    setBusyId(null)
    if (err || !data?.length) { setError(err?.message ?? 'บันทึกไม่สำเร็จ'); return }
    setNotice(s.is_active ? 'ปิดบริการแล้ว — ประชาชนจะไม่เห็นบริการนี้ (คิวที่จองไว้แล้วยังอยู่)' : 'เปิดบริการแล้ว')
    onChanged()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-gray-500">
          ตั้งครั้งเดียว ระบบเปิดช่องจองให้ประชาชนเองตามวันเปิดและช่วงเวลา — กลับมาที่นี่เฉพาะเมื่อต้องเปลี่ยนเวลา/โควตา หรือปิดบริการชั่วคราว
        </p>
        {!form && (
          <button onClick={() => { setError(''); setNotice(''); setForm(emptyForm()) }}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
            <Plus size={16} /> เพิ่มบริการ
          </button>
        )}
      </div>

      {notice && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span className="flex-1">{notice}</span>
          <button onClick={() => setNotice('')} aria-label="ปิดข้อความ" className="text-emerald-600"><X size={16} /></button>
        </div>
      )}
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}

      {form && (
        <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900">{form.id ? 'แก้ไขบริการ' : 'เพิ่มบริการ'}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className={label}>ชื่อบริการ *</span>
              <input className={inp} maxLength={120} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="เช่น งานทะเบียนและเบี้ยยังชีพ" />
            </label>
            <label>
              <span className={label}>กองที่ถือเรื่อง</span>
              <select className={inp} value={form.department_id} onChange={e => set({ department_id: e.target.value })}>
                <option value="">— ไม่ระบุ —</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label>
              <span className={label}>สถานที่รับบริการ</span>
              <input className={inp} maxLength={200} value={form.location} onChange={e => set({ location: e.target.value })} placeholder="เช่น ชั้น 1 ห้องบริการประชาชน" />
            </label>
            <label className="sm:col-span-2">
              <span className={label}>รายละเอียด (ไม่บังคับ)</span>
              <textarea className={inp} rows={2} maxLength={1000} value={form.description} onChange={e => set({ description: e.target.value })} />
            </label>
          </div>

          {!form.department_id && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>ยังไม่ได้เลือกกองที่ถือเรื่อง — เจ้าหน้าที่จะไม่เห็นคิว เห็นเฉพาะแอดมิน</span>
            </div>
          )}

          <div>
            <span className={label}>วันเปิดให้บริการ *</span>
            <div className="flex flex-wrap gap-2">
              {ISO_WEEKDAYS.map(n => (
                <button key={n} type="button" aria-pressed={form.open_weekdays.includes(n)} onClick={() => toggleDay(n)}
                  className={chip(form.open_weekdays.includes(n))}
                  style={form.open_weekdays.includes(n) ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)' } : undefined}>
                  {weekdayShort(n)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              <span className={label}>เวลาเริ่ม *</span>
              <input type="time" className={inp} value={form.start_time} onChange={e => set({ start_time: e.target.value })} />
            </label>
            <label>
              <span className={label}>เวลาสิ้นสุด *</span>
              <input type="time" className={inp} value={form.end_time} onChange={e => set({ end_time: e.target.value })} />
            </label>
            <label>
              <span className={label}>ความยาวต่อช่อง (นาที) *</span>
              <input type="number" inputMode="numeric" min="5" max="240" className={inp} value={form.slot_minutes} onChange={e => set({ slot_minutes: e.target.value })} />
            </label>
            <label>
              <span className={label}>จำนวนคนต่อช่อง *</span>
              <input type="number" inputMode="numeric" min="1" max="100" className={inp} value={form.per_slot_quota} onChange={e => set({ per_slot_quota: e.target.value })} />
            </label>
            <label>
              <span className={label}>จองล่วงหน้าได้ (วัน) *</span>
              <input type="number" inputMode="numeric" min="0" max="180" className={inp} value={form.book_ahead_days} onChange={e => set({ book_ahead_days: e.target.value })} />
            </label>
            <label className="flex items-end gap-2 pb-2.5">
              <input type="checkbox" className="h-5 w-5" checked={form.is_active} onChange={e => set({ is_active: e.target.checked })} />
              <span className="text-sm font-semibold text-gray-700">เปิดให้ประชาชนจอง</span>
            </label>
          </div>

          <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
            ตัวอย่าง: {preview.slots > 0
              ? <>วันละ <b>{preview.slots}</b> ช่อง ({starts[0]}–{slotRange(starts[starts.length - 1], form.slot_minutes).split('–')[1]} น.) รับได้สูงสุด <b>{preview.capacity}</b> คนต่อวัน</>
              : 'ช่วงเวลาเปิดสั้นกว่าความยาวต่อช่อง — ยังไม่มีช่องให้จอง'}
          </p>

          <div className="flex flex-wrap gap-2">
            <button onClick={save} disabled={saving}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)' }}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} บันทึก
            </button>
            <button onClick={() => { setForm(null); setError('') }} disabled={saving} className={`${lightBtn} min-h-[44px]`}>ยกเลิก</button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-gray-900">บริการทั้งหมด ({services.length})</h3>
        {services.length === 0 ? (
          <p className="rounded-xl bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">ยังไม่ได้ตั้งบริการ — ประชาชนจะเห็นว่า &quot;ยังไม่มีบริการที่เปิดให้จองคิว&quot;</p>
        ) : (
          <ul className="space-y-2">
            {services.map(s => {
              const per = slotsPerDay(s)
              return (
                <li key={s.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5 ${s.is_active ? '' : 'opacity-60'}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900">{s.name}{!s.is_active && <span className="ml-2 text-xs font-semibold text-gray-500">ปิดบริการอยู่</span>}</p>
                    <p className="text-xs text-gray-500">
                      {openingText(s)} · ช่องละ {s.slot_minutes} นาที · {s.per_slot_quota} คน/ช่อง · {per.slots} ช่อง/วัน · จองล่วงหน้า {s.book_ahead_days} วัน
                    </p>
                    <p className="text-xs text-gray-500">
                      กองที่ถือเรื่อง: {s.department_id ? (deptName[s.department_id] ?? '—') : <span className="font-semibold text-amber-700">ไม่ระบุ (เห็นเฉพาะแอดมิน)</span>}
                      {s.location ? ` · ${s.location}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setError(''); setNotice(''); setForm(formOf(s)) }} disabled={busyId === s.id} title="แก้ไข" aria-label={`แก้ไข ${s.name}`}
                      className="min-h-[40px] rounded-lg px-2.5 text-gray-500 hover:bg-gray-100"><Pencil size={16} /></button>
                    <button onClick={() => toggleActive(s)} disabled={busyId === s.id}
                      className="min-h-[40px] rounded-lg px-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-100">
                      {s.is_active ? 'ปิดบริการ' : 'เปิดบริการ'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
