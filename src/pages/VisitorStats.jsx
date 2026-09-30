import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Eye, Clock, CalendarDays, TrendingUp } from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useSiteOpenSummary } from '../lib/siteOpenCounter'
import { BACKOFFICE_EXCLUDED_SINCE, bangkokDay, fiscalMonthSeries, fiscalYearSeries } from '../lib/siteOpenStats.js'
import { thaiDateFromDateInput } from '../lib/thaiDate.js'
import FiscalYearPicker from '../components/common/FiscalYearPicker'
import { FY_ALL, useFiscalYearParam, fiscalPeriodParts } from '../lib/fiscalYearParam'
import { FISCAL_MONTHS_TH, fiscalYearBounds } from '../lib/fiscalYear'

// หน้ารายงานสถิติการเข้าชมเว็บไซต์ — ปลายทางของบรรทัดตัวนับท้ายเว็บ (SiteVisitCounter.jsx)
// โครงหน้า/การ์ด/สีกราฟยึด ComplaintStats.jsx ให้หน้ารายงานทุกหน้าดูเป็นชุดเดียวกัน
// ตัวเลขทุกตัวในหน้านี้คือ "การเข้าชม (ครั้ง)" ไม่ใช่จำนวนคน — นิยามอยู่ที่ src/lib/siteOpenStats.js

const DAYS_SHOWN = 30
const DAY_MS = 24 * 60 * 60 * 1000

// ชื่อเดือนย่อตามเลขเดือนปฏิทิน ยืมจาก FISCAL_MONTHS_TH ไม่ประกาศชุดใหม่ซ้ำ
const SHORT_MONTH = Object.fromEntries(FISCAL_MONTHS_TH.map(m => [m.month, m.label]))

const TOOLTIP_STYLE = { borderRadius: 12, border: '1px solid #f3f4f6', fontSize: 12 }
const AXIS_TICK = { fontSize: 11, fill: '#898781' }

const formatCount = value => Number(value ?? 0).toLocaleString('th-TH')

// 'YYYY-MM-DD' → '29 ก.ย.' — แยกตัวเลขเอง ไม่ผ่าน new Date(str) ที่ parse เป็นเที่ยงคืน UTC
// แล้ววันเลื่อนบนเครื่องที่ตั้ง timezone ติดลบ (เหตุผลเดียวกับ thaiDateFromDateInput)
function shortDayLabel(isoDay) {
  const [, month, day] = String(isoDay).split('-').map(Number)
  return `${day} ${SHORT_MONTH[month] ?? ''}`
}

// การ์ดตัวเลขชุดเดียวกับ ComplaintStats.jsx (ตัวนั้นไม่ได้ export ไว้ — คัดมาทั้งก้อน ห้ามแต่งให้ต่าง)
function StatCard({ label, value, sub, Icon, iconBg, border }) {
  return (
    <div className={`bg-white rounded-lg sm:rounded-2xl border p-2 sm:p-4 flex flex-col ${border}`}>
      <div className="flex items-center gap-1 sm:gap-2">
        <div className={`w-5 h-5 sm:w-7.5 sm:h-7.5 rounded-md sm:rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
          <Icon size={11} className="text-white sm:w-[15px] sm:h-[15px]" aria-hidden="true" />
        </div>
        <p className="text-[10px] sm:text-xs font-semibold text-gray-500 leading-3 sm:leading-4 truncate">{label}</p>
      </div>
      <p className="mt-1 sm:mt-2 text-xl sm:text-[28px] font-black text-gray-800 leading-none">{value}</p>
      {sub && <p className="mt-0.5 sm:mt-1 text-[9px] sm:text-xs text-gray-400 leading-3 sm:leading-3.5 line-clamp-2">{sub}</p>}
    </div>
  )
}

// ที่ว่างแทนกราฟระหว่างโหลด — สูงเท่ากราฟจริง หน้าจะได้ไม่กระโดดตอนกราฟขึ้น
function ChartPlaceholder({ failed }) {
  return (
    <div className="h-[180px] flex items-center justify-center text-xs text-gray-400">
      {failed ? 'โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหน้าอีกครั้ง' : 'กำลังโหลด…'}
    </div>
  )
}

export default function VisitorStats() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id
  const summary = useSiteOpenSummary(tenantId)
  const opens = summary?.opens
  const total = opens?.total

  const { value: fiscalYear, setValue: setFiscalYear, options: fiscalOptions } = useFiscalYearParam()
  const currentFiscalYear = fiscalOptions[0]
  // useFiscalYearParam() สร้าง object ใหม่ทุก render — memo ตามค่าปีงบ ไม่งั้น effect ดึงข้อมูลยิงไม่หยุด
  const fiscalRange = useMemo(
    () => (fiscalYear === FY_ALL ? null : fiscalYearBounds(fiscalYear)),
    [fiscalYear],
  )
  const fiscalPeriod = fiscalPeriodParts(fiscalYear)

  const [daily, setDaily] = useState(null)
  const [monthly, setMonthly] = useState(null)
  // โหลดไม่สำเร็จต้องบอกตรงๆ ไม่ปล่อย "กำลังโหลด…" ค้างไปตลอดจนดูเหมือนหน้าค้าง
  const [loadFailed, setLoadFailed] = useState(false)

  // total อยู่ใน deps โดยตั้งใจ: การเปิดหน้านี้เองก็ถูกนับ (หลังหน่วง ~1 วินาที) พอยอดสะสมขยับ
  // ให้ดึงกราฟใหม่ จุด "วันนี้" ในกราฟจะได้ตรงกับการ์ดด้านบน ไม่ต่างกันอยู่ 1
  // ดึงใหม่แล้วค้างของเดิมไว้จนของใหม่มา ไม่ล้าง state ก่อน — กราฟไม่กะพริบว่าง
  useEffect(() => {
    if (!tenantId) return undefined
    let cancelled = false
    const now = Date.now()
    supabase.rpc('get_site_open_daily', {
      _municipality_id: tenantId,
      _from: bangkokDay(new Date(now - (DAYS_SHOWN - 1) * DAY_MS)),
      _to: bangkokDay(new Date(now)),
    }).then(({ data, error }) => {
      if (cancelled) return
      if (error) setLoadFailed(true)
      else setDaily(data ?? [])
    }, () => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [tenantId, total])

  useEffect(() => {
    if (!tenantId) return undefined
    let cancelled = false
    supabase.rpc('get_site_open_monthly', {
      _municipality_id: tenantId,
      _from: fiscalRange?.from ?? null,
      _to: fiscalRange?.to ?? null,
    }).then(({ data, error }) => {
      if (cancelled) return
      if (error) setLoadFailed(true)
      else setMonthly(data ?? [])
    }, () => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [tenantId, fiscalRange, total])

  const dailySeries = useMemo(
    () => (daily ?? []).map(r => ({
      key: r.visit_date,
      label: shortDayLabel(r.visit_date),
      fullLabel: thaiDateFromDateInput(r.visit_date),
      opens: Number(r.opens ?? 0),
    })),
    [daily],
  )

  //   เลือกปีงบ → 12 เดือน ต.ค.→ก.ย. ตามที่ อปท. อ่านรายงานกัน
  //   "ทุกปีงบประมาณ" → แท่งละปีงบ ตั้งแต่ปีแรกที่มีข้อมูลถึงปีงบปัจจุบัน
  const periodSeries = useMemo(() => {
    if (!monthly) return null
    if (!fiscalRange) {
      return fiscalYearSeries(monthly, currentFiscalYear)
        .map(p => ({ ...p, fullLabel: `ปีงบประมาณ พ.ศ. ${p.label}` }))
    }
    return fiscalMonthSeries(monthly, fiscalRange, FISCAL_MONTHS_TH)
      .map(p => ({ ...p, fullLabel: `${p.label} ${Number(p.key.slice(0, 4)) + 543}` }))
  }, [monthly, fiscalRange, currentFiscalYear])

  const periodTotal = periodSeries?.reduce((sum, p) => sum + p.opens, 0) ?? 0
  // "ทุกปีงบ" ช่วงปีแรกมีปีงบเดียว = กราฟแท่งเดียวที่ไม่ได้เทียบอะไร ตัวเลขในตารางบอกได้ครบกว่า
  const showPeriodChart = !periodSeries || fiscalRange || periodSeries.length > 1
  // ป้ายตัวเลขบนแท่งเฉพาะแท่งที่สูงสุด (ไม่ใส่ทุกแท่ง อ่านไม่ออก) ค่าที่เหลืออยู่ในตารางใต้กราฟ
  const peakKey = periodSeries?.reduce(
    (best, p) => (p.opens > 0 && p.opens > (best?.opens ?? 0) ? p : best), null,
  )?.key

  const since = summary?.since ? thaiDateFromDateInput(summary.since) : ''
  // อปท. ที่เริ่มนับก่อนวันเลิกนับหน้าหลังบ้าน ยอดช่วงแรกยังรวมหน้าเหล่านั้น — ต้องบอกวันเปลี่ยนนิยาม
  // ไม่งั้นคนอ่านเทียบยอดก่อน/หลังแล้วเข้าใจว่าคนเข้าชมลดลง · อปท. ที่เริ่มนับทีหลังไม่ต้องเห็นประโยคนี้
  const countedBackofficeBefore = Boolean(summary?.since) && summary.since < BACKOFFICE_EXCLUDED_SINCE
  const now = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#eef2f7' }}>

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-100 shadow-sm px-4 py-4 sm:py-5">
        <div className="max-w-4xl mx-auto">
          <Link to="/reports"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-3">
            <ArrowLeft size={14} /> กลับ
          </Link>
          <div>
            <span className="inline-block text-[10px] sm:text-xs font-bold px-2.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
              สถิติเว็บไซต์
            </span>
          </div>
          <h1 className="text-lg sm:text-xl font-black text-gray-800 leading-tight mt-2">
            สถิติการเข้าชมเว็บไซต์
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 leading-snug">
            <span className="whitespace-nowrap">{tenant?.name ?? 'หน่วยงาน'}</span>
            <span className="text-gray-300"> · </span>
            <span className="text-gray-400 whitespace-nowrap">ข้อมูล ณ วันที่ {now}</span>
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">

        {/* ── ตัวเลขล่าสุด — ไม่ขึ้นกับตัวเลือกปีงบด้านล่าง ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          <StatCard label="วันนี้" value={opens ? formatCount(opens.today) : '—'} sub="ครั้ง"
            Icon={Eye} iconBg="bg-violet-500" border="border-violet-100" />
          <StatCard label="เมื่อวาน" value={opens ? formatCount(opens.yesterday) : '—'} sub="ครั้ง"
            Icon={Clock} iconBg="bg-sky-500" border="border-sky-100" />
          <StatCard label="เดือนนี้" value={opens ? formatCount(opens.this_month) : '—'} sub="ครั้ง"
            Icon={CalendarDays} iconBg="bg-emerald-500" border="border-emerald-100" />
          <StatCard label="ยอดสะสมทั้งหมด" value={opens ? formatCount(opens.total) : '—'}
            sub={since ? `ครั้ง · เริ่มนับ ${since}` : 'ครั้ง'}
            Icon={TrendingUp} iconBg="bg-blue-500" border="border-blue-100" />
        </div>

        {/* ── 30 วันล่าสุด: แนวโน้มตามเวลา → area ชุดเดียว สีเดียว ไม่ต้องมี legend (ชื่อกราฟบอกแล้ว) ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-3 md:p-4">
          <p className="text-sm font-bold text-gray-700">การเข้าชม {DAYS_SHOWN} วันล่าสุด</p>
          <p className="text-[10px] text-gray-400 mb-1.5">จำนวนครั้งต่อวัน (วันตามเวลาประเทศไทย)</p>
          {!daily ? (
            <ChartPlaceholder failed={loadFailed} />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={dailySeries} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="visitorsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.12} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#e5e7eb" />
                {/* ป้ายทุก 7 วัน — 30 ป้ายไม่พอที่บนจอมือถือ และปล่อยให้ recharts หล่นเองจะเว้นไม่สม่ำเสมอ */}
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#c3c2b7' }}
                  interval={6} tick={AXIS_TICK} />
                <YAxis allowDecimals={false} width={40} tickLine={false} axisLine={false}
                  tick={AXIS_TICK} tickFormatter={formatCount} />
                <Tooltip cursor={{ stroke: '#c3c2b7', strokeWidth: 1 }}
                  formatter={(value) => [`${formatCount(value)} ครั้ง`, null]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel}
                  contentStyle={TOOLTIP_STYLE} labelStyle={{ fontWeight: 700 }} />
                <Area type="monotone" dataKey="opens" stroke="var(--color-primary)" strokeWidth={2}
                  fill="url(#visitorsFill)" dot={false}
                  activeDot={{ r: 5, fill: 'var(--color-primary)', stroke: '#fff', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
          {/* ตารางคู่กราฟ — ค่าทุกวันอ่านได้โดยไม่ต้องพึ่ง tooltip (มือถือไม่มี hover) */}
          {dailySeries.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer select-none text-xs font-semibold text-gray-500 hover:text-gray-700">
                ดูเป็นตาราง
              </summary>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left font-semibold py-1">วันที่</th>
                    <th className="text-right font-semibold py-1">การเข้าชม (ครั้ง)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...dailySeries].reverse().map(d => (
                    <tr key={d.key} className="border-b border-gray-50">
                      <td className="py-1 text-gray-600">{d.fullLabel}</td>
                      <td className="py-1 text-right font-semibold text-gray-800 tabular-nums">{formatCount(d.opens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>

        {/* ── รายเดือนตามปีงบ: ตัวเลือกปีงบอยู่เหนือสิ่งที่มันคุม (การ์ดกราฟ + ตาราง) ไม่ยัดไว้ในการ์ด ── */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <p className="text-sm font-bold text-gray-700">
            การเข้าชม{fiscalRange ? 'รายเดือน' : 'รายปีงบประมาณ'}
          </p>
          <FiscalYearPicker value={fiscalYear} options={fiscalOptions} onChange={setFiscalYear} />
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-3 md:p-4">
          <p className="text-xs font-semibold text-gray-600">
            <span className="whitespace-nowrap">{fiscalPeriod.main}</span>
            <span className="hidden sm:inline">{fiscalPeriod.range}</span>
          </p>
          <p className="text-[10px] text-gray-400 mb-1.5">
            {fiscalRange ? 'รายเดือน ต.ค.–ก.ย.' : 'รวมทั้งปีงบประมาณ'} · รวม {formatCount(periodTotal)} ครั้ง
          </p>
          {!periodSeries ? (
            <ChartPlaceholder failed={loadFailed} />
          ) : showPeriodChart && (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={periodSeries} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="#e5e7eb" />
                {/* interval 0 = บังคับครบ 12 เดือน — ปล่อยให้ recharts เลือกเองเคยหล่น เม.ย./ส.ค. ทิ้ง
                    จนอ่านช่วงเวลาผิด (ดู ComplaintStats.jsx) ค่าทุกเดือนยังอยู่ในตารางใต้กราฟ */}
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#c3c2b7' }}
                  interval={0} tick={{ ...AXIS_TICK, fontSize: 10 }} />
                <YAxis allowDecimals={false} width={40} tickLine={false} axisLine={false}
                  tick={AXIS_TICK} tickFormatter={formatCount} />
                <Tooltip cursor={{ fill: '#f9fafb' }}
                  formatter={(value) => [`${formatCount(value)} ครั้ง`, null]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel}
                  contentStyle={TOOLTIP_STYLE} labelStyle={{ fontWeight: 700 }} />
                <Bar dataKey="opens" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={24}
                  label={({ x, y, width, value, index }) => (
                    periodSeries[index]?.key === peakKey ? (
                      <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#374151">
                        {formatCount(value)}
                      </text>
                    ) : null
                  )} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {periodSeries && (
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="text-left font-semibold py-1">{fiscalRange ? 'เดือน' : 'ปีงบประมาณ'}</th>
                  <th className="text-right font-semibold py-1">การเข้าชม (ครั้ง)</th>
                </tr>
              </thead>
              <tbody>
                {periodSeries.map(p => (
                  <tr key={p.key} className="border-b border-gray-50">
                    <td className="py-1 text-gray-600">{p.fullLabel}</td>
                    <td className="py-1 text-right font-semibold text-gray-800 tabular-nums">{formatCount(p.opens)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-1.5 font-bold text-gray-700">รวม</td>
                  <td className="pt-1.5 text-right font-black text-gray-800 tabular-nums">{formatCount(periodTotal)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* ── วิธีนับ — ต้องบอกให้ชัดว่าเป็น "ครั้ง" ไม่ใช่ "คน" ใครยกตัวเลขไปอ้างต่อจะได้ไม่เข้าใจผิด ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-3 md:p-4 text-xs text-gray-500 leading-relaxed">
          <p className="font-bold text-gray-700 mb-1">วิธีนับ</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>นับ 1 ครั้งทุกครั้งที่หน้าเว็บแสดงผล ทั้งการเปิดเว็บ การรีเฟรช และการเปลี่ยนหน้า ผู้ใช้คนเดียวจึงนับได้หลายครั้ง</li>
            <li>ไม่นับโปรแกรมอัตโนมัติ เช่น บอตของเครื่องมือค้นหา และการทดสอบระบบ</li>
            <li>
              ไม่นับหน้าที่เจ้าหน้าที่ใช้ปฏิบัติงาน (ระบบหลังบ้าน)
              {countedBackofficeBefore
                ? ` ตั้งแต่ ${thaiDateFromDateInput(BACKOFFICE_EXCLUDED_SINCE)} · ยอดก่อนหน้านั้นนับรวมหน้าเหล่านี้ด้วย`
                : ''}
            </li>
            <li>ไม่เก็บข้อมูลส่วนบุคคล เก็บเฉพาะยอดรวมรายวันของหน่วยงาน</li>
            <li>วันตามเวลาประเทศไทย · ปีงบประมาณเริ่ม 1 ต.ค. สิ้นสุด 30 ก.ย.{since ? ` · เริ่มนับเมื่อ ${since}` : ''}</li>
          </ul>
        </div>

        <p className="text-center text-xs text-gray-300 pb-6 mb-20 md:mb-0">
          SmartLocal e-Service Platform • รายงานนี้สร้างโดยอัตโนมัติ •{' '}
          {tenant?.name} • {now}
        </p>

      </div>
    </div>
  )
}
