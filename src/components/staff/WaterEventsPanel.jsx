import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Info, Loader2, Printer, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { loadPersonCard, loadSignatoryRegistry } from '../../lib/staffPerformanceData'
import { buildWaterEventHtml, pickAcknowledger } from '../../lib/waterEventPrint'
import {
  WATER_EVENTS_DISCLAIMER, WATER_EVENT_CRITERIA, WATER_EVENT_CRITERIA_NOTES,
  chartGapMs, closeReasonText, eventCard, eventSpan, openReasonLines, recorderStatus,
  sparkline, stationSummaries, thaiDateTime, warningRows,
} from '../../lib/waterEvents'
import WaterAnnouncementsSection from './WaterAnnouncementsSection'

// ส่วน "เหตุการณ์" ของหน้านี้ (ทุกอย่างใต้ data-we-list/data-we-detail) — อ่านอย่างเดียว ไม่มีอะไรให้กรอก/กดยืนยัน/ลบ
// ส่วน "ประกาศน้ำ-ฝนของหน่วยงาน" (เฟส 2 · PR 2.2) อยู่เหนือรายการเหตุการณ์ แยกเป็นไฟล์ของตัวเอง ([data-wa-section]) — ปุ่มยืนยัน/ไม่ประกาศมีเฉพาะผู้มีสิทธิ์ยืนยัน
// ข้อกำหนดข้างล่างนี้ใช้กับไฟล์นี้และส่วนเหตุการณ์เท่านั้น
// หน้า "เหตุการณ์น้ำ-ฝน" ของเจ้าหน้าที่ — อ่านอย่างเดียว ไม่มีอะไรให้กรอก/กดยืนยัน/ลบ
// (เจ้าของระบบสั่ง "ต้องไม่เพิ่มงานให้เจ้าหน้าที่": ระบบจดและปิดเหตุการณ์เอง หน้านี้มีไว้เปิดดูตอนมีคนถาม)
// ปุ่มที่มีได้ มีแค่ 4 ชนิดและติดป้าย data-we-nav ไว้ให้เทสต์ตรวจ: open (เปิดรายละเอียด) · back (กลับ) · retry (โหลดใหม่ตอนผิดพลาด)
// · print (พิมพ์สรุป A4 — มีเฉพาะหน้ารายละเอียด กดแล้วเปิดหน้าต่างพิมพ์ทันที ไม่มีอะไรให้กรอก: ผู้จัดทำมาจากบัญชีที่ล็อกอิน ผู้รับทราบมาจากทะเบียนผู้ลงนาม)
// ข้อมูลมาจาก list_water_events / get_water_event (ตารางเหตุการณ์ปิดสิทธิ์ตรง) · เวลา "ตอนนี้" ใช้ของฐานข้อมูล ไม่ใช้นาฬิกาเครื่อง
// ⚠️ ห้ามเพิ่ม input/textarea/select/form หรือปุ่มอื่นในไฟล์นี้ — tests/water-events-ui.playwright.mjs จะแดง

// เปิดหน้าต่างก่อนรอข้อมูลใดๆ (ข้อมูลโหลดมาแล้วตอนนี้) ไม่งั้นเบราว์เซอร์มือถือบล็อก pop-up แล้วรอฟอนต์ราชการก่อนสั่งพิมพ์
// แบบเดียวกับ StaffPerformanceModule / FleetReport
function openPrintWindow(html) {
  const win = window.open('', '_blank', 'width=900,height=1000')
  if (!win) {
    alert('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
  setTimeout(async () => {
    try {
      if (win.document.fonts?.ready) {
        await Promise.race([win.document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1200))])
      }
    } catch { /* โหลดฟอนต์ไม่ทันก็พิมพ์ด้วยฟอนต์บนเครื่อง */ }
    win.focus()
    win.print()
  }, 200)
}

function describeError(error) {
  const code = error?.code
  const message = String(error?.message || '')
  if (code === '42501') return 'บัญชีนี้ไม่มีสิทธิ์ดูเหตุการณ์น้ำ-ฝนของหน่วยงาน'
  // ฟังก์ชันยังไม่ถูกติดตั้งในฐานข้อมูล (PostgREST ตอบ PGRST202, Postgres ตอบ 42883)
  if (code === 'PGRST202' || code === '42883' || /could not find the function/i.test(message)) {
    return 'ระบบฐานข้อมูลยังไม่พร้อมสำหรับหน้านี้ (ยังไม่ได้ติดตั้งฟังก์ชันอ่านเหตุการณ์)'
  }
  return 'โหลดข้อมูลเหตุการณ์ไม่สำเร็จ'
}

function nowOf(data) {
  const ms = Date.parse(data?.now)
  return Number.isNaN(ms) ? Date.now() : ms
}

function RecorderLine({ status }) {
  const tone = {
    ok: { Icon: CheckCircle2, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    late: { Icon: AlertTriangle, cls: 'text-amber-800 bg-amber-50 border-amber-300' },
    unknown: { Icon: Info, cls: 'text-gray-700 bg-gray-50 border-gray-200' },
  }[status.kind]
  const { Icon } = tone
  return (
    <p data-we-recorder={status.kind} className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${tone.cls}`}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{status.text}</span>
    </p>
  )
}

function Disclaimer() {
  return <p data-we-disclaimer className="text-xs leading-relaxed text-gray-500">{WATER_EVENTS_DISCLAIMER}</p>
}

function StatusChip({ open }) {
  return open
    ? <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
        <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />กำลังเกิดเหตุการณ์
      </span>
    : <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">จบแล้ว</span>
}

function EmptyState({ status }) {
  return (
    <section data-we-empty className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <h2 className="text-base font-bold text-gray-900">ยังไม่มีเหตุการณ์ที่ระบบจดไว้</h2>
      {status.kind === 'ok' && (
        <p className="text-sm leading-relaxed text-gray-700">ไม่มีสถานีใดเข้าเกณฑ์ตอนนี้ — ไม่มีอะไรที่เจ้าหน้าที่ต้องทำ ระบบจะจดและปิดเหตุการณ์ให้เองเมื่อเกิดขึ้น</p>
      )}
      <div>
        <p className="text-sm font-semibold text-gray-800">ระบบเปิดเหตุการณ์เมื่อสถานีใดสถานีหนึ่งในพื้นที่เข้าเกณฑ์ข้อใดข้อหนึ่ง</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed text-gray-700">
          {WATER_EVENT_CRITERIA.map(text => <li key={text}>{text}</li>)}
        </ul>
        <ul className="mt-2 space-y-1 text-xs leading-relaxed text-gray-500">
          {WATER_EVENT_CRITERIA_NOTES.map(text => <li key={text}>{text}</li>)}
        </ul>
      </div>
    </section>
  )
}

function EventCard({ card, onOpen }) {
  return (
    <li>
      <button type="button" data-we-nav="open" data-we-card data-we-open={card.open ? 'true' : 'false'}
        onClick={() => onOpen(card.id)}
        className="flex min-h-11 w-full items-start gap-3 rounded-2xl border border-gray-100 bg-white p-4 text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 active:scale-[0.99]">
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip open={card.open} />
            {card.duration && <span className="text-xs text-gray-500">นาน {card.duration}</span>}
          </span>
          <span className="block text-sm font-semibold text-gray-900">
            {card.startText}{card.open ? ' เป็นต้นมา' : ` – ${card.endText}`}
          </span>
          {card.reasonLines.length > 0 && (
            <span className="block text-sm text-gray-700">
              <span className="text-xs text-gray-500">เปิดเพราะ: </span>
              {card.reasonLines.join(' · ')}{card.reasonMore > 0 ? ` และอีก ${card.reasonMore} สัญญาณ` : ''}
            </span>
          )}
          {card.peaks.length > 0 && <span className="block text-sm text-gray-700">{card.peaks.join(' · ')}</span>}
          {card.closeText && <span className="block text-xs text-gray-500">{card.closeText}</span>}
          <span className="block text-xs text-gray-400">
            {card.stationsCount} สถานี · {card.readingsCount.toLocaleString('th-TH')} ค่าที่จด · ข้อความ สสน. {card.warningsCount} ฉบับ
          </span>
        </span>
        <ChevronRight size={18} className="mt-1 shrink-0 text-gray-300" aria-hidden="true" />
      </button>
    </li>
  )
}

function Spark({ summary }) {
  if (!summary.chart) return null
  const points = summary.chart
  const spark = sparkline(points, { gapMs: chartGapMs(summary.type), baseline: summary.baseline ?? null })
  if (!spark) return null
  return (
    <figure className="mt-2">
      <svg data-we-chart viewBox="0 0 240 64" className="h-16 w-full" role="img"
        aria-label={`${summary.chartLabel} ตั้งแต่ ${thaiDateTime(spark.t0)} ถึง ${thaiDateTime(spark.t1)}`}>
        <rect x="0" y="0" width="240" height="64" rx="6" fill="#f8fafc" />
        {spark.paths.map(d => <path key={d} d={d} fill="none" stroke="#2563eb" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />)}
        {spark.dots.map(p => <circle key={`${p.x}-${p.y}`} cx={p.x} cy={p.y} r="2.2" fill="#2563eb" />)}
      </svg>
      <figcaption className="mt-1 text-[11px] leading-snug text-gray-500">
        {summary.chartLabel} · {thaiDateTime(spark.t0)} – {thaiDateTime(spark.t1)}
        {spark.segments > 1 ? ' · เส้นขาดช่วงที่สถานีไม่ส่งค่า' : ''}
      </figcaption>
    </figure>
  )
}

function StationCard({ summary }) {
  const gaps = summary.gaps
  return (
    <article data-we-station={summary.key} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-500">{summary.typeLabel}</p>
      <h3 className="text-sm font-bold text-gray-900">{summary.name}</h3>
      <p className="mt-1 text-sm font-semibold text-gray-800">{summary.headline}</p>
      {summary.lines.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs leading-relaxed text-gray-600">
          {summary.lines.map(line => <li key={line}>{line}</li>)}
        </ul>
      )}
      {summary.notes.map(note => (
        <p key={note} className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs leading-relaxed text-amber-800">{note}</p>
      ))}
      <Spark summary={summary} />
      {gaps.length > 0 && (
        <div data-we-gaps className="mt-2 text-xs leading-relaxed text-gray-500">
          <p className="font-semibold text-gray-600">สถานีไม่ส่งค่า {gaps.length} ช่วง (ไม่เติมค่าให้ ไม่ใช่ 0)</p>
          <ul className="space-y-0.5">
            {gaps.slice(0, 3).map(text => <li key={text}>{text}</li>)}
          </ul>
          {gaps.length > 3 && <p>และอีก {gaps.length - 3} ช่วง</p>}
        </div>
      )}
      <p className="mt-2 text-[11px] text-gray-400">ค่าที่จดไว้ {summary.readingsCount.toLocaleString('th-TH')} ค่า</p>
    </article>
  )
}

function EventDetail({ detail, onBack, onPrint }) {
  const now = nowOf(detail)
  const event = detail.event
  const span = eventSpan(event, now)
  const reason = openReasonLines(event.open_reason, 10)
  const stations = stationSummaries(detail.stations, { now, open: span.open })
  const warnings = warningRows(detail.warnings)
  return (
    <div data-we-detail className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-we-nav="back" onClick={onBack}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
          <ArrowLeft size={16} aria-hidden="true" />กลับไปรายการ
        </button>
        <button type="button" data-we-nav="print" onClick={onPrint}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-800 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
          <Printer size={16} aria-hidden="true" />พิมพ์สรุป A4
        </button>
      </div>

      <section className="max-w-4xl space-y-2 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip open={span.open} />
          {span.duration && <span className="text-xs text-gray-500">นาน {span.duration}</span>}
        </div>
        <p className="text-base font-bold text-gray-900">
          {span.startText}{span.open ? ' เป็นต้นมา' : ` – ${span.endText}`}
        </p>
        {span.open && event.last_fresh_at && (
          <p className="text-xs text-gray-500">ค่าสดล่าสุดที่ระบบเห็น {thaiDateTime(event.last_fresh_at)}</p>
        )}
        {!span.open && (
          <p className="text-xs text-gray-500">{closeReasonText(event.close_reason)}{event.closed_at ? ` · ปิดเมื่อ ${thaiDateTime(event.closed_at)}` : ''}</p>
        )}
        {reason.lines.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-600">ระบบเปิดเหตุการณ์เพราะ</p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-800">
              {reason.lines.map(line => <li key={line}>{line}</li>)}
            </ul>
            {reason.more > 0 && <p className="text-xs text-gray-500">และอีก {reason.more} สัญญาณ</p>}
          </div>
        )}
        <Disclaimer />
      </section>

      <section aria-label="ค่าที่วัดได้รายสถานี" className="space-y-2">
        <h2 className="text-sm font-bold text-gray-800">ค่าที่วัดได้รายสถานี ({stations.length} สถานี)</h2>
        {stations.length === 0
          ? <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-600">เหตุการณ์นี้ยังไม่มีค่าที่จดไว้ (ไม่มีสถานีส่งค่าในช่วงที่ระบบจด)</p>
          : <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {stations.map(summary => <StationCard key={summary.key} summary={summary} />)}
            </div>}
      </section>

      <section aria-label="ข้อความเตือนของ สสน." className="space-y-2">
        <h2 className="text-sm font-bold text-gray-800">ข้อความเตือนของ สสน. ที่ระบุอำเภอและจังหวัดนี้ ({warnings.length} ฉบับ)</h2>
        {warnings.length === 0
          ? <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-600">ไม่มีข้อความเตือนของ สสน. ในช่วงเหตุการณ์นี้</p>
          : <ul className="space-y-2">
              {warnings.map(w => (
                <li key={`${w.issuedText}-${w.message}`} data-we-warning className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
                  <p className="text-xs text-gray-500">{w.issuedText}{w.source ? ` · ${w.source}` : ''}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{w.message}</p>
                </li>
              ))}
            </ul>}
        <p className="text-xs text-gray-400">ข้อความคัดลอกตามต้นฉบับจากผู้เผยแพร่ ไม่ได้ตัดแต่งหรือแปลความโดยระบบนี้</p>
      </section>
    </div>
  )
}

export default function WaterEventsPanel({ tenant, profile = null }) {
  const tenantId = tenant?.id
  const [list, setList] = useState({ status: 'loading', data: null, error: null })
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState({ status: 'idle', data: null, error: null })
  const [reloadKey, setReloadKey] = useState(0)
  // ผู้จัดทำ/ผู้รับทราบบนใบพิมพ์ — โหลดเงียบๆ ตอนเปิดรายละเอียด · โหลดไม่ได้/ยังไม่มา = ใบพิมพ์เส้นประให้เขียนมือ ไม่บล็อกการพิมพ์
  const [signers, setSigners] = useState({ preparer: null, acknowledger: null })

  useEffect(() => {
    if (!tenantId) return undefined
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) setList({ status: 'loading', data: null, error: null }) })
    supabase.rpc('list_water_events', { _municipality_id: tenantId }).then(({ data, error }) => {
      if (cancelled) return
      setList(error || !data ? { status: 'error', data: null, error: error ?? new Error('empty') } : { status: 'ok', data, error: null })
    })
    return () => { cancelled = true }
  }, [tenantId, reloadKey])

  useEffect(() => {
    if (!tenantId || !selectedId) return undefined
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) setDetail({ status: 'loading', data: null, error: null }) })
    supabase.rpc('get_water_event', { _municipality_id: tenantId, _event_id: selectedId }).then(({ data, error }) => {
      if (cancelled) return
      if (error) setDetail({ status: 'error', data: null, error })
      else if (!data) setDetail({ status: 'missing', data: null, error: null })
      else setDetail({ status: 'ok', data, error: null })
    })
    return () => { cancelled = true }
  }, [tenantId, selectedId, reloadKey])

  const profileId = profile?.id ?? null
  useEffect(() => {
    if (!tenantId || !selectedId) return undefined
    let cancelled = false
    Promise.all([
      profileId ? loadPersonCard(profileId) : Promise.resolve(null),
      loadSignatoryRegistry(tenantId),
    ]).then(([card, rows]) => {
      if (cancelled) return
      setSigners({
        preparer: card?.name ? { name: card.name, title: card.title } : null,
        acknowledger: pickAcknowledger(rows),
      })
    }).catch(() => { /* ไม่ได้ชื่อ = เส้นประ */ })
    return () => { cancelled = true }
  }, [tenantId, selectedId, profileId])

  const print = useCallback(() => {
    if (!detail.data) return
    openPrintWindow(buildWaterEventHtml({ tenant, detail: detail.data, ...signers }))
  }, [tenant, detail.data, signers])

  const retry = useCallback(() => setReloadKey(k => k + 1), [])
  const back = useCallback(() => { setSelectedId(null); setDetail({ status: 'idle', data: null, error: null }) }, [])

  const spinner = (
    <div className="flex justify-center py-16" role="status" aria-label="กำลังโหลด">
      <Loader2 size={28} className="animate-spin text-blue-500" />
    </div>
  )
  const failure = (error) => (
    <div data-we-error role="alert" className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <p>{describeError(error)}</p>
      <button type="button" data-we-nav="retry" onClick={retry}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-rose-300 bg-white px-3 font-semibold text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
        <RefreshCw size={15} aria-hidden="true" />โหลดใหม่
      </button>
    </div>
  )

  // ── หน้ารายละเอียด ──
  if (selectedId) {
    if (detail.status === 'loading' || detail.status === 'idle') return spinner
    if (detail.status === 'error') {
      return (
        <div className="space-y-3">
          <button type="button" data-we-nav="back" onClick={back}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700">
            <ArrowLeft size={16} aria-hidden="true" />กลับไปรายการ
          </button>
          {failure(detail.error)}
        </div>
      )
    }
    if (detail.status === 'missing') {
      return (
        <div className="space-y-3">
          <button type="button" data-we-nav="back" onClick={back}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700">
            <ArrowLeft size={16} aria-hidden="true" />กลับไปรายการ
          </button>
          <p data-we-missing className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-700">ไม่พบเหตุการณ์นี้ (อาจถูกลบออกจากระบบแล้ว)</p>
        </div>
      )
    }
    return <EventDetail detail={detail.data} onBack={back} onPrint={print} />
  }

  // ── หน้ารายการ ──
  if (list.status === 'loading') return spinner
  if (list.status === 'error') return failure(list.error)

  const data = list.data
  const now = nowOf(data)
  const status = recorderStatus(data.recorder, now)
  const events = Array.isArray(data.events) ? data.events : []
  const total = Number(data.total) || events.length
  return (
    <div className="max-w-4xl space-y-4">
      {/* ประกาศน้ำ-ฝนของหน่วยงาน: อปท. ที่ไม่ได้เปิดใช้ไม่เห็นอะไรเลย (ส่วนนี้คืน null) */}
      <WaterAnnouncementsSection tenantId={tenantId} />
      <div data-we-list className="space-y-4">
        <RecorderLine status={status} />
        {events.length === 0
          ? <EmptyState status={status} />
          : (
            <>
              <p className="text-sm text-gray-600">เหตุการณ์ที่ระบบจดไว้ จดให้เองทั้งหมด ไม่มีอะไรที่ต้องกรอกหรือยืนยัน — กดการ์ดเพื่อดูค่าที่วัดได้ย้อนหลัง</p>
              <ul className="space-y-3">
                {events.map(event => <EventCard key={event.id} card={eventCard(event, now)} onOpen={setSelectedId} />)}
              </ul>
              {total > events.length && <p className="text-xs text-gray-500">แสดง {events.length} จาก {total.toLocaleString('th-TH')} เหตุการณ์ (ใหม่สุดก่อน)</p>}
            </>
          )}
        <Disclaimer />
      </div>
    </div>
  )
}
