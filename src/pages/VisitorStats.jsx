import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Eye, Clock, CalendarDays, TrendingUp } from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useSiteOpenSummary } from '../lib/siteOpenCounter'
import {
  BACKOFFICE_EXCLUDED_SINCE, bangkokDay, fiscalMonthSeries, fiscalYearSeries, pageRanking,
} from '../lib/siteOpenStats.js'
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

// ช่วงเวลาของอันดับหน้า — ไม่ผูกกับตัวเลือกปีงบของกราฟรายเดือนด้านล่าง (คนละส่วน ถ้าผูกกันจะงงว่าตัวไหนคุมตัวไหน)
const RANK_PERIODS = [
  { key: '30d', label: '30 วันล่าสุด' },
  { key: 'fy', label: 'ปีงบนี้' },
  { key: 'all', label: 'ทั้งหมด' },
]
const KIND_LABEL = { service: 'บริการ', info: 'ข้อมูล', mine: 'ของฉัน', transit: 'ทางผ่าน' }

function KindTag({ kind }) {
  return (
    <span className="ml-1.5 inline-block whitespace-nowrap rounded bg-gray-100 px-1.5 py-px align-middle text-[10px] font-semibold text-gray-500">
      {KIND_LABEL[kind] ?? kind}
    </span>
  )
}

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
  const [rankPeriod, setRankPeriod] = useState('30d')
  const [ranking, setRanking] = useState(null)
  // โหลดไม่สำเร็จต้องบอกตรงๆ ไม่ปล่อย "กำลังโหลด…" ค้างไปตลอดจนดูเหมือนหน้าค้าง
  const [loadFailed, setLoadFailed] = useState(false)
  const [rankFailed, setRankFailed] = useState(false)

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

  // อันดับหน้า: total อยู่ใน deps ด้วยเหตุผลเดียวกับกราฟด้านบน (การเปิดหน้านี้เองก็ถูกนับ)
  // ตัวช่วงเวลา 30 วัน/ปีงบ คำนวณตอนยิง ไม่ใช่ตอน render — ไม่งั้น effect ยิงใหม่ทุก render เพราะวันที่เป็นค่าใหม่เสมอ
  useEffect(() => {
    if (!tenantId) return undefined
    let cancelled = false
    const now = Date.now()
    let range = { from: null, to: null }
    if (rankPeriod === '30d') {
      range = { from: bangkokDay(new Date(now - (DAYS_SHOWN - 1) * DAY_MS)), to: bangkokDay(new Date(now)) }
    } else if (rankPeriod === 'fy') {
      const bounds = fiscalYearBounds(currentFiscalYear)
      range = { from: bounds.from, to: bounds.to }
    }
    supabase.rpc('get_site_page_ranking', {
      _municipality_id: tenantId,
      _from: range.from,
      _to: range.to,
    }).then(({ data, error }) => {
      if (cancelled) return
      if (error) setRankFailed(true)
      else { setRanking(data ?? { since: null, rows: [] }); setRankFailed(false) }
    }, () => { if (!cancelled) setRankFailed(true) })
    return () => { cancelled = true }
  }, [tenantId, rankPeriod, currentFiscalYear, total])

  const rank = useMemo(() => (ranking ? pageRanking(ranking.rows) : null), [ranking])
  const rankSince = ranking?.since ? thaiDateFromDateInput(ranking.since) : ''
  const rankMax = rank?.menus[0]?.opens ?? 0

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

        {/* ── อันดับเมนู: เมนูไหนถูกเปิดมากที่สุด (ไว้ดูว่าประชาชนสนใจเรื่องไหน) ──
            รายการเดียวกับเมนูในแถบข้างของหน้าประชาชน แสดงเฉพาะเมนูที่มีคนเปิดในช่วงนั้น (เจ้าของระบบสั่ง 2569-10-28 ซ่อนเมนูที่ 0 ครั้ง)
            แท่งเดียวสี เรียงมากไปน้อย ใส่ตัวเลขทุกแถว (ไม่กี่สิบแถว อ่านได้ ไม่ได้แน่นแบบกราฟเวลา) ตารางคู่กราฟอยู่ใน details
            เมนูนำทาง (หน้าแรก/เมนูทั้งหมด/รายงานทั้งหมด) แยกเป็นตัวเลขด้านล่าง ไม่ใส่แท่ง: หน้าแรกชนะทุกครั้งโดยธรรมชาติ
            ถ้าปนในแท่งเดียวกัน แท่งของเมนูบริการจะสั้นจนเทียบกันไม่ออก */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <p className="text-sm font-bold text-gray-700">เมนูไหนถูกใช้มากที่สุด</p>
          <div role="group" aria-label="ช่วงเวลาของอันดับหน้า"
            className="inline-flex rounded-xl border border-gray-200 bg-white p-0.5 text-xs">
            {RANK_PERIODS.map(p => (
              <button key={p.key} type="button" aria-pressed={rankPeriod === p.key}
                onClick={() => setRankPeriod(p.key)}
                className={`rounded-[10px] px-2.5 py-1 font-semibold transition-colors ${
                  rankPeriod === p.key ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-700'}`}>
                {p.key === 'fy' ? `${p.label} ${currentFiscalYear}` : p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-3 md:p-4">
          <p className="text-[10px] text-gray-400 mb-2">
            จำนวนครั้งที่เปิดแต่ละเมนู ตามรายการเมนูด้านข้างของเว็บ เฉพาะเมนูที่มีคนเปิดในช่วงนี้ · นับทุกทางที่เข้า ทั้งเมนูข้าง ปุ่มบนหน้าแรก แถบล่างบนมือถือ และลิงก์
          </p>
          {!rank ? (
            <ChartPlaceholder failed={rankFailed} />
          ) : rank.total === 0 ? (
            <p className="py-8 text-center text-xs text-gray-400">
              ยังไม่มีข้อมูลรายเมนูในช่วงนี้ — ระบบเริ่มสะสมตั้งแต่วันที่เพิ่มส่วนนี้ ข้อมูลจะค่อยๆ เพิ่มขึ้นทุกวัน
            </p>
          ) : rank.menus.length === 0 ? (
            <p className="py-6 text-center text-xs text-gray-400">
              ช่วงนี้ยังไม่มีใครเปิดเมนูบริการหรือเมนูข้อมูล มีแต่เมนูนำทางด้านล่าง
            </p>
          ) : (
            <ol className="space-y-2.5">
              {rank.menus.map((p, i) => (
                <li key={p.key}>
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 leading-snug text-gray-700">
                      <span className="mr-1.5 tabular-nums text-gray-400">{i + 1}</span>
                      {p.label}
                      <KindTag kind={p.kind} />
                    </span>
                    <span className="shrink-0 font-bold text-gray-800 tabular-nums">{formatCount(p.opens)}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-gray-100" aria-hidden="true">
                    {/* 0 ครั้ง = รางว่าง ไม่ใส่แท่งสั้นๆ ให้ดูเหมือนมีคนเปิด */}
                    {p.opens > 0 && (
                      <div className="h-2 rounded-full"
                        style={{ width: `${Math.max(2, Math.round((p.opens / rankMax) * 100))}%`, backgroundColor: 'var(--color-primary)' }} />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {rank && rank.total > 0 && rank.hiddenMenus > 0 && (
            <p className="mt-2 text-[10px] text-gray-400">
              ไม่แสดงเมนูที่ยังไม่มีใครเปิดในช่วงนี้ ({formatCount(rank.hiddenMenus)} เมนู)
            </p>
          )}

          {rank && rank.total > 0 && (
            <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <p className="font-semibold text-gray-600">เมนูนำทาง (ทุกคนต้องผ่าน จึงไม่นำมาจัดอันดับ)</p>
              <p className="mt-0.5 leading-relaxed">
                {rank.nav.map((p, i) => (
                  <span key={p.key}>
                    {i > 0 && <span className="text-gray-300"> · </span>}
                    <span className="whitespace-nowrap">{p.label} <b className="tabular-nums text-gray-700">{formatCount(p.opens)}</b> ครั้ง</span>
                  </span>
                ))}
              </p>
            </div>
          )}

          {rank && rank.rows.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer select-none text-xs font-semibold text-gray-500 hover:text-gray-700">
                ดูทุกเมนูและหน้าอื่นเป็นตาราง
              </summary>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left font-semibold py-1">เมนู / หน้า</th>
                    <th className="text-right font-semibold py-1 pl-3">ครั้ง</th>
                    <th className="text-right font-semibold py-1 pl-3">เครื่อง*</th>
                    <th className="text-right font-semibold py-1 pl-3">สัดส่วน</th>
                  </tr>
                </thead>
                <tbody>
                  {rank.rows.map(p => (
                    <tr key={p.key} className="border-b border-gray-50">
                      <td className="py-1 pr-2 text-gray-600">{p.label}<KindTag kind={p.kind} /></td>
                      <td className="py-1 pl-3 text-right font-semibold text-gray-800 tabular-nums">{formatCount(p.opens)}</td>
                      <td className="py-1 pl-3 text-right text-gray-600 tabular-nums">{formatCount(p.visitors)}</td>
                      <td className="py-1 pl-3 text-right text-gray-600 tabular-nums">{(p.share * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="pt-1.5 font-bold text-gray-700">รวม</td>
                    <td className="pt-1.5 text-right font-black text-gray-800 tabular-nums">{formatCount(rank.total)}</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
              <p className="mt-1.5 text-[10px] leading-snug text-gray-400">
                * เครื่อง = จำนวนครั้งแรกของวันที่เครื่องหนึ่งเปิดหน้านั้น เครื่องเดียวที่กลับมาหลายวันนับทุกวัน
              </p>
            </details>
          )}

          <p className="mt-3 text-[10px] leading-snug text-gray-400">
            {rankSince ? `เริ่มนับรายหน้าเมื่อ ${rankSince} · ` : ''}
            ตัวเลขนี้คือครั้งที่หน้าถูกเปิด ไม่ใช่จำนวนเรื่องที่ยื่นจริง — ดูจำนวนที่ยื่นจริงได้ที่{' '}
            <Link to="/reports/complaints" className="underline hover:text-gray-600">รายงานร้องเรียน/ร้องทุกข์</Link>
            {' '}และ{' '}
            <Link to="/doc-stats" className="underline hover:text-gray-600">รายงานการออกเอกสารดิจิทัล</Link>
          </p>
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
            <li>
              อันดับหน้านับเป็นกลุ่มของหน้า (เช่น ทุกเรื่องที่เปิดจากลิงก์ติดตามนับเป็น "ติดตามเรื่องด้วยลิงก์") ไม่เก็บที่อยู่หน้าเว็บจริง
              {rankSince ? ` · เริ่มนับรายหน้าเมื่อ ${rankSince} ยอดก่อนหน้านั้นไม่ถูกแยกตามหน้า` : ''}
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
