// ชิ้นส่วนหน้าตาเล็กๆ ของหน้าวงจรโครงการ: จุด 9 จุดในรายการ · ป้ายขั้น · ไอคอนระดับคำเตือน
import { AlertOctagon, AlertTriangle, CalendarClock, CheckCircle2, Info } from 'lucide-react'
import { STAGE_LABELS, buildProjectSteps } from '../../../lib/constructionLifecycle'
import { DEADLINE_TONE, STAGE_COLORS, STAGE_SHORT, VERIFY_TEXT, deadlineStatusText, thaiDay } from './lifecycleFormat'

const DOT_STYLE = {
  done: { backgroundColor: '#1b7a6e' },
  now: { backgroundColor: '#fff', boxShadow: '0 0 0 2px #1b7a6e inset' },
  hold: { backgroundColor: '#f59e0b' },
  todo: { backgroundColor: '#e5e7eb' },
  stop: { backgroundColor: '#dc2626' },
}
const DOT_WORD = { done: 'ผ่านแล้ว', now: 'ขั้นปัจจุบัน', hold: 'ระงับอยู่ที่ขั้นนี้', todo: 'ยังไม่ถึง', stop: 'หยุดที่นี่' }

/** จุดขั้น 9 จุด (เขียว = ผ่าน · วงเขียว = ขั้นปัจจุบัน · ส้ม = ระงับ) + จุดแดงเมื่อยกเลิก/บอกเลิก */
export function StepDots({ project, events }) {
  const steps = buildProjectSteps(project, events)
  return (
    <span className="flex items-center gap-1" role="img" aria-label={`ขั้นของโครงการ: ${STAGE_LABELS[project?.stage] ?? '—'}`}>
      {steps.map(step => (
        <span key={step.key} className="inline-block size-2.5 rounded-full" title={`${step.label} — ${DOT_WORD[step.state]}`} style={DOT_STYLE[step.state]} />
      ))}
    </span>
  )
}

/** ป้ายชื่อขั้นปัจจุบัน · ระงับแสดงขั้นที่ระงับอยู่ด้วย */
export function StageBadge({ project }) {
  const stage = project?.stage
  if (!stage) return null
  const held = stage === 'suspended' && project.stage_before_hold ? ` (ขั้น${STAGE_SHORT[project.stage_before_hold]})` : ''
  const hot = stage === 'suspended' || stage === 'terminated' || stage === 'cancelled'
  return (
    <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold"
      style={{ backgroundColor: hot ? '#fef3c7' : '#f0fdfa', color: hot ? '#92400e' : STAGE_COLORS[stage] }}>
      {STAGE_LABELS[stage]}{held}
    </span>
  )
}

export function LevelIcon({ level, size = 15 }) {
  const Icon = level === 'error' ? AlertOctagon : level === 'warn' ? AlertTriangle : Info
  const color = level === 'error' ? 'text-red-600' : level === 'warn' ? 'text-amber-600' : 'text-sky-600'
  return <Icon size={size} className={`mt-0.5 shrink-0 ${color}`} aria-label={level === 'error' ? 'เร่งด่วน' : level === 'warn' ? 'ควรดู' : 'แจ้งให้ทราบ'} role="img" />
}

/** แถวกำหนดเวลาตามระเบียบที่ไม่มีช่องกรอกของตัวเอง (ข้อมูลมาจากงวดงาน/หนังสือ/ผลตรวจ) — แสดงอย่างเดียว */
export function DeadlineRow({ deadline: d }) {
  const level = d.state === 'overdue' ? 'error' : d.state === 'due_today' || d.state === 'late_done' ? 'warn' : null
  return (
    <li className={`flex items-start gap-2 px-4 py-2.5 text-sm ${DEADLINE_TONE[d.state] ?? ''}`}>
      {level ? <LevelIcon level={level} size={18} />
        : d.state === 'done' || d.state === 'passed'
          ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-label="เรียบร้อย" role="img" />
          : <CalendarClock size={18} className="mt-0.5 shrink-0 text-gray-400" aria-label="กำหนดเวลา" role="img" />}
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-gray-900">{d.label}</span>
        <span className={`mt-0.5 block text-xs ${d.state === 'overdue' ? 'font-bold text-red-700' : 'text-gray-600'}`}>
          {d.mode === 'gate' ? 'พ้นวันที่' : 'ภายใน'} {thaiDay(d.due)}{deadlineStatusText(d) ? ` — ${deadlineStatusText(d)}` : ''}
          {d.opensOn && ` · เริ่มตรวจได้ตั้งแต่ ${thaiDay(d.opensOn)}`}
          {d.party === 'contractor' && ' · หน้าที่ของผู้รับจ้าง (ระบบแค่บันทึกว่าทันหรือไม่)'}
          {d.verify && <span className="ml-1 text-amber-700">({VERIFY_TEXT})</span>}
          {d.state === 'overdue' && d.overdueHint && <span className="block font-normal">{d.overdueHint}</span>}
        </span>
        {d.basis && <span className="mt-0.5 block text-[11px] text-gray-400">{d.basis}</span>}
      </span>
    </li>
  )
}
