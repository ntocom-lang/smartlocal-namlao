import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ClipboardList } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { supabase } from '../../lib/supabase'
import { pickSurveyForHome, surveyDaysLeft, surveyPath } from '../../lib/survey'

// การ์ดแบบสำรวจบนหน้าแรกประชาชน — ขึ้นเฉพาะตอนมีแบบสำรวจที่เกี่ยวข้อง วันปกติคืน null ไม่กินความสูง
// ลำดับ: ที่เปิดอยู่และผู้ดูยังไม่ได้ตอบ → ที่เปิดอยู่และตอบแล้ว (ขอบคุณ+ดูผล) → ที่เพิ่งปิดไม่เกิน SURVEY_HOME_RECENT_DAYS วัน (ดูผล) — กติกาเลือกอยู่ที่ pickSurveyForHome ใน lib/survey.js
// ผู้ไม่ล็อกอิน has_voted เป็น false เสมอ จึงเห็นคำเชิญ กดแล้วไปหน้าตอบซึ่งชวนล็อกอินอีกที
// ไม่ขัดจังหวะสิ่งสำคัญกว่า: วางใต้แถบเตือนน้ำ-ฝน (ถ้ามี) ไม่ใช่เหนือมัน
export default function SurveyHomeCard({ className = '' }) {
  const { tenant } = useTenant()
  const tenantId = tenant?.id ?? null
  const [list, setList] = useState(null)

  useEffect(() => {
    if (!tenantId) return undefined
    let alive = true
    supabase.rpc('list_surveys', { _municipality_id: tenantId }).then(({ data, error }) => {
      if (alive) setList(!error && Array.isArray(data) ? data : [])
    }, () => {
      if (alive) setList([])
    })
    return () => { alive = false }
  }, [tenantId])

  const pick = pickSurveyForHome(list)
  if (!pick) return null
  const { kind, survey, moreCount } = pick
  const left = surveyDaysLeft(survey.closes_at)

  const label = kind === 'invite' ? 'ร่วมตอบแบบสำรวจ' : kind === 'thanks' ? 'ขอบคุณที่ร่วมตอบแบบสำรวจ' : 'ผลแบบสำรวจล่าสุด'
  const cta = kind === 'invite' ? 'ตอบแบบสำรวจ (ใช้เวลาไม่ถึง 1 นาที)' : 'ดูผลแบบสำรวจ'

  return (
    <section aria-label="แบบสำรวจความเห็น" className={className}>
      <Link to={surveyPath(survey.id)}
        className="block rounded-2xl border-2 p-3 sm:p-4 transition-colors"
        style={{ borderColor: 'color-mix(in srgb, var(--color-primary) 35%, white)', backgroundColor: 'color-mix(in srgb, var(--color-primary) 7%, white)' }}>
        <div className="flex items-start gap-2.5">
          <ClipboardList size={20} className="mt-0.5 shrink-0" style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold" style={{ color: 'var(--color-primary)' }}>{label}</p>
            <p className="mt-0.5 text-sm font-bold leading-snug text-gray-900 break-words">{survey.question}</p>
            <p className="mt-0.5 text-xs text-gray-600">
              {survey.status === 'open' ? `เหลืออีก ${left} วัน · ` : ''}ตอบแล้ว {survey.total} คน
            </p>
            <span className="mt-1.5 inline-flex min-h-[44px] items-center gap-0.5 text-sm font-bold" style={{ color: 'var(--color-primary)' }}>
              {cta} <ChevronRight size={16} aria-hidden="true" />
            </span>
          </div>
        </div>
      </Link>
      {moreCount > 0 && (
        <p className="mt-1 text-right text-xs"><Link to="/surveys" className="underline text-gray-600">ดูแบบสำรวจทั้งหมด ({moreCount + 1})</Link></p>
      )}
    </section>
  )
}
