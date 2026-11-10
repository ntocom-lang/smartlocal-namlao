import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Smile } from 'lucide-react'
import { PARK_REASONS } from '../../../lib/complaintWorkflow'
import {
  EXEC_COMPLAINT_STAGES, compareMetric, compareValues, execFormulas, execNf,
} from '../../../lib/executiveData'
import { DeltaLine, FormulaPanel, InfoButton, LoadingLine, SectionError, SplitBar, SubHead, SummaryGate } from './ExecParts'
import { EXEC_CHART } from './execChart'

// บล็อกย่อยของโซน ② ที่มาจาก executive_overview (เฟส E2) — ตัวเลขทั้งหมดคิดแล้วใน src/lib/executiveData.js (ฟังก์ชันบริสุทธิ์ มีเทสต์)
// ที่นี่แค่วาด · สูตร ⓘ ดึงจากทะเบียน executiveRegistry.js ตรงๆ ผ่าน execFormulas() ไม่เขียนถ้อยคำเอง
// ห้ามแสดงชื่อผู้ร้อง/ผู้ยื่น/ผู้ป่วย/ผู้ประเมิน/ความเห็น (PDPA) — RPC ไม่คืนมาอยู่แล้ว · เรื่องอ่อนไหว = จำนวนเท่านั้น
// ชื่อคลาส Tailwind เขียนเต็มทุกตัว (ห้ามต่อสตริง)

const TONES = {
  rose: { card: 'border-rose-500', label: 'text-rose-800', value: 'text-rose-600', bar: 'bg-rose-400' },
  amber: { card: 'border-amber-500', label: 'text-amber-800', value: 'text-amber-600', bar: 'bg-amber-400' },
  orange: { card: 'border-orange-500', label: 'text-orange-800', value: 'text-orange-600', bar: 'bg-orange-400' },
  emerald: { card: 'border-emerald-500', label: 'text-emerald-800', value: 'text-emerald-600', bar: 'bg-emerald-400' },
  sky: { card: 'border-sky-500', label: 'text-sky-800', value: 'text-sky-700', bar: 'bg-sky-400' },
  violet: { card: 'border-violet-500', label: 'text-violet-800', value: 'text-violet-700', bar: 'bg-violet-400' },
  slate: { card: 'border-slate-400', label: 'text-slate-700', value: 'text-slate-600', bar: 'bg-slate-400' },
}

/** state ของ ⓘ ในบล็อก: กดซ้ำ = ปิด · กดอีกปุ่ม = สลับ */
function useFormulaToggle() {
  const [open, setOpen] = useState(null)
  return [open, (id) => setOpen((cur) => (cur === id ? null : id))]
}

function StatCard({ id, tone, label, value, unit = '', sub, children, open, onToggle, size = 'md', testId }) {
  const t = TONES[tone] ?? TONES.slate
  const has = value != null && value !== 0
  return (
    <div data-exec-stat={testId ?? id} className={`min-w-0 rounded-2xl border-l-4 bg-white p-2.5 shadow-sm sm:p-3 ${t.card}`}>
      <div className="flex items-start justify-between gap-1">
        <p className={`min-w-0 text-[11px] font-bold sm:text-xs ${t.label}`}>{label}</p>
        <InfoButton active={open === id} onClick={() => onToggle(id)} label={label} />
      </div>
      <p className={`font-black tabular-nums leading-none ${size === 'lg' ? 'text-5xl' : 'text-3xl sm:text-4xl'} ${has ? t.value : 'text-slate-300'}`}>
        {value == null ? '—' : execNf(value)}{value != null && unit && <span className="ml-0.5 text-base font-bold text-slate-400">{unit}</span>}
      </p>
      {children}
      {sub && <p className="mt-1 text-[10px] leading-snug text-slate-500">{sub}</p>}
    </div>
  )
}

// ───────────────────────── ②-1 ชีพจร (ส่วนของ E2) ─────────────────────────

/** ใหญ่สุดของโซน: เลยกำหนด (คำร้อง + คำขอ) — ค้างอยู่ตอนนี้ ไม่ขึ้นกับช่วงที่เลือก */
export function OverdueCard({ ov, entries }) {
  const [open, toggle] = useFormulaToggle()
  if (ov.status === 'loading') return <LoadingLine text="กำลังโหลดเรื่องเลยกำหนด…" />
  if (ov.status === 'error') return <SectionError text="โหลดเรื่องเลยกำหนดไม่ได้" onRetry={ov.reload} />
  if (ov.status !== 'ok') return null
  const o = ov.derived?.overdue
  const failed = ['complaints', 'docRequests'].some((k) => ov.model[k]?.state === 'error')
  if (!o) return failed ? <SectionError text="โหลดเรื่องเลยกำหนดไม่ได้" onRetry={ov.reload} /> : null
  return (
    <div className="space-y-2">
      <StatCard id="overdue" tone="rose" size="lg" label="เลยกำหนด (ค้างอยู่ตอนนี้)" value={o.total} unit="เรื่อง" open={open} onToggle={toggle}
        sub={o.total === 0 ? 'ไม่มีเรื่องที่เลยกำหนด' : null}>
        <p className="mt-1 text-xs font-semibold text-slate-700">
          คำร้อง {execNf(o.complaints)} · คำขอ {execNf(o.docs)}
          {o.over5wd > 0 && <span className="ml-1 text-rose-700">· เกิน 5 วันทำการ {execNf(o.over5wd)}</span>}
        </p>
        <p className="mt-0.5 text-[10px] leading-snug text-slate-400">นับทุกเรื่องที่ค้างอยู่ตอนนี้ ไม่ขึ้นกับช่วงที่เลือก · คำร้องนับวันทำการ คำขอนับวันปฏิทิน</p>
      </StatCard>
      {failed && <SectionError text={`ตัวเลข${ov.model.complaints?.state === 'error' ? 'คำร้อง' : 'คำขอ'}โหลดไม่ได้ — ยอดนี้อาจต่ำกว่าจริง`} onRetry={ov.reload} />}
      {open === 'overdue' && <FormulaPanel title="เลยกำหนด" items={execFormulas(entries, 'overdue')} />}
    </div>
  )
}

/**
 * % เสร็จทันกำหนด แยก 2 ตัวเลขเท่ากัน: คำร้อง | คำขอ — ไม่รวมเป็นตัวเดียว (เจ้าของระบบเลือก 2569-11-10)
 * เพราะสองแหล่งนับกำหนดคนละแบบ (คำร้อง = วันทำการ · คำขอ = วันปฏิทิน) ค่ารวมจึงตรวจย้อนตามสูตรเดียวไม่ได้
 * แต่ละฝั่งมีลูกศรเทียบช่วงก่อนของตัวเอง + ตัวตั้ง/ตัวหารให้คำนวณซ้ำได้ · โมดูลไหนปิด = ฝั่งนั้นไม่แสดง
 */
function OnTimeCard({ d, p, open, onToggle }) {
  const t = TONES.emerald
  const sides = [
    { key: 'complaints', label: 'คำร้อง', cur: d.complaintOnTime, prev: p?.complaintOnTime, unitNote: 'นับวันทำการ' },
    { key: 'docs', label: 'คำขอ', cur: d.docOnTime, prev: p?.docOnTime, unitNote: 'นับวันปฏิทิน' },
  ].filter((s) => s.cur)
  const noneDue = sides.every((s) => s.cur.pct == null)
  return (
    <div data-exec-stat="on_time_pct" className={`min-w-0 rounded-2xl border-l-4 bg-white p-2.5 shadow-sm sm:p-3 ${t.card}`}>
      <div className="flex items-start justify-between gap-1">
        <p className={`min-w-0 text-[11px] font-bold sm:text-xs ${t.label}`}>% เสร็จทันกำหนด</p>
        <InfoButton active={open === 'on_time_pct'} onClick={() => onToggle('on_time_pct')} label="% เสร็จทันกำหนด" />
      </div>
      <div className={`grid gap-2 ${sides.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {sides.map((s) => (
          <div key={s.key} data-exec-on-time={s.key} className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-600">{s.label}</p>
            {/* 0% = ไม่ทันสักเรื่อง เป็นผลจริง → สีปกติ · เทาเฉพาะไม่มีข้อมูล (ขีด) */}
            <p className={`text-3xl font-black tabular-nums leading-none sm:text-4xl ${s.cur.pct != null ? t.value : 'text-slate-300'}`}>
              {s.cur.pct == null ? '—' : execNf(s.cur.pct)}
              {s.cur.pct != null && <span className="ml-0.5 text-base font-bold text-slate-400">%</span>}
            </p>
            <DeltaLine cmp={s.prev ? compareMetric(s.cur.pct, s.prev.pct) : null} unit="%" />
            <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
              {s.cur.denominator > 0 ? `ทัน ${execNf(s.cur.onTime)} จาก ${execNf(s.cur.denominator)} เรื่อง` : 'ยังไม่มีเรื่องครบกำหนด'} · {s.unitNote}
            </p>
          </div>
        ))}
      </div>
      {noneDue && <p className="mt-1 text-[10px] text-slate-500">ยังไม่มีเรื่องที่ครบกำหนดในช่วงนี้</p>}
    </div>
  )
}

/** % ทันกำหนด + คะแนนพึงพอใจ (เสียงจริง / ทุกที่มา) + อัตราตอบ — เทียบช่วงก่อนด้วยลูกศร */
export function QualityCards({ ov, entries, rangeText, compareText }) {
  const [open, toggle] = useFormulaToggle()
  if (ov.status !== 'ok') return null
  const d = ov.derived
  const p = ov.prevStatus === 'ok' ? ov.prevDerived : null
  if (!d?.complaintOnTime && !d?.docOnTime && !d?.satisfaction) {
    const failed = ['complaints', 'docRequests', 'satisfaction'].some((k) => ov.model[k]?.state === 'error')
    return failed ? <SectionError text="โหลด % ทันกำหนด และคะแนนพึงพอใจไม่ได้" onRetry={ov.reload} /> : null
  }
  const sat = d.satisfaction
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {(d.complaintOnTime || d.docOnTime) && <OnTimeCard d={d} p={p} open={open} onToggle={toggle} />}
        {sat && (
          <StatCard id="satisfaction" tone="violet" label="คะแนนพึงพอใจ (เสียงผู้รับบริการจริง)" value={sat.genuineAvg} unit={sat.genuineAvg == null ? '' : '/5'} open={open} onToggle={toggle}
            sub={[
              sat.genuineAvg == null ? 'ยังไม่มีคะแนนจากผู้รับบริการจริงในช่วงนี้' : `จาก ${execNf(sat.genuineCnt)} คะแนน`,
              `ทุกที่มา ${sat.allAvg == null ? '—' : sat.allAvg}`,
              `อัตราตอบ ${sat.responseRate == null ? '—' : `${sat.responseRate}%`} (${execNf(sat.anyRated)} จาก ${execNf(sat.closed)} เรื่องที่ปิด)`,
            ].join(' · ')}>
            <DeltaLine cmp={p?.satisfaction ? compareMetric(sat.genuineAvg, p.satisfaction.genuineAvg) : null} />
          </StatCard>
        )}
      </div>
      {(d.complaintOnTime || d.docOnTime || sat) && <p className="text-[10px] text-slate-500">ลูกศรเทียบกับ{compareText} · นับเรื่องที่ปิด/เสร็จในช่วง {rangeText}</p>}
      {open === 'on_time_pct' && <FormulaPanel title="% เสร็จทันกำหนด" items={execFormulas(entries, 'on_time_pct')} />}
      {open === 'satisfaction' && <FormulaPanel title="คะแนนพึงพอใจ และอัตราตอบ" items={execFormulas(entries, ['satisfaction', 'response_rate'])} />}
    </div>
  )
}

// ───────────────────────── ②-3 คอขวด ─────────────────────────

const parkReasonLabel = (code) => PARK_REASONS.find((r) => r.code === code)?.label ?? code
const stageLabel = (s) => EXEC_COMPLAINT_STAGES.find((x) => x.s === s)?.label ?? s

/** ค้างอยู่ตอนนี้: ยังไม่รับ / ยังไม่มีผู้รับผิดชอบ / รอดำเนินการ (parked) แยกการ์ด + ขั้นที่ค้าง + กลุ่มอายุ (วันทำการ) */
export function BottleneckBlock({ ov, entries }) {
  const [open, toggle] = useFormulaToggle()
  if (ov.status === 'forbidden' || ov.status === 'idle') return null
  return (
    <div data-exec-bottleneck className="space-y-2">
      <SubHead>คอขวด — คำร้องที่ค้างอยู่ตอนนี้</SubHead>
      <SummaryGate ov={ov} name="complaints" label="ยอดค้างของคำร้อง">
        {(c) => {
          const b = ov.derived?.complaintBacklog
          if (!b) return null
          const notReceived = b.stages.find((s) => s.s === 'new')?.n ?? 0
          const maxStage = b.stages.reduce((m, s) => Math.max(m, s.n), 0)
          const maxBucket = b.ageBuckets.reduce((m, x) => Math.max(m, x.n), 0)
          return (
            <>
              <div className="grid grid-cols-3 gap-2">
                <StatCard id="not_received" tone="amber" label="ยังไม่รับเรื่อง" value={notReceived} open={open} onToggle={toggle} />
                <StatCard id="unassigned" tone="orange" label="ยังไม่มีผู้รับผิดชอบ" value={b.unassigned} open={open} onToggle={toggle} />
                <StatCard id="parked" tone="slate" label="รอดำเนินการ" value={c.parked.n} open={open} onToggle={toggle}
                  sub={c.parked.byReason.length > 0 ? c.parked.byReason.map((r) => `${parkReasonLabel(r.reason)} ${r.n}`).join(' · ') : null} />
              </div>
              {open === 'not_received' && <FormulaPanel title="ยังไม่รับเรื่อง" items={execFormulas(entries, 'not_received')} />}
              {open === 'unassigned' && <FormulaPanel title="ยังไม่มีผู้รับผิดชอบ" items={execFormulas(entries, 'unassigned')} />}
              {open === 'parked' && <FormulaPanel title="ขึ้นทะเบียนรอดำเนินการ" items={execFormulas(entries, 'parked')} />}

              {b.total === 0 ? (
                <p className="rounded-2xl border border-emerald-200 bg-white px-3 py-3 text-xs text-emerald-800">ไม่มีคำร้องค้างอยู่ตอนนี้ (ไม่รวมรอดำเนินการและหมวดเฉพาะกิจ)</p>
              ) : (
                <div className="space-y-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-1">
                    <p className="flex-1 text-xs font-bold text-slate-700">ค้างอยู่ขั้นไหน · ค้าง {execNf(b.total)} เรื่อง</p>
                    <InfoButton active={open === 'bottleneck'} onClick={() => toggle('bottleneck')} label="ค้างอยู่ขั้นไหน" />
                  </div>
                  <ul className="space-y-1.5">
                    {b.stages.map((s) => (
                      <li key={s.s} data-exec-stage={s.s}>
                        <div className="flex items-baseline gap-2 text-xs">
                          <span className="min-w-0 flex-1 font-medium text-slate-700">
                            {stageLabel(s.s)}
                            {s.s === b.worstStage && b.stages.length > 1 && <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">ค้างมากสุด</span>}
                          </span>
                          <span className="font-black tabular-nums text-slate-900">{execNf(s.n)}</span>
                          <span className="w-24 shrink-0 text-right text-[10px] text-slate-500">{s.avgAge == null ? 'อายุ —' : `อายุเฉลี่ย ${execNf(s.avgAge)} วันทำการ`}</span>
                        </div>
                        <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                          <div className={`h-full rounded-full ${s.s === b.worstStage ? 'bg-rose-400' : 'bg-sky-400'}`} style={{ width: `${maxStage > 0 ? Math.max(3, Math.round((s.n / maxStage) * 100)) : 0}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-slate-500">อายุเรื่อง (วันทำการนับจากวันที่แจ้ง)</p>
                    <ul className="grid grid-cols-4 gap-1.5">
                      {b.ageBuckets.map((x) => (
                        <li key={x.key} data-exec-age={x.key} className="min-w-0 rounded-lg bg-slate-50 px-1 py-1.5 text-center">
                          <span className="block text-[10px] leading-tight text-slate-500">{x.label}</span>
                          <span className={`block text-lg font-black tabular-nums ${x.n > 0 ? (x.key === '15+' ? 'text-rose-600' : 'text-slate-800') : 'text-slate-300'}`}>{execNf(x.n)}</span>
                          <span className="mx-auto mt-0.5 block h-1 w-3/4 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                            <span className="block h-full rounded-full bg-sky-400" style={{ width: `${maxBucket > 0 ? Math.round((x.n / maxBucket) * 100) : 0}%` }} />
                          </span>
                        </li>
                      ))}
                    </ul>
                    {b.ageUnknown > 0 && <p className="mt-1 text-[10px] text-slate-400">ไม่ทราบวันที่แจ้ง {execNf(b.ageUnknown)} เรื่อง (ไม่อยู่ในกลุ่มอายุ)</p>}
                  </div>
                </div>
              )}
              {open === 'bottleneck' && <FormulaPanel title="ค้างอยู่ขั้นไหน" items={execFormulas(entries, 'bottleneck')} />}
            </>
          )
        }}
      </SummaryGate>
    </div>
  )
}

// ───────────────────────── ②-4 หมู่บ้าน + ปัญหาซ้ำซาก ─────────────────────────

const VILLAGE_TOP = 8

export function VillageBlock({ ov, entries }) {
  const [open, toggle] = useFormulaToggle()
  const [showAll, setShowAll] = useState(false)
  if (ov.status === 'forbidden' || ov.status === 'idle') return null
  return (
    <div data-exec-villages className="space-y-2">
      <div className="flex items-center gap-1">
        <SubHead>แยกหมู่บ้าน (คำร้อง)</SubHead>
        <InfoButton active={open === 'by_village'} onClick={() => toggle('by_village')} label="แยกหมู่บ้าน" />
      </div>
      <SummaryGate ov={ov} name="complaints" label="คำร้องแยกหมู่บ้าน">
        {(c) => {
          const list = showAll ? c.villages : c.villages.slice(0, VILLAGE_TOP)
          const max = c.villages.reduce((m, v) => Math.max(m, v.n), 0)
          const empty = c.villages.length === 0 && c.villagesUnlisted === 0
          return (
            <>
              {empty ? (
                <p className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">ยังไม่มีคำร้องที่ระบุหมู่บ้านในช่วงนี้</p>
              ) : (
                <ul className="space-y-1.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  {list.map((v) => (
                    <li key={v.village} data-exec-village={v.village}>
                      <div className="flex items-baseline gap-2 text-xs">
                        <span className="min-w-0 flex-1 break-words font-medium text-slate-700">{v.village}</span>
                        <span className="font-black tabular-nums text-slate-900">{execNf(v.n)}<span className="sr-only"> เรื่อง</span></span>
                      </div>
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                        <div className="h-full rounded-full bg-sky-400" style={{ width: `${max > 0 ? Math.max(3, Math.round((v.n / max) * 100)) : 0}%` }} />
                      </div>
                    </li>
                  ))}
                  {c.villages.length > VILLAGE_TOP && (
                    <li>
                      <button type="button" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}
                        className="inline-flex min-h-8 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                        {showAll ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                        {showAll ? 'แสดงเฉพาะอันดับต้น' : `แสดงทั้งหมด (${execNf(c.villages.length)} หมู่/ชุมชน)`}
                      </button>
                    </li>
                  )}
                  {/* แสดงเสมอเมื่อ > 0: ไม่งั้นยอดรายหมู่รวมไม่เท่ายอดคำร้องทั้งหมดโดยไม่มีคำอธิบาย */}
                  {c.villagesUnlisted > 0 && (
                    <li data-exec-village-unlisted className="flex items-baseline gap-2 border-t border-dashed border-slate-200 pt-1.5 text-xs text-amber-800">
                      <span className="min-w-0 flex-1">ไม่อยู่ในทะเบียนสถานที่ (ผู้แจ้งพิมพ์เอง)</span>
                      <span className="font-black tabular-nums">{execNf(c.villagesUnlisted)}<span className="sr-only"> เรื่อง</span></span>
                    </li>
                  )}
                </ul>
              )}
              {open === 'by_village' && <FormulaPanel title="แยกหมู่บ้าน" items={execFormulas(entries, 'by_village')} />}

              <div className="space-y-1.5">
                <div className="flex items-center gap-1">
                  <p className="flex-1 text-xs font-bold text-slate-700">ปัญหาซ้ำซาก (หมวดเดียวกัน + หมู่เดียวกัน ตั้งแต่ {execNf(c.repeat.min)} เรื่องใน {execNf(c.repeat.days)} วัน)</p>
                  <InfoButton active={open === 'repeat'} onClick={() => toggle('repeat')} label="ปัญหาซ้ำซาก" />
                </div>
                {c.repeat.groups.length === 0 ? (
                  <p className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500">ไม่มีกลุ่มที่ซ้ำเกินเกณฑ์</p>
                ) : (
                  <ul data-exec-repeat className="space-y-1 rounded-2xl border border-amber-200 bg-white p-2.5 shadow-sm">
                    {c.repeat.groups.map((g) => (
                      <li key={`${g.category}|${g.village}`} className="flex items-baseline gap-2 text-xs">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0 self-start text-amber-500" aria-hidden="true" />
                        <span className="min-w-0 flex-1 break-words text-slate-700">{g.label} · {g.village}</span>
                        <span className="font-black tabular-nums text-slate-900">{execNf(g.n)} เรื่อง</span>
                      </li>
                    ))}
                  </ul>
                )}
                {open === 'repeat' && <FormulaPanel title="ปัญหาซ้ำซาก" items={execFormulas(entries, 'repeat')} />}
              </div>
            </>
          )
        }}
      </SummaryGate>
    </div>
  )
}

// ───────────────────────── ②-5 คะแนนแยกที่มา ─────────────────────────

export function SatisfactionBlock({ ov, entries }) {
  const [open, toggle] = useFormulaToggle()
  if (ov.status === 'forbidden' || ov.status === 'idle') return null
  const lowRule = entries.flatMap((e) => (e.alerts ?? []).filter((a) => a.id === 'low_rating').map((a) => ({ who: e.label, formula: a.rule })))
  return (
    <div data-exec-satisfaction className="space-y-2">
      <div className="flex items-center gap-1">
        <SubHead>คะแนนความพึงพอใจ แยกตามที่มา</SubHead>
        <InfoButton active={open === 'by_source'} onClick={() => toggle('by_source')} label="คะแนนแยกที่มา" />
      </div>
      <SummaryGate ov={ov} name="satisfaction" label="คะแนนความพึงพอใจ">
        {() => {
          const v = ov.derived?.satisfaction
          if (!v) return null
          const rows = v.sources.filter((s) => s.cnt > 0)
          const none = rows.length === 0 && v.general.n === 0
          return (
            <>
              {none ? (
                <p className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">ยังไม่มีคะแนนในช่วงนี้</p>
              ) : (
                <ul className="space-y-1.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  {rows.map((s) => (
                    <li key={s.key} data-exec-source={s.key} className="flex items-baseline gap-2 text-xs">
                      <Smile size={13} className="shrink-0 self-center text-violet-500" aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-slate-700">{s.label}<span className="text-slate-400"> · {execNf(s.complaints)} เรื่อง</span></span>
                      <span className="font-black tabular-nums text-slate-900">{s.avg == null ? '—' : s.avg}</span>
                      <span className="w-16 shrink-0 text-right text-[10px] text-slate-500">{execNf(s.cnt)} คะแนน</span>
                    </li>
                  ))}
                  <li data-exec-source="general" className="flex items-baseline gap-2 border-t border-dashed border-slate-200 pt-1.5 text-xs">
                    <span className="min-w-0 flex-1 text-slate-700">แบบประเมินภาพรวมหน่วยงาน
                      <InfoButton active={open === 'general'} onClick={() => toggle('general')} label="แบบประเมินภาพรวม" />
                    </span>
                    <span className="font-black tabular-nums text-slate-900">{v.general.avg == null ? '—' : v.general.avg}</span>
                    <span className="w-16 shrink-0 text-right text-[10px] text-slate-500">{execNf(v.general.n)} ครั้ง</span>
                  </li>
                </ul>
              )}
              {open === 'by_source' && <FormulaPanel title="คะแนนแยกที่มา" items={execFormulas(entries, 'by_source')} />}
              {open === 'general' && <FormulaPanel title="แบบประเมินภาพรวม" items={execFormulas(entries, 'general')} />}

              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <p className="flex-1 text-xs font-bold text-slate-700">คะแนนต่ำ (1–2) ที่ให้ในช่วงนี้ · {execNf(v.lowTotal)} คะแนน</p>
                  {lowRule.length > 0 && <InfoButton active={open === 'low'} onClick={() => toggle('low')} label="คะแนนต่ำ" />}
                </div>
                {v.low.length === 0 ? (
                  <p className="rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-800">ไม่มีคะแนนต่ำในช่วงนี้</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {v.low.map((x) => (
                      <li key={x.key} className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700">{x.label} {execNf(x.n)}</li>
                    ))}
                  </ul>
                )}
                <p className="text-[10px] text-slate-400">ไม่แสดงความเห็นของผู้ประเมิน — ดูรายละเอียดที่เมนูความพึงพอใจตามสิทธิ์เดิม</p>
                {open === 'low' && <FormulaPanel title="คะแนนต่ำ" items={lowRule} />}
              </div>
            </>
          )
        }}
      </SummaryGate>
    </div>
  )
}

// ───────────────────────── ②-6 ช่องทาง ─────────────────────────

// [คีย์, ป้าย, สี] — สีตามลำดับคงที่ของ EXEC_CHART · "ไม่ทราบ" เป็นเทา (ไม่ใช่หมวด) และไม่อ้างสาเหตุบนป้าย
// เพราะนับรวมทั้งคำขอก่อนมีตราประทับ (#646) และบัญชีผู้กรอกที่ถูกลบ — รายละเอียดอยู่ใน ⓘ ของทะเบียน
const ENTERED_LABELS = [
  ['citizen', 'ประชาชนยื่นเอง', EXEC_CHART.blue], ['council', 'สท. ยื่นให้', EXEC_CHART.orange],
  ['staff', 'เจ้าหน้าที่กรอกแทน (เคาน์เตอร์)', EXEC_CHART.aqua], ['unknown', 'ไม่ทราบผู้กรอก', EXEC_CHART.muted],
]

export function ChannelBlock({ ov, entries }) {
  const [open, toggle] = useFormulaToggle()
  if (ov.status === 'loading') return <LoadingLine text="กำลังโหลดช่องทางแจ้ง…" />
  if (ov.status === 'error') return <SectionError text="โหลดช่องทางแจ้งไม่ได้" onRetry={ov.reload} />
  if (ov.status !== 'ok') return null
  const c = ov.model.complaints
  const d = ov.model.docRequests
  if (c.state === 'missing' && d.state === 'missing') return null
  const p = c.state === 'ok' ? c.data.period : null
  const other = p ? Math.max(0, p.total - p.citizen_online - p.oss_counter) : 0
  const enteredTotal = d.state === 'ok' ? ENTERED_LABELS.reduce((t, [k]) => t + d.data.entered[k], 0) : 0
  return (
    <div data-exec-channel className="space-y-2">
      <SubHead>ช่องทางแจ้ง / ผู้กรอก</SubHead>
      {c.state === 'error' && <SectionError text="โหลดช่องทางแจ้งของคำร้องไม่ได้" onRetry={ov.reload} />}
      {p && (
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-1">
            <p className="flex-1 text-xs font-bold text-slate-700">คำร้องที่แจ้งในช่วงนี้ · {execNf(p.total)} เรื่อง</p>
            <InfoButton active={open === 'channel'} onClick={() => toggle('channel')} label="ช่องทางแจ้ง" />
          </div>
          {p.total === 0 ? (
            <p className="text-xs text-slate-500">ยังไม่มีคำร้องในช่วงนี้</p>
          ) : (
            <SplitBar testId="channel" label="ช่องทางแจ้งคำร้อง" parts={[
              { key: 'online', label: 'ออนไลน์ (ประชาชนแจ้งเอง)', value: p.citizen_online, color: EXEC_CHART.blue },
              { key: 'counter', label: 'รับที่เคาน์เตอร์', value: p.oss_counter, color: EXEC_CHART.orange },
              ...(other > 0 ? [{ key: 'other', label: 'ช่องทางอื่น/ไม่ระบุ', value: other, color: EXEC_CHART.muted }] : []),
            ]} />
          )}
          {open === 'channel' && <FormulaPanel title="ช่องทางแจ้ง" items={execFormulas(entries, 'channel')} />}
          {/* เรื่องอ่อนไหว = จำนวนเท่านั้น (ไม่แตกหมู่บ้าน/หมวด) */}
          <div className="flex items-center gap-1 border-t border-dashed border-slate-200 pt-2 text-xs">
            <span data-exec-confidential className="min-w-0 flex-1 text-slate-700">เรื่องอ่อนไหว (เจ้าหน้าที่รับเรื่องเอง) <span className="font-black tabular-nums text-slate-900">{execNf(p.confidential)} เรื่อง</span></span>
            <InfoButton active={open === 'confidential'} onClick={() => toggle('confidential')} label="เรื่องอ่อนไหว" />
          </div>
          {open === 'confidential' && <FormulaPanel title="เรื่องอ่อนไหว" items={execFormulas(entries, 'confidential')} />}
        </div>
      )}
      {d.state === 'error' && <SectionError text="โหลดผู้กรอกคำขอไม่ได้" onRetry={ov.reload} />}
      {d.state === 'ok' && (
        <div className="space-y-1.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-1">
            <p className="flex-1 text-xs font-bold text-slate-700">ผู้กรอกคำขอ E-Service ที่ยื่นในช่วงนี้ · {execNf(enteredTotal)} เรื่อง</p>
            <InfoButton active={open === 'entered'} onClick={() => toggle('entered')} label="ผู้กรอกคำขอ" />
          </div>
          {enteredTotal === 0 ? (
            <p className="text-xs text-slate-500">ยังไม่มีคำขอในช่วงนี้</p>
          ) : (
            <SplitBar testId="entered" label="ผู้กรอกคำขอ E-Service"
              parts={ENTERED_LABELS.map(([k, label, color]) => ({ key: k, label, value: d.data.entered[k], color }))} />
          )}
          {open === 'entered' && <FormulaPanel title="ผู้กรอกคำขอ" items={execFormulas(entries, 'entered')} />}
        </div>
      )}
    </div>
  )
}

// ───────────────────────── รถรับ-ส่ง (ยอดรวมเท่านั้น) ─────────────────────────

export function TransportBlock({ ov, entries }) {
  const [open, toggle] = useFormulaToggle()
  if (!entries.some((e) => e.key === 'patient-transport')) return null
  if (ov.status === 'forbidden' || ov.status === 'idle') return null
  return (
    <div data-exec-transport className="space-y-2">
      <SubHead>รถรับ-ส่ง (เที่ยวที่ออกรถจริง · ยอดรวมเท่านั้น)</SubHead>
      <SummaryGate ov={ov} name="patientTransport" label="เที่ยวรถรับ-ส่ง">
        {(t) => {
          const pt = ov.prevStatus === 'ok' && ov.prevModel?.patientTransport?.state === 'ok' ? ov.prevModel.patientTransport.data : null
          return (
            <>
              <div className="grid grid-cols-2 gap-2">
                <StatCard id="trips" tone="sky" label="เที่ยวรับ-ส่งผู้ป่วย" value={t.trips.patient.ran} unit="เที่ยว" open={open} onToggle={toggle}>
                  <DeltaLine cmp={pt ? compareValues(t.trips.patient.ran, pt.trips.patient.ran) : null} />
                </StatCard>
                <StatCard id="community_trips" tone="emerald" label="เที่ยวรับ-ส่งชุมชน" value={t.trips.community.ran} unit="เที่ยว" open={open} onToggle={toggle}>
                  <DeltaLine cmp={pt ? compareValues(t.trips.community.ran, pt.trips.community.ran) : null} />
                </StatCard>
              </div>
              {open === 'trips' && <FormulaPanel title="เที่ยวรับ-ส่งผู้ป่วย" items={execFormulas(entries, 'trips')} />}
              {open === 'community_trips' && <FormulaPanel title="เที่ยวรับ-ส่งชุมชน" items={execFormulas(entries, 'community_trips')} />}
            </>
          )
        }}
      </SummaryGate>
    </div>
  )
}
