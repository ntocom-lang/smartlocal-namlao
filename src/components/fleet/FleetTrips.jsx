import { useState, useEffect } from 'react'
import { Plus, Calendar, X, ChevronLeft, ChevronRight, Route, History, Printer } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { assetIdentifier, assetOptionLabel } from '../../lib/fleetAssets'
import { logAction } from '../../lib/auditLog'
import { notifyTelegram } from '../../lib/notifyTelegram'
import { buildFleetTripRequestHtml, resolveOrderAuthority } from '../../lib/fleetTripPrint'
import FleetEmptyState from './FleetEmptyState'

const STATUS_LABEL = {
  pending:     'รอการอนุมัติ',
  approved:    'อนุมัติแล้ว',
  in_progress: 'กำลังเดินทาง',
  completed:   'เสร็จสิ้น',
  rejected:    'ปฏิเสธ',
  cancelled:   'ยกเลิก',
}
const STATUS_CLR = {
  pending:     '#f59e0b',
  approved:    '#3b82f6',
  in_progress: '#8b5cf6',
  completed:   '#10b981',
  rejected:    '#ef4444',
  cancelled:   '#9ca3af',
}

const inp = 'w-full px-3 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'
const sel = inp + ' appearance-none'

const SELECT = `*, vehicle:fleet_vehicles(id,name,license_plate,asset_code,asset_kind,meter_unit), driver:profiles!fleet_trips_driver_id_fkey(id,full_name), requester:profiles!fleet_trips_created_by_fkey(id,full_name,job_title,position:positions(name)), approver:profiles!fleet_trips_approved_by_fkey(full_name,job_title,position:positions(name)), departments(name,short_name)`

function userOptionLabel(profile, currentUserId) {
  const name = profile.full_name?.trim() || profile.email?.trim() || `ผู้ใช้ ${profile.id.slice(0, 8)}`
  return `${name}${profile.id === currentUserId ? ' (ฉัน)' : ''}`
}

function profilePosition(profile) {
  return profile?.job_title?.trim() || profile?.position?.name?.trim() || ''
}

// เลือกผู้ลงนามแถวที่ "มีผลวันนี้" ตามเวลาไทย — คิดฝั่ง client เพราะแถวมีไม่กี่แถว
// และ effective_from/effective_to เก็บเป็น date ไม่ใช่ timestamptz จึงเทียบเป็นสตริงได้ตรงๆ
function resolveActiveSignatory(rows) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
  const active = (rows ?? []).find(row =>
    (!row.effective_from || row.effective_from <= today)
    && (!row.effective_to || row.effective_to >= today))
  return active ?? null
}

const pad2 = n => String(n).padStart(2, '0')

// datetime-local คืน "YYYY-MM-DDTHH:mm" โดยไม่มี timezone
// new Date("2026-08-27T09:00") ใน Safari/บางเบราว์เซอร์ถูกตีเป็น UTC ไม่ใช่เวลาเครื่อง
// ผลคือบันทึก 09:00 แล้วเด้งเป็น 16:00 (หรือย้อน 02:00) — parse เป็น local ด้วยตัวเลขปี/เดือน/วัน/ชม. เอง
function parseDateTime(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const s = String(value).trim()
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(s)
  if (local) {
    return new Date(+local[1], +local[2] - 1, +local[3], +local[4], +local[5], +(local[6] || 0))
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function toLocalDT(date) {
  const d = parseDateTime(date)
  if (!d) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// ส่งเข้าคอลัมน์ timestamptz ต้องเป็น ISO มี offset — ห้ามส่งสตริง datetime-local ดิบ
function toISO(localDT) {
  const d = parseDateTime(localDT)
  return d ? d.toISOString() : null
}

function localDateStr(value) {
  const d = parseDateTime(value)
  if (!d) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function fmtDT(str) {
  if (!str) return '—'
  const d = parseDateTime(str)
  if (!d) return '—'
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })
}

function fmtDate(str) {
  if (!str) return '—'
  const d = parseDateTime(str)
  if (!d) return '—'
  return d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short' })
}

const EMPTY_RESERVE = {
  vehicle_id: '', driver_id: '', department_id: '',
  planned_departure: '', planned_return: '',
  destination: '', destination_locality: '', destination_province: '',
  purpose: '', passengers: 1, requester_position: '',
}
const EMPTY_DIRECT = {
  vehicle_id: '', driver_id: '', department_id: '',
  started_at: '', returned_at: '',
  odometer_start: '', odometer_end: '',
  destination: '', destination_locality: '', destination_province: '',
  purpose: '', passengers: 1, requester_position: '', notes: '', backdated_reason: '',
}

/* ── Modal shell ──────────────────────────────────────── */
function Modal({ title, onClose, onSave, saveLabel = 'บันทึก', saving, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-black text-gray-800">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4 flex-1">{children}</div>
        <div className="px-5 pb-5 pt-2 border-t border-gray-100">
          <button onClick={onSave} disabled={saving}
            className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving ? 'กำลังบันทึก...' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Booking Calendar ────────────────────────────────────── */
const DOW_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const MONTH_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']

// สถานะที่แสดงบนปฏิทิน — ตัดที่ถูกปฏิเสธ/ยกเลิกออก เพราะรถไม่ได้ถูกใช้จริง
const CAL_STATUSES = ['pending', 'approved', 'in_progress', 'completed']

// ปฏิทินดึงข้อมูลของเดือนที่กำลังดูเอง ไม่รับผ่าน prop
// เดิมรับอาร์เรย์ trips ของหน้าหลัก ซึ่งหลังแยกประวัติไปแบ่งหน้าที่ server แล้ว
// เหลือเฉพาะสถานะที่ยังดำเนินอยู่ ทริปที่ "เสร็จสิ้น" จึงหายจากปฏิทินทั้งหมด
// (เดือนที่ผ่านมาขึ้นว่างเปล่าทั้งที่มีการใช้รถจริง) และถ้าเปลี่ยนไปส่ง history แทน
// ก็จะได้แค่ 20 แถวของหน้าปัจจุบัน ซึ่งไม่มีความสัมพันธ์กับเดือนที่เปิดดูเลย
function BookingCalendar({ tenant, onClose }) {
  const now = new Date()
  // เก็บปี+เดือนเป็นก้อนเดียว เพื่อให้การข้ามปีคำนวณจากค่าล่าสุดเสมอ
  // เดิมแยกเป็นสอง state แล้วอ่าน mo ตรงๆ มาเช็คเงื่อนไข ถ้า React รวมสองคลิกไว้ชุดเดียว
  // (ดับเบิลคลิกปุ่มลูกศร) เงื่อนไขข้ามปีจะอ่านค่าเก่า → เดือนวิ่งเลย 11 และปีไม่เปลี่ยน
  const [cur, setCur] = useState({ yr: now.getFullYear(), mo: now.getMonth() }) // mo 0-indexed
  const { yr, mo } = cur
  const [selDay, setSelDay] = useState(null)   // เลขวันที่ถูกเลือก
  // ผูกผลลัพธ์ไว้กับคีย์ของเดือนที่ขอมา แล้วอนุมาน "กำลังโหลด" จากการที่คีย์ยังไม่ตรงกัน
  // ดีกว่าตั้ง setLoading(true) ตรงๆ ในเอฟเฟกต์ (สั่ง render ซ้อนโดยไม่จำเป็น)
  // และกันไม่ให้ข้อมูลของเดือนก่อนหน้าค้างบนตารางระหว่างรอเดือนใหม่
  const [monthData, setMonthData] = useState({ key: null, rows: [] })

  // popup อื่นในหน้านี้ปิดด้วย Esc ได้หมดแล้ว ปฏิทินจึงต้องทำเหมือนกัน
  // ไม่งั้นผู้ใช้ที่ชินกับ Esc จะกดแล้วไม่มีอะไรเกิดขึ้น
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function shiftMonth(delta) {
    setSelDay(null)
    setCur(c => {
      const m = c.mo + delta
      return { yr: c.yr + Math.floor(m / 12), mo: ((m % 12) + 12) % 12 }
    })
  }

  const firstDow = new Date(yr, mo, 1).getDay()   // 0=Sun
  const daysInMonth = new Date(yr, mo + 1, 0).getDate()
  const monthKey = `${yr}-${mo}`
  const loading = monthData.key !== monthKey
  const monthTrips = loading ? [] : monthData.rows

  useEffect(() => {
    if (!tenant?.id) return undefined
    let cancelled = false
    // ขอบเขตเดือนคิดตามเวลาไทยก่อน แล้วค่อยแปลงเป็น UTC ให้ฐานข้อมูล
    // (planned_departure/return เป็น timestamptz ส่วน trip_date เป็น date ล้วน)
    const from = new Date(yr, mo, 1).toISOString()
    const to   = new Date(yr, mo + 1, 1).toISOString()   // ไม่รวมวันแรกของเดือนถัดไป
    const dFrom = localDateStr(new Date(yr, mo, 1))
    const dTo   = localDateStr(new Date(yr, mo, daysInMonth))
    // ครอบคลุมสามแบบ: ช่วงขอใช้รถที่คร่อมเดือนนี้ / คำขอที่ยังไม่ระบุเวลากลับ /
    // รายการบันทึกย้อนหลังที่มีแต่ trip_date
    const overlap = [
      `and(planned_departure.lt."${to}",planned_return.gte."${from}")`,
      `and(planned_departure.lt."${to}",planned_departure.gte."${from}",planned_return.is.null)`,
      `and(planned_departure.is.null,trip_date.gte."${dFrom}",trip_date.lte."${dTo}")`,
    ].join(',')

    supabase.from('fleet_trips').select(SELECT)
      .eq('municipality_id', tenant.id)
      .in('status', CAL_STATUSES)
      .or(overlap)
      .order('planned_departure', { ascending: true, nullsFirst: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.error('fleet_trips calendar SELECT error:', error)
        setMonthData({ key: monthKey, rows: data ?? [] })
      })
    return () => { cancelled = true }
  }, [tenant?.id, yr, mo, daysInMonth, monthKey])

  function getDay(day) {
    // ใช้วันที่ตามเวลาไทย — เดิมใช้ toISOString() ซึ่งแปลงเป็น UTC ก่อน
    // ทำให้ new Date(yr, mo, day) (เที่ยงคืนไทย) กลายเป็นวันก่อนหน้า 17:00Z = ปฏิทินเลื่อนไป 1 วัน
    const dateStr = localDateStr(new Date(yr, mo, day))
    return monthTrips.filter(t => {
      const start = t.planned_departure
        ? localDateStr(t.planned_departure)
        : t.trip_date
      const end = t.planned_return
        ? localDateStr(t.planned_return)
        : start
      return dateStr >= start && dateStr <= end
    })
  }

  const today = localDateStr(now)
  // คำนวณใหม่ทุก render — เดิมเก็บ bookings ไว้ใน state ตอนคลิก ซึ่งจะค้างเป็นค่าเก่า
  // เมื่อข้อมูลของเดือนโหลดเสร็จทีหลังหรือถูกโหลดใหม่
  const selBookings = selDay ? getDay(selDay) : []
  // build grid cells: blanks + days
  const cells = Array(firstDow).fill(null).concat(
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
  )
  // pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="mb-1 text-xs font-bold text-gray-500">ปฏิทินการใช้รถ</p>
            <div className="flex items-center gap-3">
              <button onClick={() => shiftMonth(-1)}
                className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center">
                <ChevronLeft size={16} />
              </button>
              <h2 className="text-sm font-black text-gray-800 min-w-[130px] text-center">
                {MONTH_TH[mo]} {yr + 543}
              </h2>
              <button onClick={() => shiftMonth(1)}
                className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400">
            <X size={16} />
          </button>
        </div>

        {/* Legend */}
        <div className="flex gap-3 px-5 py-2 border-b border-gray-50 text-[10px]">
          {[['pending','#f59e0b','รอการอนุมัติ'],['approved','#3b82f6','อนุมัติแล้ว'],['in_progress','#8b5cf6','กำลังเดินทาง']].map(([,clr,lbl]) => (
            <div key={lbl} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: clr }} />
              <span className="text-gray-500">{lbl}</span>
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="overflow-y-auto p-4">
          {/* Day-of-week header */}
          <div className="grid grid-cols-7 mb-1">
            {DOW_TH.map(d => (
              <div key={d} className="text-center text-[10px] font-bold text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, idx) => {
              if (!day) return <div key={`blank-${idx}`} />
              const bookings = getDay(day)
              const cellDate = `${yr}-${String(mo + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const isToday = cellDate === today
              const isSel = selDay === day
              const hasBook = bookings.length > 0
              return (
                <div key={day}
                  onClick={() => hasBook && setSelDay(isSel ? null : day)}
                  className="rounded-xl p-1 min-h-[52px] flex flex-col transition-all"
                  style={{
                    background: isSel ? '#fffbeb' : isToday ? '#eff6ff' : '#f9fafb',
                    border: isSel ? '2px solid #d97706' : isToday ? '1.5px solid #3b82f6' : '1px solid #f3f4f6',
                    cursor: hasBook ? 'pointer' : 'default',
                  }}>
                  <span className="text-[10px] font-bold mb-0.5 self-end pr-0.5"
                        style={{ color: isSel ? '#b45309' : isToday ? '#3b82f6' : '#6b7280' }}>
                    {day}
                  </span>
                  <div className="space-y-0.5">
                    {bookings.map(t => (
                      <div key={t.id}
                        className="text-[9px] font-semibold px-1 py-0.5 rounded leading-tight truncate"
                        style={{ backgroundColor: STATUS_CLR[t.status] + '22', color: STATUS_CLR[t.status] }}>
                        {t.vehicle?.name || '—'}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Day detail panel */}
          {selDay && (
            <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-black text-blue-700">
                  📅 {selDay} {MONTH_TH[mo]} {yr + 543} — {selBookings.length} รายการ
                </p>
                <button onClick={() => setSelDay(null)}
                  className="text-blue-300 hover:text-blue-500 text-xs">✕</button>
              </div>
              {selBookings.map(t => (
                <div key={t.id} className="bg-white rounded-xl p-3 shadow-sm space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-black text-gray-800">
                      {t.vehicle?.name} · {t.vehicle?.license_plate}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: STATUS_CLR[t.status] + '20', color: STATUS_CLR[t.status] }}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-600">📍 {t.destination} — {t.purpose}</p>
                  <p className="text-[11px] text-gray-500">👤 {t.driver?.full_name}</p>
                  {t.planned_departure && (
                    <p className="text-[10px] text-gray-400">
                      {fmtDT(t.planned_departure)}
                      {' → '}
                      {t.planned_return ? fmtDT(t.planned_return) : '—'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Summary for month */}
          {loading && (
            <p className="text-center text-sm text-gray-400 py-6">กำลังโหลด...</p>
          )}
          {!loading && monthTrips.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-6">ไม่มีรายการใช้รถในเดือนนี้</p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Main ──────────────────────────────────────────────── */
export default function FleetTrips({ tenant, fleetInfo, depts, isAdmin, isStaff }) {
  const { session } = useAuth()
  const user = session?.user

  // RLS fleet_trips_insert/update บังคับว่าผู้ที่ไม่ใช่ manager ต้องมี department_id ตรงกับกองตัวเอง
  // (`department_id = (SELECT fdept_id FROM my_fleet())`) — ถ้าโปรไฟล์ยังไม่ถูกกำหนดกอง ค่าจะเป็น
  // NULL ทั้งสองฝั่ง ซึ่งใน SQL `NULL = NULL` ให้ NULL ไม่ใช่ TRUE → ถูกปฏิเสธเสมอ
  // และ FleetSetup เพิ่มเจ้าหน้าที่ใหม่ด้วย department_id: null เป็นค่าเริ่มต้น จึงติดกับดักนี้ทุกคน
  // แก้โดยล็อกช่องกองให้ตรงกับโปรไฟล์เสมอ และกันไม่ให้เปิดฟอร์มถ้ายังไม่มีกอง พร้อมบอกวิธีแก้
  const myDeptId = fleetInfo?.department_id ?? ''
  const myDeptName = depts.find(d => d.id === myDeptId)?.name ?? ''
  const deptLocked = !isAdmin           // ผู้ที่ไม่ใช่ manager เลือกกองอื่นไม่ได้อยู่แล้วโดย RLS
  const missingDept = deptLocked && !myDeptId

  // fleet_viewer อ่านได้อย่างเดียว — RLS fleet_trips_insert ยอมเฉพาะ manager หรือ fleet_staff
  // ที่กองตรงกับรถ ถ้าไม่ปิดปุ่มไว้ ผู้ตรวจการจะกรอกฟอร์มจนครบแล้วเจอ error ดิบจาก Postgres
  // ("new row violates row-level security policy") ซึ่งอ่านไม่รู้เรื่องและดูเหมือนระบบพัง
  // ใช้เกณฑ์เดียวกับ FleetFuelLog/FleetMaintenance เพื่อให้ทั้งโมดูลตัดสินสิทธิ์เหมือนกัน
  const canWrite = isAdmin || isStaff

  // trips = เฉพาะรายการที่ยังดำเนินอยู่ (pending/approved/in_progress) โหลดครบไม่จำกัดจำนวน
  // เพราะเป็นชุดเล็กและถูกใช้ทั้งตารางบน ปฏิทินการใช้รถ และการคำนวณรถว่าง
  // ส่วนประวัติ (completed/rejected/cancelled) โตไม่จำกัด แยกไปแบ่งหน้าฝั่ง server ด้านล่าง
  const [trips,     setTrips]     = useState([])
  const [history,      setHistory]      = useState([])
  const [historyCount, setHistoryCount] = useState(0)
  const [staffList, setStaffList] = useState([])
  const [requesterProfile, setRequesterProfile] = useState(null)
  const [orderAuthority, setOrderAuthority] = useState(null)
  const [vehicles,  setVehicles]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(null) // 'reserve'|'direct'|'depart'|'return'
  const [selTrip,   setSelTrip]   = useState(null)
  const [form,      setForm]      = useState({})
  const [saving,    setSaving]    = useState(false)
  const [conflict,  setConflict]  = useState(null) // null | { trips: [...conflicting fleet_trips], altVehicles: [...vehicles] }
  const [showOverride,   setShowOverride]   = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [rejectReason,   setRejectReason]   = useState('')
  const [showCal,   setShowCal]   = useState(false)
  const [historyPage, setHistoryPage] = useState(0)
  const [historyPageSize, setHistoryPageSize] = useState(20)

  /* ── Load ── */
  const ACTIVE_STATUSES  = ['pending', 'approved', 'in_progress']
  const HISTORY_STATUSES = ['completed', 'rejected', 'cancelled']

  function fetchActive() {
    return supabase.from('fleet_trips').select(SELECT)
      .eq('municipality_id', tenant.id)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: false })
  }

  // ประวัติแบ่งหน้าที่ server — เดิมดึงรวมมา .limit(300) แล้วหั่นหน้าฝั่ง client
  // ทำให้ อปท. ที่มีทริปเกิน 300 รายการ "ประวัติการใช้รถ" หายถาวรจากหน้าจอ
  // (นับรวม active ด้วย ยิ่งเหลือประวัติน้อยลงไปอีก)
  function fetchHistory(page = historyPage, size = historyPageSize) {
    let q = supabase.from('fleet_trips').select(SELECT, { count: 'exact' })
      .eq('municipality_id', tenant.id)
      .in('status', HISTORY_STATUSES)
      .order('created_at', { ascending: false })
    if (size !== 'all') q = q.range(page * size, (page + 1) * size - 1)
    return q
  }

  // สั่งโหลดใหม่ผ่าน state ไม่ใช่เรียกฟังก์ชันโหลดตรงๆ — ตัวรับ realtime ถูก subscribe ครั้งเดียว
  // ต่อ tenant ถ้าให้มันเรียก fetchHistory() เอง จะได้ historyPage/historyPageSize จาก closure
  // ของ render แรกเสมอ (stale) แล้วเด้งผู้ใช้กลับหน้า 1 เงียบๆ ทุกครั้งที่มีคนแก้ข้อมูล
  const [refreshKey, setRefreshKey] = useState(0)

  // ปิด popup ด้วยปุ่ม Esc — พฤติกรรมที่ผู้ใช้เดสก์ท็อปคาดหวัง และเป็นทางออกสำรอง
  // เมื่อปุ่มกากบาทหลุดออกนอกจอบนอุปกรณ์เล็ก ไม่ปิดระหว่างกำลังบันทึกเพื่อกันปิดคาครึ่งทาง
  useEffect(() => {
    if (!modal) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape' || saving) return
      setModal(null); setSelTrip(null); setConflict(null)
      setShowOverride(false); setOverrideReason(''); setRejectReason('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, saving])
  const loadTrips = () => setRefreshKey(k => k + 1)

  // โหลดครั้งเดียวต่อ tenant — รายชื่อเจ้าหน้าที่/รถไม่เปลี่ยนตามการแก้ทริป
  useEffect(() => {
    if (!tenant?.id) return
    Promise.all([
      supabase.from('profiles').select('id,full_name,email,department_id')
        .eq('municipality_id', tenant.id)
        .not('fleet_role', 'is', null)
        .order('full_name'),
      supabase.from('fleet_vehicles').select('id,name,license_plate,asset_code,asset_kind,meter_unit')
        .eq('municipality_id', tenant.id).eq('asset_kind', 'vehicle')
        .eq('status', 'active').order('name'),
      supabase.from('profiles').select('id,full_name,job_title,position:positions(name)')
        .eq('id', user?.id).eq('municipality_id', tenant.id).maybeSingle(),
      // ผู้มีอำนาจสั่งใช้รถบนใบขออนุญาต (แบบ 3) — ใช้ผู้ลงนามบทบาท "นายก" ที่ อปท. ตั้งไว้
      // ไม่ใช่บัญชีที่กดอนุมัติในระบบ ยังไม่ตั้งค่า = เว้นว่างให้เซ็นสด
      supabase.from('document_signatories')
        .select('manual_name,title_override,effective_from,effective_to,profile:profiles!document_signatories_profile_id_fkey(full_name,job_title,position:positions(name))')
        .eq('municipality_id', tenant.id).eq('signatory_role', 'mayor')
        .eq('document_type', 'complaint').eq('is_active', true)
        .is('department_id', null),
    ]).then(([{ data: s }, { data: v }, { data: requester }, { data: signatories }]) => {
      setStaffList(s ?? [])
      setVehicles(v ?? [])
      setRequesterProfile(requester ?? null)
      setOrderAuthority(resolveActiveSignatory(signatories))
    })
  }, [tenant?.id, user?.id])

  useEffect(() => {
    if (!tenant?.id) return
    fetchActive().then(({ data, error }) => {
      if (error) console.error('fleet_trips active SELECT error:', error)
      setTrips(data ?? [])
    }).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, refreshKey])

  // ประวัติโหลดใหม่เมื่อเปลี่ยนหน้า/ขนาดหน้า หรือมีข้อมูลเปลี่ยน (server-side range)
  useEffect(() => {
    if (!tenant?.id) return
    fetchHistory().then(({ data, count, error }) => {
      if (error) console.error('fleet_trips history SELECT error:', error)
      setHistory(data ?? [])
      setHistoryCount(count ?? 0)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, historyPage, historyPageSize, refreshKey])

  /* ── Realtime ── */
  useEffect(() => {
    if (!tenant?.id) return
    const ch = supabase.channel(`fleet-trips-${tenant.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fleet_trips' },
        ({ eventType, new: row, old }) => {
          // เดิม patch อาร์เรย์เดียวในหน่วยความจำได้ เพราะ trips ถือทั้ง active+history รวมกัน
          // ตอนนี้แยกสองชุด (active ครบ / history แบ่งหน้าที่ server) การเปลี่ยนสถานะทำให้ทริป
          // "ย้ายชุด" ได้ (อนุมัติ→ยกเลิก→ประวัติ) รวมถึงกระทบ count และลำดับหน้า — โหลดใหม่ทั้งคู่
          // ตรงไปตรงมาและถูกต้องกว่าไล่ patch เอง (ชุด active เล็ก ต้นทุน query ต่ำ)
          if (eventType !== 'DELETE' && row?.municipality_id !== tenant.id) return
          if (eventType === 'DELETE' && old?.municipality_id && old.municipality_id !== tenant.id) return
          loadTrips()
        }).subscribe()
    return () => supabase.removeChannel(ch)
    // loadTrips เป็นแค่ setState แบบ functional — ไม่พึ่ง closure จึงไม่ต้องอยู่ใน dependency
  }, [tenant?.id])

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  /* ── Conflict check — คืนรายการทริปที่ชนคิว (ไม่ใช่แค่ true/false) เพื่อเอาไปแสดง
     ในการ์ดเตือน + ใช้เป็นเป้าหมาย "ใช้รถแทนคิวเดิมกรณีฉุกเฉิน" ── */
  async function findVehicleConflicts(vehicleId, from, to, excludeId = null) {
    let busyQ = supabase.from('fleet_trips')
      .select('id,status,destination,driver:profiles!fleet_trips_driver_id_fkey(full_name)')
      .eq('vehicle_id', vehicleId).eq('status', 'in_progress')
    if (excludeId) busyQ = busyQ.neq('id', excludeId)
    const { data: busy } = await busyQ
    let overlapQ = supabase.from('fleet_trips')
      .select('id,status,destination,driver:profiles!fleet_trips_driver_id_fkey(full_name)')
      .eq('vehicle_id', vehicleId)
      .in('status', ['pending', 'approved'])
      // แปลงเป็น ISO ก่อนเทียบ ไม่งั้นเทียบเวลาท้องถิ่นกับ timestamptz คนละฐานเวลา
      .lt('planned_departure', toISO(to) ?? to).gt('planned_return', toISO(from) ?? from)
    if (excludeId) overlapQ = overlapQ.neq('id', excludeId)
    const { data: overlap } = await overlapQ
    return [...(busy ?? []), ...(overlap ?? [])]
  }

  // หารถคันอื่นที่ว่างช่วงเวลาเดียวกัน — คำนวณจาก trips ที่โหลดมาแล้ว (realtime sync อยู่แล้ว)
  // ไม่ต้องยิง query เพิ่ม เร็วกว่า แต่ไม่ authoritative เท่า findVehicleConflicts
  // (ใช้แค่ "แนะนำ" ตัวจริงยังเช็คซ้ำที่ findVehicleConflicts ตอน submit)
  function computeAvailableVehicles(excludeVehicleId, from, to, excludeTripId = null) {
    const busy = new Set()
    // เทียบเป็นตัวเลข timestamp — เดิมเทียบ string ระหว่างค่าจากฟอร์ม ("2027-01-05T09:00")
    // กับค่าจาก DB ("2027-01-05T02:00:00+00:00") ซึ่งคนละรูปแบบและคนละฐานเวลา
    const fromMs = parseDateTime(from)?.getTime() ?? 0
    const toMs   = parseDateTime(to)?.getTime() ?? 0
    trips.forEach(t => {
      if (t.id === excludeTripId) return
      if (!['pending', 'approved', 'in_progress'].includes(t.status)) return
      const overlaps = t.status === 'in_progress'
        || (t.planned_departure && t.planned_return
            && (parseDateTime(t.planned_departure)?.getTime() ?? 0) < toMs
            && (parseDateTime(t.planned_return)?.getTime() ?? 0) > fromMs)
      if (overlaps) busy.add(t.vehicle_id)
    })
    return vehicles.filter(v => v.id !== excludeVehicleId && !busy.has(v.id))
  }

  /* ── Open modals ── */
  function openReserve() {
    if (!canWrite) return alert('สิทธิ์ของท่านเป็นผู้ดูรายงาน ขออนุญาตใช้รถหรือบันทึกการใช้รถย้อนหลังไม่ได้')
    // กันเปิดฟอร์มทั้งที่ยังไม่มีกอง — RLS จะปฏิเสธตอนบันทึกด้วย error ดิบจาก Postgres
    if (missingDept) return alert('บัญชีของคุณยังไม่ได้กำหนดกอง/หน่วยงาน จึงยังบันทึกการใช้รถไม่ได้ — กรุณาให้ผู้ดูแลระบบกำหนดกองให้ก่อน (ตั้งค่า > เจ้าหน้าที่ยานพาหนะ)')
    const dep = new Date(Date.now() + 3600000)
    const ret = new Date(Date.now() + 7200000)
    setSelTrip(null)
    setForm({
      ...EMPTY_RESERVE,
      driver_id: user?.id ?? '',
      department_id: fleetInfo?.department_id ?? '',   // deptLocked บังคับใช้ค่านี้เสมอตอน submit
      requester_position: profilePosition(requesterProfile),
      destination_province: tenant?.province || '',
      planned_departure: toLocalDT(dep),
      planned_return: toLocalDT(ret),
    })
    setConflict(null)
    setShowOverride(false)
    setOverrideReason('')
    setModal('reserve')
  }

  // แก้ไขคำขอใช้รถที่ยัง pending — เฉพาะเจ้าของหรือ admin (ดู canEdit ใน renderTripRow/Card)
  function openEditReserve(t) {
    setSelTrip(t)
    setForm({
      vehicle_id: t.vehicle_id || '',
      driver_id: t.driver_id || '',
      department_id: t.department_id || '',
      planned_departure: t.planned_departure ? toLocalDT(t.planned_departure) : '',
      planned_return: t.planned_return ? toLocalDT(t.planned_return) : '',
      destination: t.destination || '',
      destination_locality: t.destination_locality || '',
      destination_province: t.destination_province || tenant?.province || '',
      purpose: t.purpose || '',
      passengers: t.passengers ?? 1,
      requester_position: t.requester_position || profilePosition(t.requester) || profilePosition(requesterProfile),
    })
    setConflict(null)
    setShowOverride(false)
    setOverrideReason('')
    setModal('reserve')
  }

  function openDetail(t) {
    setSelTrip(t)
    setModal('detail')
  }

  function printTripRequest(t) {
    const win = window.open('', '_blank', 'width=900,height=760')
    if (!win) return alert('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
    win.document.open()
    win.document.write(buildFleetTripRequestHtml({
      trip: t, tenant, orderAuthority: resolveOrderAuthority(orderAuthority, tenant),
    }))
    win.document.close()
    const printWhenReady = async () => {
      try {
        if (win.document.fonts?.ready) {
          await Promise.race([
            win.document.fonts.ready,
            new Promise(resolve => setTimeout(resolve, 1200)),
          ])
        }
      } catch { /* โหลดฟอนต์ไม่ทันก็พิมพ์ด้วยฟอนต์บนเครื่อง */ }
      win.focus()
      win.print()
    }
    setTimeout(printWhenReady, 200)
  }

  function openDirect() {
    // บันทึกย้อนหลัง = สร้างรายการ "เสร็จสิ้นแล้ว" โดยข้ามขั้นขออนุญาต จำกัดเฉพาะผู้ดูแลระบบ
    // ยานพาหนะ (guard ฝั่ง DB บังคับซ้ำอีกชั้นด้วย FLEET_TRIP_BACKDATED_REQUIRES_MANAGER)
    if (!isAdmin) return alert('บันทึกการใช้รถย้อนหลังได้เฉพาะผู้ดูแลระบบยานพาหนะ — กรุณายื่นคำขออนุญาตใช้รถตามปกติ')
    if (!canWrite) return alert('สิทธิ์ของท่านเป็นผู้ดูรายงาน ขออนุญาตใช้รถหรือบันทึกการใช้รถย้อนหลังไม่ได้')
    // กันเปิดฟอร์มทั้งที่ยังไม่มีกอง — RLS จะปฏิเสธตอนบันทึกด้วย error ดิบจาก Postgres
    if (missingDept) return alert('บัญชีของคุณยังไม่ได้กำหนดกอง/หน่วยงาน จึงยังบันทึกการใช้รถไม่ได้ — กรุณาให้ผู้ดูแลระบบกำหนดกองให้ก่อน (ตั้งค่า > เจ้าหน้าที่ยานพาหนะ)')
    setForm({
      ...EMPTY_DIRECT,
      driver_id: user?.id ?? '',
      department_id: fleetInfo?.department_id ?? '',   // deptLocked บังคับใช้ค่านี้เสมอตอน submit
      requester_position: profilePosition(requesterProfile),
      destination_province: tenant?.province || '',
      started_at: toLocalDT(new Date()),
    })
    setModal('direct')
  }

  /* ── Submit reservation (สร้างใหม่ หรือแก้ไข selTrip ถ้ามี) ── */
  async function submitReserve() {
    if (!form.vehicle_id || !form.planned_departure || !form.planned_return
        || !form.destination || !form.destination_locality || !form.destination_province || !form.purpose)
      return alert('กรุณากรอกข้อมูลให้ครบ')
    const passengerCount = Number(form.passengers)
    if (!Number.isInteger(passengerCount) || passengerCount < 1 || passengerCount > 100)
      return alert('จำนวนผู้ร่วมเดินทางต้องเป็นจำนวนเต็ม 1–100 คน')
    const requesterPosition = form.requester_position?.trim()
    if (!requesterPosition) return alert('กรุณาระบุตำแหน่งผู้ขอใช้รถ')
    if (requesterPosition.length > 200) return alert('ตำแหน่งผู้ขอยาวเกิน 200 ตัวอักษร')
    if (form.destination_locality.trim().length > 200 || form.destination_province.trim().length > 100)
      return alert('ท้องที่หรือจังหวัดยาวเกินกำหนด')
    if ((parseDateTime(form.planned_return)?.getTime() ?? 0) <= (parseDateTime(form.planned_departure)?.getTime() ?? 0))
      return alert('เวลากลับต้องหลังเวลาออก')
    const isEdit = !!selTrip
    const excludeId = isEdit ? selTrip.id : null
    const conflicts = await findVehicleConflicts(form.vehicle_id, form.planned_departure, form.planned_return, excludeId)
    if (conflicts.length) {
      setConflict({
        trips: conflicts,
        altVehicles: computeAvailableVehicles(form.vehicle_id, form.planned_departure, form.planned_return, excludeId),
      })
      return
    }
    setSaving(true)
    const payload = {
      vehicle_id: form.vehicle_id,
      driver_id: form.driver_id || user?.id,
      department_id: deptLocked ? (myDeptId || null) : (form.department_id || null),
      trip_date: form.planned_departure.slice(0, 10),   // วันที่ตามที่ผู้ใช้กรอก (เวลาไทย)
      planned_departure: toISO(form.planned_departure),
      planned_return:    toISO(form.planned_return),
      destination: form.destination.trim(),
      destination_locality: form.destination_locality.trim(),
      destination_province: form.destination_province.trim(),
      purpose: form.purpose.trim(),
      passengers: passengerCount,
      requester_position: requesterPosition,
    }
    const { error } = isEdit
      ? await supabase.from('fleet_trips').update(payload).eq('id', selTrip.id)
      : await supabase.from('fleet_trips').insert({
          ...payload,
          municipality_id: tenant.id,
          created_by: user?.id,
          status: 'pending',
        })
    setSaving(false)
    if (error) return alert(error.message)
    if (isEdit) {
      logAction({
        action: 'update', resourceType: 'fleet_trip', resourceId: selTrip.id,
        resourceLabel: `${payload.destination} (${form.vehicle_id})`,
        municipalityId: tenant.id,
        metadata: { before: {
          vehicle_id: selTrip.vehicle_id, planned_departure: selTrip.planned_departure,
          planned_return: selTrip.planned_return, destination: selTrip.destination,
          destination_locality: selTrip.destination_locality,
          destination_province: selTrip.destination_province, purpose: selTrip.purpose,
        }, after: payload },
      })
    }
    setModal(null)
    setSelTrip(null)
    setConflict(null)
    loadTrips()
  }

  /* ── ใช้รถแทนคิวเดิมกรณีฉุกเฉิน (admin เท่านั้น) — ยกเลิกคำขอที่ชนคิวทั้งหมด แล้วสร้างคำขอใหม่
     เป็น approved ทันที (admin เป็นผู้ตัดสินใจ/รับผิดชอบเอง) พร้อม audit log + แจ้งเตือนเจ้าของเดิม ── */
  async function submitOverrideReserve() {
    if (!isAdmin || !conflict?.trips?.length) return
    if (!overrideReason.trim()) return alert('กรุณาระบุเหตุผลความจำเป็นเร่งด่วน')
    const passengerCount = Number(form.passengers)
    if (!Number.isInteger(passengerCount) || passengerCount < 1 || passengerCount > 100)
      return alert('จำนวนผู้ร่วมเดินทางต้องเป็นจำนวนเต็ม 1–100 คน')
    const requesterPosition = form.requester_position?.trim()
    if (!requesterPosition) return alert('กรุณาระบุตำแหน่งผู้ขอใช้รถ')
    if (requesterPosition.length > 200) return alert('ตำแหน่งผู้ขอยาวเกิน 200 ตัวอักษร')
    if (!form.destination_locality?.trim() || !form.destination_province?.trim())
      return alert('กรุณาระบุท้องที่และจังหวัด')
    if (form.destination_locality.trim().length > 200 || form.destination_province.trim().length > 100)
      return alert('ท้องที่หรือจังหวัดยาวเกินกำหนด')
    setSaving(true)

    // ทั้ง "ยกเลิกคิวเดิม" และ "สร้างคิวใหม่" ทำใน RPC เดียว = transaction เดียว
    // เดิมยิงสองคำสั่งแยกจากที่นี่ ถ้า insert พังหลัง cancel สำเร็จ เจ้าหน้าที่เสียคิวรถฟรี
    // โดยไม่มีตัวแทนและ rollback ไม่ได้ — RPC ยังเช็คสิทธิ์ manager ซ้ำที่ฝั่ง DB ด้วย
    const { data, error } = await supabase.rpc('fleet_override_booking', {
      p_municipality_id:   tenant.id,
      p_vehicle_id:        form.vehicle_id,
      p_driver_id:         form.driver_id || user?.id,
      p_department_id:     form.department_id || null,
      p_planned_departure: toISO(form.planned_departure),
      p_planned_return:    toISO(form.planned_return),
      p_destination:       form.destination,
      p_destination_locality: form.destination_locality.trim(),
      p_destination_province: form.destination_province.trim(),
      p_purpose:           form.purpose,
      p_reason:            overrideReason.trim(),
      p_passengers:        passengerCount,
      p_requester_position: requesterPosition,
    })
    setSaving(false)
    if (error) return alert('อนุมัติใช้รถแทนคิวเดิมไม่สำเร็จ: ' + error.message)

    const result = Array.isArray(data) ? data[0] : data
    const newTripId = result?.new_trip_id
    // ใช้ id ที่ DB ยกเลิกจริง ไม่ใช่ conflict.trips ฝั่ง client ซึ่งมองไม่เห็นคิวของกองอื่น
    const bumpedIds = result?.bumped_ids ?? []

    bumpedIds.forEach(id => {
      logAction({
        action: 'override_cancel', resourceType: 'fleet_trip', resourceId: id,
        resourceLabel: `ยกเลิกเพื่อภารกิจฉุกเฉิน — ${form.destination}`, municipalityId: tenant.id,
        metadata: { replaced_by: newTripId, reason: overrideReason.trim() },
      })
      notifyTelegram('fleet_trip_bumped', id)
    })
    if (newTripId) {
      logAction({
        action: 'create_override', resourceType: 'fleet_trip', resourceId: newTripId,
        resourceLabel: `${form.destination} (ใช้รถแทนคิวเดิมกรณีฉุกเฉิน)`, municipalityId: tenant.id,
        metadata: { bumped: bumpedIds, reason: overrideReason.trim() },
      })
    }

    setModal(null); setSelTrip(null); setConflict(null)
    setShowOverride(false); setOverrideReason('')
    loadTrips()
  }

  /* ── Submit direct entry ── */
  async function submitDirect() {
    if (!isAdmin) return alert('บันทึกการใช้รถย้อนหลังได้เฉพาะผู้ดูแลระบบยานพาหนะ')
    if (!form.vehicle_id || !form.started_at || !form.destination
        || !form.destination_locality || !form.destination_province || !form.purpose)
      return alert('กรุณากรอกข้อมูลให้ครบ')
    // ต้องอธิบายได้ว่าทำไมจึงไม่ได้ขออนุญาตล่วงหน้า ไม่งั้นเอกสารที่พิมพ์ออกมาจะเป็นใบที่
    // ไม่มีใครอนุมัติและไม่มีคำอธิบาย (DB บังคับซ้ำด้วย FLEET_TRIP_BACKDATED_REQUIRES_REASON)
    const backdatedReason = form.backdated_reason?.trim() || ''
    if (backdatedReason.length < 5)
      return alert('กรุณาระบุเหตุผลที่บันทึกย้อนหลัง อย่างน้อย 5 ตัวอักษร')
    if (backdatedReason.length > 500)
      return alert('เหตุผลที่บันทึกย้อนหลังยาวเกิน 500 ตัวอักษร')
    const passengerCount = Number(form.passengers)
    if (!Number.isInteger(passengerCount) || passengerCount < 1 || passengerCount > 100)
      return alert('จำนวนผู้ร่วมเดินทางต้องเป็นจำนวนเต็ม 1–100 คน')
    const requesterPosition = form.requester_position?.trim() || null
    if (requesterPosition && requesterPosition.length > 200)
      return alert('ตำแหน่งผู้ขอยาวเกิน 200 ตัวอักษร')
    if (form.destination_locality.trim().length > 200 || form.destination_province.trim().length > 100)
      return alert('ท้องที่หรือจังหวัดยาวเกินกำหนด')
    if (form.returned_at && (parseDateTime(form.returned_at)?.getTime() ?? 0) < (parseDateTime(form.started_at)?.getTime() ?? 0))
      return alert('เวลากลับต้องไม่ก่อนเวลาออก')
    const startMeter = form.odometer_start === '' ? null : Number(form.odometer_start)
    const endMeter = form.odometer_end === '' ? null : Number(form.odometer_end)
    if (startMeter !== null && (!Number.isFinite(startMeter) || startMeter < 0))
      return alert('เลขไมล์ก่อนออกต้องเป็น 0 หรือมากกว่า')
    if (endMeter !== null && (!Number.isFinite(endMeter) || endMeter < 0))
      return alert('เลขไมล์หลังกลับต้องเป็น 0 หรือมากกว่า')
    if (startMeter !== null && endMeter !== null && endMeter < startMeter)
      return alert('เลขไมล์หลังกลับต้องไม่น้อยกว่าเลขไมล์ก่อนออก')
    setSaving(true)
    const { error } = await supabase.from('fleet_trips').insert({
      municipality_id: tenant.id,
      vehicle_id: form.vehicle_id,
      driver_id: form.driver_id || user?.id,
      created_by: user?.id,
      department_id: deptLocked ? (myDeptId || null) : (form.department_id || null),
      trip_date: form.started_at.slice(0, 10),   // วันที่ตามที่ผู้ใช้กรอก (เวลาไทย)
      started_at:  toISO(form.started_at),
      returned_at: toISO(form.returned_at),
      odometer_start: startMeter,
      odometer_end: endMeter,
      destination: form.destination.trim(),
      destination_locality: form.destination_locality.trim(),
      destination_province: form.destination_province.trim(),
      purpose: form.purpose.trim(),
      passengers: passengerCount,
      requester_position: requesterPosition,
      notes: form.notes || null,
      backdated_reason: backdatedReason,
      status: 'completed',
    })
    setSaving(false)
    if (error) return alert(error.message)
    setModal(null)
    loadTrips()
  }

  /* ── Admin approve/reject ── */
  async function handleApprove(t) {
    if (!confirm(`อนุมัติคำขอใช้รถ "${t.vehicle?.name}" ให้ ${t.driver?.full_name}?`)) return
    const { error } = await supabase.from('fleet_trips').update({ status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() }).eq('id', t.id)
    if (error) return alert('อนุมัติไม่สำเร็จ: ' + error.message)
    logAction({ action: 'approve', resourceType: 'fleet_trip', resourceId: t.id, resourceLabel: `${t.vehicle?.name} — ${t.destination}`, municipalityId: tenant.id })
    loadTrips()
  }
  // ปฏิเสธต้องระบุเหตุผลเสมอ — ผู้ขอใช้รถต้องรู้ว่าถูกปฏิเสธเพราะอะไร และต้องเหลือร่องรอย
  // ให้ตรวจสอบย้อนหลังได้ว่าใช้ดุลพินิจปฏิเสธด้วยเหตุใด (เก็บทั้งในตารางและ audit log)
  function handleReject(t) {
    setSelTrip(t)
    setRejectReason('')
    setModal('reject')
  }
  async function submitReject() {
    const reason = rejectReason.trim()
    if (reason.length < 5) return alert('กรุณาระบุเหตุผลการปฏิเสธอย่างน้อย 5 ตัวอักษร')
    setSaving(true)
    const { error } = await supabase.from('fleet_trips').update({
      status: 'rejected',
      reject_reason: reason,
      // fleet_trips ไม่มีคอลัมน์ผู้แก้ไข — approved_by/approved_at จึงทำหน้าที่ "ผู้พิจารณา/เวลาพิจารณา"
      // ทั้งกรณีอนุมัติและปฏิเสธ (ป้ายกำกับใน UI เปลี่ยนตาม status)
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', selTrip.id)
    setSaving(false)
    if (error) return alert('ปฏิเสธไม่สำเร็จ: ' + error.message)
    logAction({ action: 'reject', resourceType: 'fleet_trip', resourceId: selTrip.id,
      resourceLabel: `${selTrip.vehicle?.name} — ${selTrip.destination}`,
      municipalityId: tenant.id, metadata: { reason } })
    setModal(null); setSelTrip(null); setRejectReason('')
    loadTrips()
  }

  /* ── ผู้ขอใช้รถถอนคำขอของตัวเองที่ยังไม่ถูกพิจารณา ──
     เดิมไม่มีทางถอนจากหน้าจอเลย ทั้งที่ RLS อนุญาตอยู่แล้ว (ตรวจด้วยการยิง API ตรงแล้ว)
     เจ้าหน้าที่ที่ยื่นคำขอผิดวันจึงต้องตามแอดมินมากดปฏิเสธให้ ซึ่งไปโผล่ในประวัติว่า
     "ถูกปฏิเสธ" ทั้งที่ผู้ขอใช้รถถอนเอง — คนละเรื่องกันในแง่การตรวจสอบ
     บังคับระบุเหตุผลเหมือนตอนปฏิเสธ เพราะคำขอใช้รถราชการที่ถูกยกเลิกต้องอธิบายได้ว่าเพราะอะไร */
  function handleCancelOwn(t) {
    setSelTrip(t)
    setRejectReason('')
    setModal('cancel')
  }
  async function submitCancelOwn() {
    const reason = rejectReason.trim()
    if (reason.length < 5) return alert('กรุณาระบุเหตุผลการยกเลิกอย่างน้อย 5 ตัวอักษร')
    setSaving(true)
    const { error } = await supabase.from('fleet_trips').update({
      status: 'cancelled',
      reject_reason: reason,
      // ใช้ช่องเดียวกับการพิจารณา — ป้ายใน UI เปลี่ยนเป็น "ผู้ดำเนินการ" เมื่อสถานะเป็น cancelled
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', selTrip.id)
    setSaving(false)
    if (error) return alert('ยกเลิกไม่สำเร็จ: ' + error.message)
    logAction({ action: 'cancel', resourceType: 'fleet_trip', resourceId: selTrip.id,
      resourceLabel: `${selTrip.vehicle?.name} — ${selTrip.destination}`,
      municipalityId: tenant.id, metadata: { reason, cancelled_by: 'ผู้ขอใช้รถ' } })
    setModal(null); setSelTrip(null); setRejectReason('')
    loadTrips()
  }

  /* ── Depart / Return ── */
  async function submitDepart() {
    if (!form.started_at) return alert('กรุณาระบุเวลาออก')
    const startMeter = form.odometer_start === '' ? null : Number(form.odometer_start)
    if (startMeter !== null && (!Number.isFinite(startMeter) || startMeter < 0))
      return alert('เลขไมล์ก่อนออกต้องเป็น 0 หรือมากกว่า')
    setSaving(true)
    const { error } = await supabase.from('fleet_trips').update({
      status: 'in_progress',
      started_at: toISO(form.started_at),
      // trip_date คือวันที่ "ใช้รถจริง" ไม่ใช่วันที่ตามคำขอ — รายงาน สมุดประจำรถ และหน้าภาพรวม
      // กรองด้วยคอลัมน์นี้ทั้งหมด ถ้าออกเดินทางคนละวันกับที่ขอไว้ (เลื่อนเร็ว/ช้า ซึ่งเกิดประจำ)
      // แล้วไม่ sync ค่า ระยะทางกับค่าน้ำมันจะไปตกเดือน/ปีงบผิด และขัดกับเวลาออกจริงที่บันทึกไว้
      trip_date: form.started_at.slice(0, 10),   // เวลาไทยจากช่อง datetime-local ตรงๆ
      odometer_start: startMeter,
    }).eq('id', selTrip.id)
    setSaving(false)
    if (error) return alert(error.message)
    setModal(null); setSelTrip(null)
    loadTrips()
  }

  async function submitReturn() {
    if (!form.returned_at) return alert('กรุณาระบุเวลากลับ')
    if (selTrip.started_at && (parseDateTime(form.returned_at)?.getTime() ?? 0) < (parseDateTime(selTrip.started_at)?.getTime() ?? 0))
      return alert('เวลากลับต้องไม่ก่อนเวลาออก')
    const endMeter = form.odometer_end === '' ? null : Number(form.odometer_end)
    if (endMeter !== null && (!Number.isFinite(endMeter) || endMeter < 0))
      return alert('เลขไมล์หลังกลับต้องเป็น 0 หรือมากกว่า')
    if (selTrip.odometer_start != null && endMeter !== null && endMeter < Number(selTrip.odometer_start))
      return alert('เลขไมล์หลังกลับต้องไม่น้อยกว่าเลขไมล์ก่อนออก')
    setSaving(true)
    const { error } = await supabase.from('fleet_trips').update({
      status: 'completed',
      returned_at: toISO(form.returned_at),
      odometer_end: endMeter,
      notes: form.notes || null,
    }).eq('id', selTrip.id)
    setSaving(false)
    if (error) return alert(error.message)
    setModal(null); setSelTrip(null)
    loadTrips()
  }

  async function handleDelete(t) {
    if (!confirm(`ลบรายการ "${t.vehicle?.name}" วันที่ ${t.planned_departure ? fmtDate(t.planned_departure) : '—'}?`)) return
    const { error } = await supabase.from('fleet_trips').delete().eq('id', t.id)
    if (error) return alert('ลบไม่สำเร็จ: ' + error.message)
    logAction({ action: 'delete', resourceType: 'fleet_trip', resourceId: t.id, resourceLabel: `${t.vehicle?.name} — ${t.destination}`, municipalityId: tenant.id, metadata: { status: t.status } })
    setTrips(prev => prev.filter(x => x.id !== t.id))
  }

  /* ── Derived ── */
  const active  = trips   // โหลดมาเฉพาะสถานะที่ยังดำเนินอยู่แล้ว ไม่ต้อง filter ซ้ำ
  const isOwner = t => t.driver_id === user?.id

  // historyCount มาจาก count:'exact' ของ server ไม่ใช่ความยาวอาร์เรย์ที่โหลดมา
  const historyTotalPages = historyPageSize === 'all'
    ? 1
    : Math.max(1, Math.ceil(historyCount / historyPageSize))
  const historyCurrentPage = Math.min(historyPage, historyTotalPages - 1)
  const pagedHistory = history

  /* ── Trip Card (mobile) ── */
  function renderTripCard(t) {
    const clr = STATUS_CLR[t.status]
    const canApprove = t.status === 'pending' && isAdmin
    const canDepart  = t.status === 'approved' && (isOwner(t) || isAdmin)
    const canReturn  = t.status === 'in_progress' && (isOwner(t) || isAdmin)
    // admin มีปุ่ม "ปฏิเสธ" อยู่แล้ว จึงไม่ต้องมีปุ่มถอนซ้อนอีกปุ่ม
    const canCancel  = t.status === 'pending' && isOwner(t) && !isAdmin
    const dist = t.distance_km ?? null
    return (
      <div key={t.id}
        onClick={e => { if (e.target.closest('button')) return; openDetail(t) }}
        className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 space-y-1.5 cursor-pointer active:bg-gray-50">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="flex-1 min-w-0 truncate text-[13px] font-black text-gray-800">
            {t.vehicle?.name} <span className="font-semibold text-gray-400">· {assetIdentifier(t.vehicle)}</span>
          </h3>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: clr + '18', color: clr }}>
              {STATUS_LABEL[t.status]}
            </span>
            {t.planned_departure && (
              <span className="text-[9px] font-semibold bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-full">คำขอ</span>
            )}
          </div>
        </div>
        <p className="truncate text-[11px] text-gray-600" title={`${t.destination} — ${t.purpose}`}>
          📍 {t.destination} — {t.purpose}
        </p>
        <div className="border-t border-gray-100 pt-1.5 text-[10px] leading-4 text-gray-500">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">👤 {t.driver?.full_name}{t.departments?.short_name ? ` · ${t.departments.short_name}` : ''}</span>
            {dist != null && <span className="shrink-0 font-bold text-gray-700">📏 {dist.toLocaleString()} กม.</span>}
          </div>
          {t.planned_departure && <div>🗓 {fmtDT(t.planned_departure)} – {fmtDT(t.planned_return)}</div>}
          {t.started_at && <div>🚀 {fmtDT(t.started_at)}{t.odometer_start ? ` · ${Number(t.odometer_start).toLocaleString()} กม.` : ''}</div>}
          {t.returned_at && <div>🏁 {fmtDT(t.returned_at)}{t.odometer_end ? ` · ${Number(t.odometer_end).toLocaleString()} กม.` : ''}</div>}
        </div>
        {(canApprove || canDepart || canReturn || canCancel || isAdmin) && (
          <div className="flex gap-1.5 pt-0.5">
            {canApprove && <>
              <button onClick={() => handleApprove(t)}
                className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-white bg-green-500">
                ✓ อนุมัติ
              </button>
              <button onClick={() => handleReject(t)}
                className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-red-500 border border-red-200 bg-red-50">
                ✕ ปฏิเสธ
              </button>
            </>}
            {canCancel && (
              <button onClick={() => handleCancelOwn(t)}
                className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-gray-500 border border-gray-200 bg-gray-50">
                ✕ ยกเลิกคำขอ
              </button>
            )}
            {isAdmin && (
              <button onClick={() => handleDelete(t)}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-red-500 border border-red-200 bg-red-50 hover:bg-red-500 hover:text-white transition-colors">
                ลบ
              </button>
            )}
            {canDepart && (
              <button onClick={() => {
                setSelTrip(t)
                setForm({ started_at: toLocalDT(new Date()), odometer_start: '' })
                setModal('depart')
              }} className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                🚀 ออกเดินทาง
              </button>
            )}
            {canReturn && (
              <button onClick={() => {
                setSelTrip(t)
                setForm({ returned_at: toLocalDT(new Date()), odometer_end: '', notes: '' })
                setModal('return')
              }} className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-white bg-green-600">
                🏁 กลับถึง
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  /* ── Trip Row (desktop) ── */
  function renderTripRow(t, idx) {
    const clr = STATUS_CLR[t.status]
    const canApprove = t.status === 'pending' && isAdmin
    const canDepart  = t.status === 'approved' && (isOwner(t) || isAdmin)
    const canReturn  = t.status === 'in_progress' && (isOwner(t) || isAdmin)
    const canCancel  = t.status === 'pending' && isOwner(t) && !isAdmin
    // ออกเดินทางแล้วให้ยึดวันที่ออกจริงเสมอ ไม่ใช่วันที่ตามคำขอ ตารางนี้จะได้ตรงกับ trip_date
    // ที่รายงานใช้ (แถวเก่าก่อนแก้บั๊กนี้ยังไม่มี started_at จึงตกไปใช้ค่าเดิมตามลำดับเดิม)
    const dateStr = fmtDate(t.started_at || t.planned_departure || t.trip_date)
    const dist = t.distance_km ?? null
    return (
      <tr key={t.id} style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#f5f8fc' }}
          onClick={e => { if (e.target.closest('button')) return; openDetail(t) }}
          className="hover:bg-blue-50 transition-colors cursor-pointer">
        <td className="px-3 py-2.5 text-center text-xs text-gray-400 border-r border-gray-200">{idx + 1}</td>
        <td className="px-4 py-2.5 text-xs border-r border-gray-200">
          <div className="font-semibold text-gray-700">{dateStr}</div>
          {t.planned_departure && <div className="text-[10px] text-blue-400">📄 คำขอ</div>}
        </td>
        <td className="px-4 py-2.5 text-xs font-semibold text-gray-700 border-r border-gray-200 whitespace-nowrap">
          {t.vehicle?.name}
        </td>
        <td className="px-4 py-2.5 text-xs text-gray-600 border-r border-gray-200">{t.destination}</td>
        <td className="px-4 py-2.5 text-xs text-gray-500 border-r border-gray-200">{t.purpose}</td>
        <td className="px-4 py-2.5 text-xs text-gray-600 border-r border-gray-200 whitespace-nowrap">
          {t.driver?.full_name}
        </td>
        <td className="px-4 py-2.5 text-xs text-gray-500 border-r border-gray-200 text-right whitespace-nowrap">
          {dist != null ? `${dist.toLocaleString()} กม.` : '—'}
        </td>
        <td className="px-4 py-2.5 text-xs border-r border-gray-200">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
                style={{ backgroundColor: clr + '18', color: clr }}>
            {STATUS_LABEL[t.status]}
          </span>
        </td>
        <td className="px-3 py-2.5 text-xs">
          <div className="flex gap-1 justify-center flex-wrap">
            {canApprove && <>
              <button onClick={() => handleApprove(t)}
                className="px-2 py-1 rounded-lg bg-green-500 text-white text-[12px] font-bold">อนุมัติ</button>
              <button onClick={() => handleReject(t)}
                className="px-2 py-1 rounded-lg border border-red-200 text-red-500 text-[12px] font-bold">ปฏิเสธ</button>
            </>}
            {canCancel && (
              <button onClick={() => handleCancelOwn(t)}
                className="px-2 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-500 hover:text-white text-[12px] font-bold whitespace-nowrap transition-colors">
                ยกเลิกคำขอ
              </button>
            )}
            {canDepart && (
              <button onClick={() => {
                setSelTrip(t)
                setForm({ started_at: toLocalDT(new Date()), odometer_start: '' })
                setModal('depart')
              }} className="px-2 py-1 rounded-lg text-white text-[12px] font-bold whitespace-nowrap"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                🚀 ออก
              </button>
            )}
            {canReturn && (
              <button onClick={() => {
                setSelTrip(t)
                setForm({ returned_at: toLocalDT(new Date()), odometer_end: '', notes: '' })
                setModal('return')
              }} className="px-2 py-1 rounded-lg bg-green-600 text-white text-[12px] font-bold whitespace-nowrap">
                🏁 กลับ
              </button>
            )}
            {isAdmin && (
              <button onClick={() => handleDelete(t)}
                className="px-2 py-1 rounded-lg border border-red-300 text-red-400 hover:bg-red-400 hover:text-white text-[12px] font-bold transition-colors">
                ลบ
              </button>
            )}
          </div>
        </td>
      </tr>
    )
  }

  /* ── Table wrapper ── */
  function renderTripsTable(rows) {
    return (
      <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-300 shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ backgroundColor: '#1a3a5c' }}>
              {['ที่', 'วันที่', 'ยานพาหนะ', 'ปลายทาง', 'วัตถุประสงค์', 'ผู้ใช้รถ', 'ระยะทาง', 'สถานะ', 'ดำเนินการ'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-white border-r border-white/10 last:border-r-0 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => renderTripRow(t, i))}
          </tbody>
        </table>
      </div>
    )
  }

  if (loading) return (
    <div className="flex justify-center py-8">
      <div className="w-5 h-5 border-4 border-gray-200 rounded-full animate-spin"
           style={{ borderTopColor: 'var(--color-primary)' }} />
    </div>
  )

  return (
    <div className="space-y-3 md:space-y-5">

      {/* บอกสาเหตุตั้งแต่ต้น ดีกว่าปล่อยให้กดแล้วเจอ error จาก RLS ตอนบันทึก */}
      {missingDept && canWrite && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] md:text-xs text-amber-700">
          ⚠️ บัญชีของคุณยังไม่ได้กำหนด <strong>กอง/หน่วยงาน</strong> จึงยังขออนุญาตใช้รถหรือบันทึกการใช้รถย้อนหลังไม่ได้
          <span className="text-amber-600"> — แจ้งผู้ดูแลระบบให้กำหนดกองที่ ตั้งค่า &gt; เจ้าหน้าที่ยานพาหนะ</span>
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="flex items-center gap-1.5 md:gap-2 flex-nowrap md:flex-wrap">
        {canWrite && <button onClick={openReserve}
          className="flex items-center gap-1.5 px-3 py-2 md:px-4 md:py-2.5 rounded-lg md:rounded-xl text-[11px] md:text-xs font-bold border-2 text-blue-600 border-blue-300 bg-blue-50 hover:bg-blue-100 transition-colors">
          <Calendar size={13} /> ขออนุญาตใช้รถ
        </button>}
        {isAdmin && <button onClick={openDirect}
          className="flex items-center gap-1.5 px-3 py-2 md:px-4 md:py-2.5 rounded-lg md:rounded-xl text-[11px] md:text-xs font-bold text-white transition-colors"
          style={{ backgroundColor: 'var(--color-primary)' }}>
          <Plus size={13} />
          <span className="md:hidden">บันทึกย้อนหลัง</span>
          <span className="hidden md:inline">บันทึกการใช้รถย้อนหลัง</span>
        </button>}
        <button onClick={() => setShowCal(true)} aria-label="เปิดปฏิทินการใช้รถ"
          className="md:hidden ml-auto flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] font-bold text-blue-600 bg-blue-50">
          <Calendar size={13} /> ปฏิทิน
        </button>
      </div>

      {/* ── Active trips ── */}
      <div className="space-y-1.5 md:space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] md:text-xs font-bold text-gray-500 uppercase tracking-wide">
            คำขอและการใช้รถ{active.length > 0 && <span className="text-blue-500 normal-case ml-1">({active.length})</span>}
          </p>
          <button onClick={() => setShowCal(true)}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[13px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors">
            <Calendar size={13} /> ปฏิทินการใช้รถ
          </button>
        </div>
        {active.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <FleetEmptyState icon={Route} title="ยังไม่มีคำขอหรือรายการใช้รถที่ดำเนินการอยู่"
              hint={canWrite
                ? <>กด <strong className="text-gray-500">ขออนุญาตใช้รถ</strong> เพื่อส่งคำขอ</>
                : 'สิทธิ์ของท่านเป็นผู้ดูรายงาน จึงดูได้อย่างเดียว'} />
          </div>
        ) : <>
          {renderTripsTable(active)}
          <div className="md:hidden space-y-1.5">
            {active.map(renderTripCard)}
          </div>
        </>}
      </div>

      {/* ── History ── */}
      <div className="space-y-1.5 md:space-y-2">
        <p className="text-[11px] md:text-xs font-bold text-gray-500 uppercase tracking-wide">
          ประวัติการใช้รถ <span className="text-gray-400 normal-case">({historyCount})</span>
        </p>
        {historyCount === 0 ? (
          <FleetEmptyState icon={History} title="ยังไม่มีประวัติการใช้รถ" />
        ) : <>
          {renderTripsTable(pagedHistory)}
          <div className="md:hidden space-y-1.5">
            {pagedHistory.map(renderTripCard)}
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1 py-2 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <span>แสดง</span>
              <select value={historyPageSize}
                onChange={e => { setHistoryPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value)); setHistoryPage(0) }}
                className="bg-white border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-200">
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                <option value="all">ทั้งหมด</option>
              </select>
              <span>รายการ</span>
              <span className="text-gray-400">
                ({historyPageSize === 'all' ? 1 : historyCurrentPage * historyPageSize + 1}–{historyPageSize === 'all' ? historyCount : Math.min((historyCurrentPage + 1) * historyPageSize, historyCount)} จาก {historyCount})
              </span>
            </div>
            {historyPageSize !== 'all' && historyCount > historyPageSize && (
              <div className="flex items-center gap-2">
                <button onClick={() => setHistoryPage(p => Math.max(0, p - 1))} disabled={historyCurrentPage === 0}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white font-semibold disabled:opacity-40">ก่อนหน้า</button>
                <span>หน้า {historyCurrentPage + 1} / {historyTotalPages}</span>
                <button onClick={() => setHistoryPage(p => p + 1)} disabled={historyCurrentPage >= historyTotalPages - 1}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white font-semibold disabled:opacity-40">ถัดไป</button>
              </div>
            )}
          </div>
        </>}
      </div>

      {showCal && <BookingCalendar tenant={tenant} onClose={() => setShowCal(false)} />}

      {/* ═══ MODALS ═══ */}

      {/* รายละเอียด (คลิกแถว) */}
      {modal === 'detail' && selTrip && (() => {
        const t = selTrip
        const clr = STATUS_CLR[t.status]
        const canEdit = t.status === 'pending' && (isOwner(t) || isAdmin)
        return (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="text-base font-black text-gray-800">รายละเอียดการใช้รถ</h2>
                <button onClick={() => { setModal(null); setSelTrip(null) }}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
              </div>
              <div className="overflow-y-auto p-5 space-y-3 flex-1 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-gray-800">{t.vehicle?.name} · {assetIdentifier(t.vehicle)}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0"
                        style={{ backgroundColor: clr + '18', color: clr }}>{STATUS_LABEL[t.status]}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div><p className="text-gray-400">ผู้ขอใช้รถ</p><p className="font-semibold text-gray-700">{t.requester?.full_name || '—'}</p></div>
                  <div><p className="text-gray-400">ตำแหน่งผู้ขอ</p><p className="font-semibold text-gray-700">{t.requester_position || profilePosition(t.requester) || '—'}</p></div>
                  <div><p className="text-gray-400">พนักงานขับรถ / ผู้ใช้รถ</p><p className="font-semibold text-gray-700">{t.driver?.full_name || '—'}</p></div>
                  <div><p className="text-gray-400">กอง/หน่วยงาน</p><p className="font-semibold text-gray-700">{t.departments?.name || '—'}</p></div>
                  <div><p className="text-gray-400">ผู้ร่วมเดินทาง</p><p className="font-semibold text-gray-700">{t.passengers ?? 1} คน <span className="font-normal text-gray-400">(ไม่รวมคนขับ)</span></p></div>
                  <div className="col-span-2"><p className="text-gray-400">ปลายทาง</p><p className="font-semibold text-gray-700">{t.destination || '—'}</p></div>
                  <div><p className="text-gray-400">ในท้องที่</p><p className="font-semibold text-gray-700">{t.destination_locality || '—'}</p></div>
                  <div><p className="text-gray-400">จังหวัด</p><p className="font-semibold text-gray-700">{t.destination_province || '—'}</p></div>
                  <div className="col-span-2"><p className="text-gray-400">วัตถุประสงค์</p><p className="font-semibold text-gray-700">{t.purpose || '—'}</p></div>
                  {t.planned_departure && <>
                    <div><p className="text-gray-400">วันเวลาออก (ตามคำขอ)</p><p className="font-semibold text-gray-700">{fmtDT(t.planned_departure)}</p></div>
                    <div><p className="text-gray-400">กลับโดยประมาณ</p><p className="font-semibold text-gray-700">{fmtDT(t.planned_return)}</p></div>
                  </>}
                  {t.started_at && <div><p className="text-gray-400">ออกจริง</p><p className="font-semibold text-gray-700">{fmtDT(t.started_at)}{t.odometer_start != null ? ` · ${Number(t.odometer_start).toLocaleString()} กม.` : ''}</p></div>}
                  {t.returned_at && <div><p className="text-gray-400">กลับจริง</p><p className="font-semibold text-gray-700">{fmtDT(t.returned_at)}{t.odometer_end != null ? ` · ${Number(t.odometer_end).toLocaleString()} กม.` : ''}</p></div>}
                  {t.distance_km != null && <div><p className="text-gray-400">ระยะทาง</p><p className="font-semibold text-gray-700">{Number(t.distance_km).toLocaleString()} กม.</p></div>}
                  {t.approver?.full_name && <div>
                    <p className="text-gray-400">{t.status === 'rejected' ? 'ผู้ปฏิเสธ' : t.status === 'cancelled' ? 'ผู้ดำเนินการ' : 'ผู้อนุมัติ'}</p>
                    <p className="font-semibold text-gray-700">{t.approver.full_name}{t.approved_at ? ` · ${fmtDT(t.approved_at)}` : ''}</p>
                  </div>}
                  {t.backdated_reason && <div className="col-span-2"><p className="text-gray-400">เหตุผลที่บันทึกย้อนหลัง</p><p className="font-semibold text-amber-600">{t.backdated_reason}</p></div>}
                  {t.reject_reason && <div className="col-span-2"><p className="text-gray-400">เหตุผลปฏิเสธ/ยกเลิก</p><p className="font-semibold text-red-600">{t.reject_reason}</p></div>}
                  {t.notes && <div className="col-span-2"><p className="text-gray-400">หมายเหตุ</p><p className="font-semibold text-gray-700">{t.notes}</p></div>}
                </div>
              </div>
              <div className={`grid grid-cols-1 gap-2 px-5 pb-5 pt-3 border-t border-gray-100 ${canEdit ? 'sm:grid-cols-2' : ''}`}>
                <button onClick={() => printTripRequest(t)}
                  className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50">
                  <Printer size={15} /> พิมพ์ใบขอใช้รถ (แบบ 3)
                </button>
                {canEdit && (
                  <button onClick={() => openEditReserve(t)}
                    className="rounded-xl py-3 text-sm font-bold text-white"
                    style={{ backgroundColor: 'var(--color-primary)' }}>
                    ✏️ แก้ไขคำขอ
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ขอใช้รถ / แก้ไขคำขอใช้รถ */}
      {modal === 'reserve' && (
        <Modal title={selTrip ? '✏️ แก้ไขใบขอใช้รถ (แบบ 3)' : '📄 ใบขออนุญาตใช้รถส่วนกลาง (แบบ 3)'}
               onClose={() => { setModal(null); setSelTrip(null); setConflict(null); setShowOverride(false); setOverrideReason('') }}
               onSave={submitReserve}
               saveLabel={selTrip ? 'บันทึกการแก้ไข' : 'ส่งคำขออนุญาตใช้รถ'} saving={saving}>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs">
            <p className="text-blue-500">ผู้ขอใช้รถ</p>
            <p className="mt-0.5 font-bold text-gray-800">
              {selTrip?.requester?.full_name || requesterProfile?.full_name || 'บัญชีผู้ใช้ปัจจุบัน'}
            </p>
            <p className="mt-1 text-[11px] text-gray-500">ระบบยืนยันผู้ขอจากบัญชีที่เข้าสู่ระบบและเก็บเป็นหลักฐาน ไม่ให้เลือกชื่อแทนกัน</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ตำแหน่งผู้ขอ *</label>
            <input value={form.requester_position || ''} onChange={set('requester_position')}
              readOnly={!!selTrip || !!profilePosition(requesterProfile)}
              placeholder="เช่น นักวิชาการสาธารณสุข"
              className={inp + ((selTrip || profilePosition(requesterProfile)) ? ' bg-gray-50 text-gray-500' : '')} />
            <p className="mt-1 text-[10px] text-gray-400">บันทึกเป็น snapshot ณ วันยื่นคำขอ เพื่อให้เอกสารย้อนหลังไม่เปลี่ยนตามตำแหน่งปัจจุบัน</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ยานพาหนะ *</label>
            <select value={form.vehicle_id}
              onChange={e => { set('vehicle_id')(e); setConflict(null); setShowOverride(false) }} className={sel}>
              <option value="">— เลือกรถ —</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{assetOptionLabel(v)}</option>)}
            </select>
          </div>
          {conflict && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600 space-y-2">
              <p className="font-semibold">
                ⚠️ รถคันนี้มีคำขอใช้รถในช่วงเวลาดังกล่าวแล้ว
                {conflict.trips[0]?.driver?.full_name ? ` โดย ${conflict.trips[0].driver.full_name}` : ''}
                {conflict.trips[0]?.destination ? ` (${conflict.trips[0].destination})` : ''}
              </p>
              {conflict.altVehicles.length > 0 && (
                <div>
                  <p className="text-gray-500 mb-1">รถคันอื่นที่ว่างช่วงเวลานี้ — กดเพื่อเปลี่ยน:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {conflict.altVehicles.map(v => (
                      <button key={v.id} type="button"
                        onClick={() => { setForm(f => ({ ...f, vehicle_id: v.id })); setConflict(null); setShowOverride(false) }}
                        className="px-2 py-1 rounded-lg bg-white border border-green-300 text-green-600 font-semibold hover:bg-green-50">
                        {assetOptionLabel(v)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {isAdmin && (showOverride ? (
                <div className="space-y-1.5 pt-1.5 border-t border-red-100">
                  <label className="text-[11px] font-semibold text-gray-600 block">เหตุผลความจำเป็นเร่งด่วน (บังคับกรอก) *</label>
                  <textarea value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                    rows={2} placeholder="เช่น ผู้บริหารเรียกประชุมด่วนนอกสถานที่"
                    className="w-full px-2.5 py-2 text-xs text-gray-900 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2" />
                  <div className="flex gap-2">
                    <button type="button" onClick={submitOverrideReserve} disabled={saving}
                      className="flex-1 py-2 rounded-lg text-white text-xs font-bold bg-red-600 disabled:opacity-50">
                      {saving ? 'กำลังบันทึก...' : 'ยืนยันใช้รถแทนคิวเดิม (ยกเลิกคำขอเดิม)'}
                    </button>
                    <button type="button" onClick={() => { setShowOverride(false); setOverrideReason('') }}
                      className="px-3 py-2 rounded-lg border border-gray-200 text-gray-500 text-xs font-semibold">ยกเลิก</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setShowOverride(true)}
                  className="text-red-700 underline font-semibold">
                  🚨 จำเป็นต้องใช้รถคันนี้จริงๆ — ใช้รถแทนคิวเดิมกรณีฉุกเฉิน (Admin เท่านั้น)
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">วันเวลาออก *</label>
              <input type="datetime-local" value={form.planned_departure}
                onChange={e => { set('planned_departure')(e); setConflict(null); setShowOverride(false) }} className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">กลับโดยประมาณ *</label>
              <input type="datetime-local" value={form.planned_return}
                onChange={e => { set('planned_return')(e); setConflict(null); setShowOverride(false) }} className={inp} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">พนักงานขับรถ / ผู้ใช้รถ</label>
            <select value={form.driver_id} onChange={set('driver_id')} className={sel}>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{userOptionLabel(s, user?.id)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">จำนวนผู้ร่วมเดินทาง (รวมผู้ขอ) *</label>
            <input type="number" min="1" max="100" step="1" value={form.passengers}
              onChange={set('passengers')} className={inp} />
            <p className="mt-1 text-[10px] text-gray-400">ไม่รวมพนักงานขับรถ</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">กอง/หน่วยงาน</label>
            {deptLocked ? (
              // ไม่ใช่ manager: RLS ยอมรับเฉพาะกองของตัวเอง แสดงเป็นช่องล็อกไม่ให้เลือกผิดจนโดนปฏิเสธ
              <input value={myDeptName || '—'} disabled readOnly
                className={inp + ' bg-gray-50 text-gray-500 cursor-not-allowed'} />
            ) : (
              <select value={form.department_id} onChange={set('department_id')} className={sel}>
                <option value="">ทุกกอง</option>
                {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">สถานที่ไป *</label>
            <input value={form.destination} onChange={set('destination')}
              placeholder="เช่น ศาลากลางจังหวัดแพร่" className={inp} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">ในท้องที่ *</label>
              <input value={form.destination_locality} onChange={set('destination_locality')}
                placeholder="เช่น อำเภอเมืองแพร่" className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">จังหวัด *</label>
              <input value={form.destination_province} onChange={set('destination_province')}
                placeholder="เช่น แพร่" className={inp} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">วัตถุประสงค์ *</label>
            <input value={form.purpose} onChange={set('purpose')}
              placeholder="เช่น ประชุมราชการ" className={inp} />
          </div>
        </Modal>
      )}

      {/* บันทึกการใช้รถย้อนหลัง — สำหรับกรณีที่ใช้รถไปแล้ว ไม่ใช้แทนขั้นขออนุญาตตามปกติ */}
      {modal === 'direct' && (
        <Modal title="📝 บันทึกการใช้รถย้อนหลัง" onClose={() => setModal(null)} onSave={submitDirect}
               saveLabel="บันทึก" saving={saving}>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs">
            <p className="text-blue-500">ผู้บันทึก/ผู้ขอใช้รถ</p>
            <p className="mt-0.5 font-bold text-gray-800">{requesterProfile?.full_name || 'บัญชีผู้ใช้ปัจจุบัน'}</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-700">
            ⚠️ รายการนี้จะถูกบันทึกเป็น <strong>“เสร็จสิ้น”</strong> ทันทีโดยไม่ผ่านขั้นอนุมัติ
            ใบขออนุญาตใช้รถที่พิมพ์จากรายการนี้จะไม่มีผู้อนุมัติ ใช้เฉพาะกรณีที่ใช้รถไปแล้วจริงเท่านั้น
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">เหตุผลที่บันทึกย้อนหลัง *</label>
            <textarea value={form.backdated_reason || ''} onChange={set('backdated_reason')} rows={2}
              placeholder="เช่น เหตุฉุกเฉินนอกเวลาราชการ ยังไม่ได้ยื่นคำขอล่วงหน้า"
              className={inp} />
            <p className="mt-1 text-[10px] text-gray-400">พิมพ์กำกับไว้ในใบขออนุญาตใช้รถ เพื่อให้ตรวจสอบย้อนหลังได้</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ตำแหน่งผู้ขอ</label>
            <input value={form.requester_position || ''} onChange={set('requester_position')}
              readOnly={!!profilePosition(requesterProfile)}
              placeholder="เช่น นักวิชาการสาธารณสุข"
              className={inp + (profilePosition(requesterProfile) ? ' bg-gray-50 text-gray-500' : '')} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ยานพาหนะ *</label>
            <select value={form.vehicle_id} onChange={set('vehicle_id')} className={sel}>
              <option value="">— เลือกรถ —</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{assetOptionLabel(v)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">จำนวนผู้ร่วมเดินทาง (รวมผู้ขอ) *</label>
            <input type="number" min="1" max="100" step="1" value={form.passengers}
              onChange={set('passengers')} className={inp} />
            <p className="mt-1 text-[10px] text-gray-400">ไม่รวมพนักงานขับรถ</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ผู้ใช้รถ</label>
            <select value={form.driver_id} onChange={set('driver_id')} className={sel}>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{userOptionLabel(s, user?.id)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">กอง/หน่วยงาน</label>
            {deptLocked ? (
              // ไม่ใช่ manager: RLS ยอมรับเฉพาะกองของตัวเอง แสดงเป็นช่องล็อกไม่ให้เลือกผิดจนโดนปฏิเสธ
              <input value={myDeptName || '—'} disabled readOnly
                className={inp + ' bg-gray-50 text-gray-500 cursor-not-allowed'} />
            ) : (
              <select value={form.department_id} onChange={set('department_id')} className={sel}>
                <option value="">ทุกกอง</option>
                {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">ปลายทาง *</label>
            <input value={form.destination} onChange={set('destination')}
              placeholder="เช่น อำเภอเมือง" className={inp} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">ในท้องที่ *</label>
              <input value={form.destination_locality} onChange={set('destination_locality')}
                placeholder="เช่น อำเภอเมืองแพร่" className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">จังหวัด *</label>
              <input value={form.destination_province} onChange={set('destination_province')}
                placeholder="เช่น แพร่" className={inp} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">วัตถุประสงค์ *</label>
            <input value={form.purpose} onChange={set('purpose')}
              placeholder="เช่น ประชุมราชการ" className={inp} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">วันเวลาออก *</label>
              <input type="datetime-local" value={form.started_at} onChange={set('started_at')} className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">วันเวลากลับ</label>
              <input type="datetime-local" value={form.returned_at} onChange={set('returned_at')} className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์ก่อน (กม.)</label>
              <input type="number" value={form.odometer_start} onChange={set('odometer_start')}
                placeholder="0" className={inp} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์หลัง (กม.)</label>
              <input type="number" value={form.odometer_end} onChange={set('odometer_end')}
                placeholder="0" className={inp} />
            </div>
          </div>
          {form.odometer_start && form.odometer_end && Number(form.odometer_end) > Number(form.odometer_start) && (
            <div className="bg-gray-50 rounded-xl p-2.5 text-xs text-center font-bold text-gray-700">
              📏 ระยะทาง: {(Number(form.odometer_end) - Number(form.odometer_start)).toLocaleString()} กม.
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">หมายเหตุ</label>
            <input value={form.notes} onChange={set('notes')} className={inp} />
          </div>
        </Modal>
      )}

      {/* บันทึกออกเดินทาง */}
      {/* ปฏิเสธคำขอใช้รถ — บังคับระบุเหตุผล */}
      {modal === 'reject' && selTrip && (
        <Modal title="⛔ ปฏิเสธคำขอใช้รถ"
               onClose={() => { setModal(null); setSelTrip(null); setRejectReason('') }}
               onSave={submitReject} saveLabel="ยืนยันปฏิเสธ" saving={saving}>
          <div className="bg-red-50 rounded-xl p-3">
            <p className="text-sm font-bold text-gray-800">
              {selTrip.vehicle?.name} · {assetIdentifier(selTrip.vehicle)}
            </p>
            <p className="text-xs text-gray-600">{selTrip.destination} — {selTrip.purpose}</p>
            <p className="text-xs text-red-500 mt-1">👤 {selTrip.driver?.full_name}</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">เหตุผลการปฏิเสธ (บังคับกรอก) *</label>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
              placeholder="เช่น รถติดภารกิจผู้บริหาร / เอกสารขออนุมัติไม่ครบ / ซ้อนกับงานเร่งด่วน"
              className={inp} />
            <p className="text-[11px] text-gray-400 mt-1">
              ผู้ขอจะเห็นเหตุผลนี้ในหน้ารายละเอียดการใช้รถ และระบบเก็บไว้ในประวัติการใช้งานเพื่อการตรวจสอบ
            </p>
          </div>
        </Modal>
      )}

      {/* ผู้ขอใช้รถถอนคำขอของตัวเอง — บังคับระบุเหตุผลเช่นกัน */}
      {modal === 'cancel' && selTrip && (
        <Modal title="✕ ยกเลิกคำขอใช้รถ"
               onClose={() => { setModal(null); setSelTrip(null); setRejectReason('') }}
               onSave={submitCancelOwn} saveLabel="ยืนยันยกเลิกคำขอ" saving={saving}>
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-sm font-bold text-gray-800">
              {selTrip.vehicle?.name} · {assetIdentifier(selTrip.vehicle)}
            </p>
            <p className="text-xs text-gray-600">{selTrip.destination} — {selTrip.purpose}</p>
            {selTrip.planned_departure && (
              <p className="text-xs text-gray-500 mt-1">🗓 {fmtDT(selTrip.planned_departure)} – {fmtDT(selTrip.planned_return)}</p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">เหตุผลการยกเลิก (บังคับกรอก) *</label>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
              placeholder="เช่น เลื่อนกำหนดการประชุม / ระบุวันขอใช้รถผิด / ไปรถส่วนตัวแทน"
              className={inp} />
            <p className="text-[11px] text-gray-400 mt-1">
              ยกเลิกได้เฉพาะคำขอที่ยังไม่ถูกพิจารณา ระบบบันทึกว่าผู้ขอใช้รถเป็นผู้ยกเลิกเอง
              พร้อมเหตุผล เพื่อแยกจากกรณีที่ผู้มีอำนาจปฏิเสธ
            </p>
          </div>
        </Modal>
      )}

      {modal === 'depart' && selTrip && (
        <Modal title="🚀 บันทึกออกเดินทาง"
               onClose={() => { setModal(null); setSelTrip(null) }}
               onSave={submitDepart} saveLabel="ยืนยันออกเดินทาง" saving={saving}>
          <div className="bg-blue-50 rounded-xl p-3">
            <p className="text-sm font-bold text-gray-800">
              {selTrip.vehicle?.name} · {assetIdentifier(selTrip.vehicle)}
            </p>
            <p className="text-xs text-gray-600">{selTrip.destination} — {selTrip.purpose}</p>
            <p className="text-xs text-blue-500 mt-1">👤 {selTrip.driver?.full_name}</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">เวลาออกจริง *</label>
            <input type="datetime-local" value={form.started_at} onChange={set('started_at')} className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์ก่อนออก (กม.)</label>
            <input type="number" value={form.odometer_start} onChange={set('odometer_start')}
              placeholder="เช่น 12345" className={inp} />
          </div>
        </Modal>
      )}

      {/* บันทึกกลับถึง */}
      {modal === 'return' && selTrip && (
        <Modal title="🏁 บันทึกกลับถึง"
               onClose={() => { setModal(null); setSelTrip(null) }}
               onSave={submitReturn} saveLabel="ยืนยันกลับถึง" saving={saving}>
          <div className="bg-green-50 rounded-xl p-3">
            <p className="text-sm font-bold text-gray-800">
              {selTrip.vehicle?.name} · {assetIdentifier(selTrip.vehicle)}
            </p>
            <p className="text-xs text-gray-600">{selTrip.destination} — {selTrip.purpose}</p>
            {selTrip.odometer_start && (
              <p className="text-xs text-green-600 mt-1">
                เลขไมล์ก่อนออก: {Number(selTrip.odometer_start).toLocaleString()} กม.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">เวลากลับจริง *</label>
            <input type="datetime-local" value={form.returned_at} onChange={set('returned_at')} className={inp} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">เลขไมล์หลังกลับ (กม.)</label>
            <input type="number" value={form.odometer_end} onChange={set('odometer_end')}
              placeholder="เช่น 12400" className={inp} />
          </div>
          {selTrip.odometer_start && form.odometer_end && Number(form.odometer_end) > Number(selTrip.odometer_start) && (
            <div className="bg-gray-50 rounded-xl p-2.5 text-sm text-center font-bold text-gray-700">
              📏 ระยะทาง: {(Number(form.odometer_end) - Number(selTrip.odometer_start)).toLocaleString()} กม.
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1 block">หมายเหตุ</label>
            <input value={form.notes} onChange={set('notes')} className={inp} />
          </div>
        </Modal>
      )}

    </div>
  )
}
