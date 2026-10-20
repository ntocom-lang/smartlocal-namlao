import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronRight, ClipboardList, Loader2, RefreshCw } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { supabase } from '../lib/supabase'
import SurveyShell from '../components/survey/SurveyShell'
import { SURVEY_NOT_A_VOTE_NOTICE, formatSurveyDate, surveyDaysLeft, surveyPath } from '../lib/survey'

// รายการแบบสำรวจของหน่วยงาน: ที่เปิดอยู่ขึ้นก่อน ตามด้วยที่ปิดแล้วและมีผู้ตอบ (ผลแสดงถาวร)
// list_surveys() เปิดให้ผู้ไม่ล็อกอินเรียกได้ — ส่งแค่คำถามกับยอดรวม ไม่มีผลรายตัวเลือก

const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-4'

export default function SurveysPage() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id ?? null
  const [phase, setPhase] = useState('loading') // loading | ready | error
  const [items, setItems] = useState([])

  const load = useCallback(async () => {
    if (!tenantId) return
    setPhase('loading')
    const { data, error } = await supabase.rpc('list_surveys', { _municipality_id: tenantId })
    if (error) { setPhase('error'); return }
    setItems(Array.isArray(data) ? data : [])
    setPhase('ready')
  }, [tenantId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดรายการครั้งแรกตอนเปิดหน้า (async ภายใน load)
    load()
  }, [load])

  return (
    <SurveyShell title="แบบสำรวจความเห็น">
      <p className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{SURVEY_NOT_A_VOTE_NOTICE}</p>

      {phase === 'loading' && (
        <div className={`${card} flex items-center justify-center gap-2 py-10 text-sm text-gray-500`} role="status">
          <Loader2 size={18} className="animate-spin" aria-hidden="true" /> กำลังโหลด...
        </div>
      )}

      {phase === 'error' && (
        <div className={`${card} text-center space-y-3 py-8`}>
          <AlertTriangle size={32} className="mx-auto text-amber-400" aria-hidden="true" />
          <p className="text-sm text-gray-700">โหลดไม่สำเร็จ เครือข่ายอาจช้าหรือขาดช่วง</p>
          <button type="button" onClick={load} className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
            <RefreshCw size={16} aria-hidden="true" /> ลองใหม่
          </button>
        </div>
      )}

      {phase === 'ready' && items.length === 0 && (
        <div className={`${card} text-center space-y-2 py-8`}>
          <ClipboardList size={32} className="mx-auto text-gray-300" aria-hidden="true" />
          <p className="text-base font-bold text-gray-800">ยังไม่มีแบบสำรวจ</p>
          <p className="text-sm text-gray-500">เมื่อหน่วยงานเปิดแบบสำรวจใหม่ จะแสดงที่นี่และที่หน้าแรก</p>
        </div>
      )}

      {phase === 'ready' && items.length > 0 && (
        <ul className="space-y-2">
          {items.map(s => (
            <li key={s.id}>
              <Link to={surveyPath(s.id)} className={`${card} flex items-center gap-3 hover:bg-gray-50`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${s.status === 'open' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                      {s.status === 'open' ? 'เปิดรับความเห็น' : 'ปิดรับแล้ว'}
                    </span>
                    {s.status === 'open' && s.has_voted && <span className="text-xs font-semibold text-gray-500">คุณตอบแล้ว</span>}
                  </div>
                  <p className="text-sm font-bold text-gray-900 leading-snug break-words">{s.question}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    ตอบแล้ว {s.total} คน · {s.status === 'open' ? `เหลือ ${surveyDaysLeft(s.closes_at)} วัน (ถึง ${formatSurveyDate(s.closes_at)})` : `ปิดเมื่อ ${formatSurveyDate(s.closes_at)}`}
                  </p>
                </div>
                <ChevronRight size={18} className="shrink-0 text-gray-300" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-xs text-gray-400 px-4 pt-2"><Link to="/" className="underline">กลับหน้าแรก</Link></p>
    </SurveyShell>
  )
}
