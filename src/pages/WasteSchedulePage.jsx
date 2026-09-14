import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CalendarClock, ChevronDown, Info, Share2, Truck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import ModuleLink from '../components/common/ModuleLink'
import { appUrl } from '../lib/basename'
import { todayStr } from '../lib/thaiDate'
import {
  WASTE_TYPES, addDays, computeCollections, dayIndex, describeRule, missedPickupDetail,
  mooListText, nextCollection, parseMooNo, thaiLongDate, thaiShortDate, timeText, villageLabel,
} from '../lib/wasteSchedule'
import { HAZARDOUS_EXAMPLES, HAZARDOUS_HANDLING } from '../lib/wasteSchedulePosterPrint'

const UPCOMING_DAYS = 60
// แถบเตือนงด/เลื่อนแสดงล่วงหน้าเท่านี้ — ไกลกว่านี้คนลืมก่อนถึงวันอยู่ดี และแถบยาวจนบังรอบถัดไป
const ALERT_DAYS = 14
// "รถไม่มาเก็บ" ย้อนดูได้เท่านี้ — เรื่องที่เกินนี้แจ้งเป็นคำร้องทั่วไปได้อยู่แล้ว
const MISSED_LOOKBACK_DAYS = 2

const mooStorageKey = (tenantId) => `sl_waste_moo_${tenantId}`

function readSavedMoo(tenantId) {
  try { return parseMooNo(localStorage.getItem(mooStorageKey(tenantId))) } catch { return null }
}

function relativeDay(date, today) {
  const diff = dayIndex(date) - dayIndex(today)
  if (diff === 0) return 'วันนี้'
  if (diff === 1) return 'พรุ่งนี้'
  return `อีก ${diff} วัน`
}

function statusText(item) {
  const type = WASTE_TYPES[item.waste_type].label
  const reason = item.reason ? ` (${item.reason})` : ''
  if (item.status === 'cancelled') return `งดเก็บ${type} ${thaiLongDate(item.originalDate)}${reason}`
  return `เลื่อนเก็บ${type} จาก${thaiLongDate(item.originalDate)} เป็น${thaiLongDate(item.date)}${reason}`
}

/**
 * ตารางวันเก็บขยะ — ฝั่งประชาชน (ไม่ต้องล็อกอิน)
 *
 * วันที่ทั้งหมดคำนวณในเครื่องจากกฎที่เจ้าหน้าที่ตั้งไว้ครั้งเดียว (src/lib/wasteSchedule.js)
 * การงด/เลื่อนตรงวันหยุดราชการเกิดขึ้นเองตาม holiday_policy ของแต่ละรอบ ไม่มีใครต้องกดประกาศ
 */
export default function WasteSchedulePage() {
  const navigate = useNavigate()
  const { tenant, loading: tenantLoading, holidaysVersion } = useTenant()
  const { session } = useAuth()
  const [data, setData] = useState(null)   // null = ยังไม่โหลด
  const [loadError, setLoadError] = useState(false)
  // หมู่ที่ใช้ = ที่ผู้ใช้เลือกในหน้านี้ > ที่เคยเลือกไว้ในเครื่อง > หมู่ในโปรไฟล์
  const [mooChoice, setMooChoice] = useState(null)
  const [profileMoo, setProfileMoo] = useState(null)
  const tenantId = tenant?.id
  const savedMoo = useMemo(() => (tenantId ? readSavedMoo(tenantId) : null), [tenantId])
  // mooChoice: null = ยังไม่ได้เลือกในหน้านี้ · 0 = ผู้ใช้กดล้างเป็น "เลือกหมู่" เอง (ต้องไม่ย้อนไปใช้ค่าเดิม)
  const mooNo = mooChoice !== null ? (mooChoice || null) : (savedMoo ?? profileMoo)
  const today = todayStr()

  useEffect(() => {
    if (!tenant?.id) return
    let alive = true
    // อ่านผ่าน RPC — ผู้ไม่ล็อกอินอ่านตารางตรงไม่ได้ และ RPC บังคับให้ระบุ อปท. เสมอ
    supabase.rpc('get_public_waste_schedule', { _municipality_id: tenant.id })
      .then(({ data: result, error }) => {
        if (!alive) return
        if (error) { setLoadError(true); setData({ villages: [], schedules: [], exceptions: [] }); return }
        setLoadError(false)
        setData(result ?? { villages: [], schedules: [], exceptions: [] })
      })
    return () => { alive = false }
  }, [tenant?.id])

  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) return
    let alive = true
    supabase.from('profiles').select('address_moo').eq('id', userId).maybeSingle()
      .then(({ data: profile }) => { if (alive) setProfileMoo(parseMooNo(profile?.address_moo)) })
    return () => { alive = false }
  }, [session?.user?.id])

  const villages = useMemo(() => data?.villages ?? [], [data])
  const schedules = useMemo(() => data?.schedules ?? [], [data])
  const exceptions = useMemo(() => data?.exceptions ?? [], [data])

  // หมู่ในโปรไฟล์/ในเครื่องอาจไม่อยู่ในทะเบียนแล้ว (แอดมินลดจำนวนหมู่) — ถือว่ายังไม่เลือก
  const selectedMoo = villages.length === 0
    ? null
    : (villages.some(v => v.moo_no === mooNo) ? mooNo : null)
  const needMoo = villages.length > 0 && !selectedMoo

  const items = useMemo(() => {
    // holidaysVersion: วันหยุดโหลดจากฐานข้อมูลหลังหน้าจอขึ้น ต้องคำนวณใหม่เมื่อมาถึง
    void holidaysVersion
    if (needMoo) return []
    return computeCollections({
      schedules, exceptions, mooNo: selectedMoo,
      from: addDays(today, -MISSED_LOOKBACK_DAYS), days: UPCOMING_DAYS + MISSED_LOOKBACK_DAYS,
    })
  }, [schedules, exceptions, selectedMoo, needMoo, today, holidaysVersion])

  const upcoming = items.filter(i => (i.status === 'cancelled' ? i.originalDate : i.date) >= today)
  const alerts = upcoming.filter(i => i.status !== 'normal'
    && dayIndex(i.status === 'cancelled' ? i.originalDate : i.date) - dayIndex(today) <= ALERT_DAYS)
  // เฉพาะประเภทที่มีรอบครอบหมู่ที่เลือกจริง — ถ้าใช้ทุกรอบในพื้นที่ หมู่ที่ไม่มีรอบขยะทั่วไปเลย
  // จะเห็นการ์ด "ยังไม่มีรอบใน 60 วัน" แล้วเข้าใจว่ามีรอบแต่ยังไม่ถึง (เจอจาก E2E บน demo)
  const coversSelected = (s) => !selectedMoo || (s.moo_nos ?? []).length === 0 || s.moo_nos.includes(selectedMoo)
  const types = Object.keys(WASTE_TYPES).filter(t => schedules.some(s => s.waste_type === t && coversSelected(s)))
  const hasHazardousInfo = schedules.some(s => s.waste_type === 'hazardous')
  // รอบของวันนี้เสนอปุ่มได้ต่อเมื่อพ้นเวลาเก็บแล้วเท่านั้น — ถ้าขึ้นตั้งแต่เช้า คนจะกดแจ้งทั้งที่รถยังไม่ถึงคิว
  // กลายเป็นคำร้องเกินจริงที่เจ้าหน้าที่ต้องมาปิดทีละเรื่อง (ขัดหลัก "ระบบต้องไม่เพิ่มงาน")
  const nowHHMM = new Date().toTimeString().slice(0, 5)
  const todayIsOver = (item) => nowHHMM >= (item.schedule?.time_to?.slice(0, 5) || '17:00')
  const recentMissed = items.find(i => i.status !== 'cancelled' && i.date === today && todayIsOver(i))
    ?? [...items].reverse()
      .find(i => i.status !== 'cancelled' && i.date < today && i.date >= addDays(today, -MISSED_LOOKBACK_DAYS))

  const loading = tenantLoading || Boolean(tenant?.id && data === null)

  function chooseMoo(value) {
    const n = parseMooNo(value)
    setMooChoice(n ?? 0)
    try {
      if (n) localStorage.setItem(mooStorageKey(tenant.id), String(n))
      else localStorage.removeItem(mooStorageKey(tenant.id))
    } catch { /* โหมดส่วนตัว/บล็อกที่เก็บข้อมูล — ยังใช้งานได้ แค่ไม่จำหมู่ */ }
  }

  const shareText = [
    `ตารางวันเก็บขยะ ${tenant?.name ?? ''}`.trim(),
    selectedMoo ? villageLabel(selectedMoo, villages) : '',
    ...types.map(t => {
      const next = nextCollection(upcoming, t, today)
      return next ? `${WASTE_TYPES[t].label}: ${thaiLongDate(next.date)}` : ''
    }),
    appUrl('/waste'),
  ].filter(Boolean).join('\n')

  return (
    <div className="max-w-lg mx-auto pb-28 md:pb-8">
      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-30 px-4 pt-3 pb-2 bg-gray-50/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">ตารางวันเก็บขยะ</h1>
        </div>
      </div>

      {/* PC header */}
      <div className="hidden md:flex items-center gap-3 px-4 pt-8 pb-5 border-b border-gray-100 mb-2">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0 bg-emerald-100">🗑️</div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">ตารางวันเก็บขยะ</h1>
          <p className="text-sm text-gray-500 mt-0.5">วันที่รถเก็บขยะเข้าหมู่บ้านของท่าน</p>
        </div>
      </div>

      <div className="px-4 pt-1 md:pt-4 space-y-4">
        {loading ? (
          <div className="space-y-3">
            {[0, 1].map(i => <div key={i} className="h-24 rounded-2xl bg-gray-100 animate-pulse" />)}
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            โหลดตารางเก็บขยะไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
          </div>
        ) : schedules.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
            <CalendarClock size={32} className="mx-auto text-gray-300" />
            <p className="mt-2 text-sm font-semibold text-gray-700">ยังไม่มีข้อมูลรอบเก็บขยะ</p>
            <p className="mt-1 text-xs text-gray-500">สอบถามวันเก็บขยะได้ที่หน่วยงานโดยตรง</p>
          </div>
        ) : (
          <>
            {villages.length > 0 && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-gray-500">หมู่บ้านของท่าน</span>
                <select value={selectedMoo ?? ''} onChange={e => chooseMoo(e.target.value)}
                  className="w-full min-h-[48px] rounded-xl border border-gray-200 bg-white px-3 text-base font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-200">
                  <option value="">— เลือกหมู่ —</option>
                  {villages.map(v => <option key={v.moo_no} value={v.moo_no}>{villageLabel(v.moo_no, villages)}</option>)}
                </select>
              </label>
            )}

            {needMoo ? (
              // ยังไม่เลือกหมู่: แสดงกฎรวมไว้ก่อน ไม่ใช่จอว่าง — คนที่แค่อยากรู้คร่าวๆ ไม่ต้องเลือกก็ได้คำตอบ
              <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-3">
                <p className="text-sm text-gray-600">เลือกหมู่ด้านบนเพื่อดูวันเก็บครั้งถัดไป — รอบเก็บทั้งหมดในพื้นที่:</p>
                {schedules.map(s => (
                  <div key={s.id} className="flex items-start gap-3">
                    <span className="text-xl">{WASTE_TYPES[s.waste_type].emoji}</span>
                    <div>
                      <p className="text-sm font-bold text-gray-800">{describeRule(s)} {timeText(s) && `· ${timeText(s)}`}</p>
                      <p className="text-xs text-gray-500">{WASTE_TYPES[s.waste_type].label} · {mooListText(s.moo_nos)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {alerts.map((item, i) => (
                  <div key={`alert-${i}`} role="alert"
                    className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${item.status === 'cancelled'
                      ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                    <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                    <span className="font-semibold">{statusText(item)}</span>
                  </div>
                ))}

                {types.length === 0 && (
                  <div className="rounded-2xl border border-gray-100 bg-white p-5 text-center">
                    <p className="text-sm font-semibold text-gray-700">{villageLabel(selectedMoo, villages)} ยังไม่มีรอบเก็บขยะในระบบ</p>
                    <p className="mt-1 text-xs text-gray-500">สอบถามวันเก็บขยะได้ที่หน่วยงานโดยตรง</p>
                  </div>
                )}

                <div className="grid gap-3">
                  {types.map(t => {
                    const meta = WASTE_TYPES[t]
                    const next = nextCollection(upcoming, t, today)
                    return (
                      <div key={t} className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: meta.bg }}>
                        <div className="flex items-center gap-3">
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl" style={{ background: meta.bg }}>{meta.emoji}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold" style={{ color: meta.color }}>{meta.label} · ครั้งถัดไป</p>
                            {next ? (
                              <>
                                <p className="text-lg font-bold text-gray-900 leading-tight">{thaiLongDate(next.date)}</p>
                                <p className="text-sm text-gray-600">
                                  <span className="font-semibold" style={{ color: meta.color }}>{relativeDay(next.date, today)}</span>
                                  {timeText(next.schedule) && ` · ${timeText(next.schedule)}`}
                                </p>
                              </>
                            ) : (
                              <p className="text-sm text-gray-500">ยังไม่มีรอบเก็บใน {UPCOMING_DAYS} วันข้างหน้า</p>
                            )}
                          </div>
                        </div>
                        {next?.schedule && (
                          <p className="mt-2 text-xs text-gray-500">
                            ปกติ{describeRule(next.schedule)}{next.schedule.note ? ` · ${next.schedule.note}` : ''}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>

                {upcoming.length > 0 && (
                  <div className="rounded-2xl border border-gray-100 bg-white">
                    <p className="border-b border-gray-50 px-4 py-3 text-sm font-bold text-gray-800">วันเก็บ {UPCOMING_DAYS} วันข้างหน้า</p>
                    <ul className="divide-y divide-gray-50">
                      {upcoming.map((item, i) => {
                        const meta = WASTE_TYPES[item.waste_type]
                        const cancelled = item.status === 'cancelled'
                        return (
                          <li key={i} className={`flex items-center gap-3 px-4 py-2.5 ${cancelled ? 'opacity-60' : ''}`}>
                            <span className="text-lg">{meta.emoji}</span>
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-semibold text-gray-800 ${cancelled ? 'line-through' : ''}`}>
                                {thaiShortDate(cancelled ? item.originalDate : item.date)}
                              </p>
                              <p className="text-xs text-gray-500">
                                {meta.label}
                                {item.status === 'moved' && ` · เลื่อนจาก ${thaiShortDate(item.originalDate)}`}
                                {cancelled && ' · งดเก็บ'}
                                {item.reason && ` · ${item.reason}`}
                              </p>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {recentMissed && (
                  <ModuleLink
                    to={`/request?category=trash&detail=${encodeURIComponent(missedPickupDetail({ item: recentMissed, mooNo: selectedMoo, villages }))}`}
                    className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 active:bg-gray-50">
                    <Truck size={20} className="shrink-0 text-gray-500" />
                    <span className="flex-1 text-sm text-gray-700">
                      รถไม่มาเก็บ{WASTE_TYPES[recentMissed.waste_type].label}{recentMissed.date === today ? 'วันนี้' : `เมื่อ${thaiShortDate(recentMissed.date)}`}?
                      <span className="block text-xs text-gray-500">แจ้งเจ้าหน้าที่ — ระบบกรอกวันที่และหมู่ให้แล้ว</span>
                    </span>
                  </ModuleLink>
                )}
              </>
            )}

            {hasHazardousInfo && (
              <details className="group rounded-2xl border border-amber-100 bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold text-amber-800">
                  <Info size={17} /> ขยะอันตรายคืออะไร เตรียมอย่างไร
                  <ChevronDown size={16} className="ml-auto transition-transform group-open:rotate-180" />
                </summary>
                <div className="space-y-3 px-4 pb-4 text-sm text-gray-700">
                  <ul className="list-disc pl-5">{HAZARDOUS_EXAMPLES.map(t => <li key={t}>{t}</li>)}</ul>
                  <ul className="list-disc pl-5">{HAZARDOUS_HANDLING.map(t => <li key={t}>{t}</li>)}</ul>
                </div>
              </details>
            )}

            {/* แชร์ด้วยลิงก์ของ LINE เอง ไม่ใช้ Messaging API — ไม่มีค่าใช้จ่ายและไม่นับโควตาข้อความ */}
            <a href={`https://line.me/R/msg/text/?${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer"
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#06C755] px-4 text-sm font-bold text-white">
              <Share2 size={17} /> แชร์ตารางเข้ากลุ่ม LINE หมู่บ้าน
            </a>
          </>
        )}
      </div>
    </div>
  )
}
