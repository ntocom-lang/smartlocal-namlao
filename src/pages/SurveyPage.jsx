import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Loader2, LogIn, RefreshCw, Search } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { supabase } from '../lib/supabase'
import SurveyShell from '../components/survey/SurveyShell'
import SurveyResultBars from '../components/survey/SurveyResultBars'
import SurveyShare from '../components/survey/SurveyShare'
import {
  SURVEY_BUSY_MESSAGE, SURVEY_COMMENT_MAX, SURVEY_NOT_A_VOTE_NOTICE, SURVEY_VOTE_ERRORS,
  formatSurveyDate, isSurveyBusy, isSurveyId, recallMyAnswer, rememberMyAnswer, surveyDaysLeft, surveyPath, surveyThanksText,
} from '../lib/survey'

// หน้าตอบแบบสำรวจ /survey/:id — ใครก็เปิดอ่านคำถามได้ ตอบได้เฉพาะผู้ล็อกอินที่สังกัดหน่วยงานนี้ 1 คน 1 เสียง
// ข้อมูลมาจาก get_survey() ฝั่งฐานข้อมูลตัดสินเองว่าผู้เรียกตอบได้ไหม (vote_block) และเห็นผลได้หรือยัง (results_visible)
// ผลรายตัวเลือกไม่ส่งมาก่อนตอบ — หน้านี้จึงโชว์ไม่ได้ต่อให้โค้ดผิด · เซิร์ฟเวอร์ไม่รู้ว่าใครเลือกข้อไหน (ตั้งใจ)
// ป้าย "ไม่ใช่มติ" ขึ้นทุกสถานะที่แสดงคำถาม/ผล

const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-4'
const sectionLabel = 'text-xs font-semibold text-gray-400 uppercase tracking-wider'

function Notice({ tone = 'green', children }) {
  const tones = {
    green: 'bg-green-50 border-green-200 text-green-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
  }
  return <p role="status" className={`rounded-2xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</p>
}

export default function SurveyPage() {
  const { id } = useParams()
  const { tenant } = useTenant()
  const tenantId = tenant?.id ?? null
  const idOk = isSurveyId(id)

  const [phase, setPhase] = useState(idOk ? 'loading' : 'notfound') // loading | ready | notfound | error
  const [data, setData] = useState(null)
  const [choice, setChoice] = useState(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [voteError, setVoteError] = useState('')
  const [thanks, setThanks] = useState('')
  const [mine, setMine] = useState(() => (idOk ? recallMyAnswer(id) : null))

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!idOk || !tenantId) return
    if (!quiet) setPhase('loading')
    const { data: result, error } = await supabase.rpc('get_survey', { _survey_id: id, _municipality_id: tenantId })
    if (error) { setPhase('error'); return }
    if (!result?.found) { setPhase('notfound'); return }
    setData(result)
    setPhase('ready')
  }, [id, idOk, tenantId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดแบบสำรวจครั้งแรกตอนเปิดหน้า (async ภายใน load)
    load()
  }, [load])

  async function submit() {
    if (!choice || sending) return
    setSending(true); setVoteError('')
    const { data: res, error } = await supabase.rpc('cast_survey_vote', {
      _survey_id: id, _municipality_id: tenantId, p_option_id: choice, p_comment: comment.trim() || null,
    })
    setSending(false)
    if (error) { setVoteError(isSurveyBusy(error) ? SURVEY_BUSY_MESSAGE : 'ส่งคำตอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'); return }
    if (!res?.ok) {
      // already_voted = ตอบไปแล้ว (เช่นกดซ้ำตอนสัญญาณช้า หรือตอบจากอีกเครื่อง) โหลดใหม่ให้เห็นผล ไม่ต้องขึ้น error
      if (res?.code === 'already_voted') { await load({ quiet: true }); return }
      setVoteError(SURVEY_VOTE_ERRORS[res?.code] ?? 'ส่งคำตอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
      if (['not_open', 'not_found', 'other_municipality'].includes(res?.code)) await load({ quiet: true })
      return
    }
    rememberMyAnswer(id, choice)
    setMine(choice)
    setThanks(surveyThanksText(res))
    await load({ quiet: true })
  }

  const open = data?.status === 'open'
  const daysLeft = data ? surveyDaysLeft(data.closes_at) : 0

  return (
    <SurveyShell title="แบบสำรวจความเห็น">
      {phase === 'loading' && (
        <div className={`${card} flex items-center justify-center gap-2 py-10 text-sm text-gray-500`} role="status">
          <Loader2 size={18} className="animate-spin" aria-hidden="true" /> กำลังโหลด...
        </div>
      )}

      {phase === 'notfound' && (
        <div className={`${card} text-center space-y-3 py-8`}>
          <Search size={32} className="mx-auto text-gray-300" aria-hidden="true" />
          <p className="text-base font-bold text-gray-800">ไม่พบแบบสำรวจนี้</p>
          <p className="text-sm text-gray-500">ลิงก์อาจไม่ครบ หรือแบบสำรวจไม่ได้อยู่ในหน่วยงานนี้</p>
          <Link to="/surveys" className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
            ดูแบบสำรวจทั้งหมด
          </Link>
        </div>
      )}

      {phase === 'error' && (
        <div className={`${card} text-center space-y-3 py-8`}>
          <AlertTriangle size={32} className="mx-auto text-amber-400" aria-hidden="true" />
          <p className="text-sm text-gray-700">โหลดไม่สำเร็จ เครือข่ายอาจช้าหรือขาดช่วง</p>
          <button type="button" onClick={() => load()} className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
            <RefreshCw size={16} aria-hidden="true" /> ลองใหม่
          </button>
        </div>
      )}

      {phase === 'ready' && data && (
        <>
          <section className={card} aria-labelledby="survey-question">
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5 ${open ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                {open ? 'เปิดรับความเห็น' : 'ปิดรับแล้ว'}
              </span>
              <span className="text-xs text-gray-500">
                {open ? `ถึง ${formatSurveyDate(data.closes_at)} · เหลือ ${daysLeft} วัน` : `ปิดเมื่อ ${formatSurveyDate(data.closes_at)}`}
              </span>
            </div>
            <h2 id="survey-question" className="text-lg font-bold text-gray-900 leading-snug break-words">{data.question}</h2>
            <p className="text-xs text-gray-500 mt-2">ตอบแล้ว {data.total} คน</p>
          </section>

          <Notice tone="blue">{SURVEY_NOT_A_VOTE_NOTICE}</Notice>

          {thanks && (
            <Notice><CheckCircle2 size={16} className="inline -mt-0.5 mr-1" aria-hidden="true" />{thanks}</Notice>
          )}

          {data.can_vote && (
            <form className={`${card} space-y-4`} onSubmit={e => { e.preventDefault(); submit() }}>
              <fieldset className="space-y-2">
                <legend className={`${sectionLabel} mb-2`}>เลือก 1 ข้อ</legend>
                {data.options.map(o => (
                  <label key={o.id} htmlFor={`opt-${o.id}`}
                    className={`flex items-center gap-3 min-h-[48px] rounded-xl border-2 px-3 py-2 text-sm text-gray-800 cursor-pointer ${choice === o.id ? 'font-semibold' : 'border-gray-200 bg-white'}`}
                    style={choice === o.id ? { borderColor: 'var(--color-primary)', backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, white)' } : undefined}>
                    <input id={`opt-${o.id}`} type="radio" name="survey-option" value={o.id} checked={choice === o.id}
                      onChange={() => setChoice(o.id)} className="h-5 w-5 shrink-0" style={{ accentColor: 'var(--color-primary)' }} />
                    <span className="min-w-0 break-words">{o.label}</span>
                  </label>
                ))}
              </fieldset>

              {data.allow_comment && (
                <div className="space-y-1">
                  <label htmlFor="survey-comment" className="block text-xs font-semibold text-gray-600">ความเห็นเพิ่มเติม (ไม่บังคับ)</label>
                  <textarea id="survey-comment" rows={3} maxLength={SURVEY_COMMENT_MAX} value={comment} onChange={e => setComment(e.target.value)}
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white resize-none focus:outline-none focus:border-gray-400" />
                  <p className="flex justify-between gap-2 text-[11px] text-gray-500">
                    <span>อย่าใส่ชื่อ เบอร์โทร หรือที่อยู่ ระบบจะซ่อนเบอร์โทร เลขบัตร และอีเมลให้เอง</span>
                    <span className="tabular-nums shrink-0">{comment.length}/{SURVEY_COMMENT_MAX}</span>
                  </p>
                </div>
              )}

              <p className="text-xs text-green-800 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                ระบบบันทึกว่าคุณตอบแล้ว เพื่อไม่ให้ตอบซ้ำ แต่ไม่เชื่อมคำตอบและความเห็นกับบัญชีของคุณ{data.allow_comment ? ' ความเห็นเห็นได้เฉพาะเจ้าหน้าที่ ไม่แสดงต่อสาธารณะ' : ''}
              </p>

              {voteError && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{voteError}</p>}
              <button type="submit" disabled={!choice || sending}
                className="w-full min-h-[48px] rounded-xl text-sm font-bold text-white disabled:opacity-40"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                {sending ? 'กำลังส่ง...' : 'ส่งคำตอบ'}
              </button>
            </form>
          )}

          {!data.can_vote && data.vote_block === 'login_required' && (
            <section className={`${card} space-y-3`} aria-labelledby="survey-login">
              <h2 id="survey-login" className="text-sm font-bold text-gray-800">เข้าสู่ระบบเพื่อตอบแบบสำรวจ</h2>
              <ul className="space-y-1.5" aria-label="ตัวเลือก">
                {data.options.map(o => <li key={o.id} className="text-sm text-gray-700 border border-gray-200 rounded-xl px-3 py-2 break-words">{o.label}</li>)}
              </ul>
              <p className="text-xs text-gray-500">ระบบบันทึกว่าคุณตอบแล้วเพื่อกันตอบซ้ำ แต่ไม่บันทึกว่าคุณเลือกข้อใด ผลจะแสดงให้ดูหลังตอบ</p>
              <Link to="/auth" state={{ from: surveyPath(id) }}
                className="inline-flex w-full items-center justify-center gap-2 min-h-[48px] rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                <LogIn size={16} aria-hidden="true" /> เข้าสู่ระบบ
              </Link>
            </section>
          )}

          {!data.can_vote && data.vote_block === 'other_municipality' && (
            <Notice tone="amber">{SURVEY_VOTE_ERRORS.other_municipality}</Notice>
          )}

          {data.results_visible && (
            <section className={card} aria-labelledby="survey-results">
              <h2 id="survey-results" className={`${sectionLabel} mb-3`}>ผลแบบสำรวจ</h2>
              <SurveyResultBars options={data.options} mineId={mine} />
              {data.total > 0 && data.split && (
                <p className="text-xs text-gray-500 mt-3">
                  ตอบแล้ว {data.total} คน (ประชาชน {data.split.citizen} · ผู้มีตำแหน่ง {data.split.official})
                </p>
              )}
              {open && <p className="text-xs text-gray-500 mt-1">ผลอัปเดตตามจำนวนผู้ตอบ โหลดหน้าใหม่เพื่อดูล่าสุด</p>}
            </section>
          )}

          {!data.results_visible && data.can_vote && (
            <p className="text-xs text-gray-500 text-center px-4">ผลจะแสดงหลังคุณตอบ</p>
          )}

          <section className={`${card} space-y-2`} aria-labelledby="survey-share">
            <h2 id="survey-share" className={sectionLabel}>ชวนคนอื่นร่วมตอบ</h2>
            <SurveyShare surveyId={data.id} />
          </section>

          <p className="text-center text-xs text-gray-400 px-4 pt-2">
            <Link to="/surveys" className="underline">ดูแบบสำรวจทั้งหมด</Link> · <Link to="/" className="underline">กลับหน้าแรก</Link>
          </p>
        </>
      )}
    </SurveyShell>
  )
}
