import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, ClipboardList, Loader2, MessageSquare, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { supabase } from '../../lib/supabase'
import SurveyResultBars from '../survey/SurveyResultBars'
import SurveyShare from '../survey/SurveyShare'
import {
  SURVEY_BUSY_MESSAGE, SURVEY_DAY_CHOICES, SURVEY_DEFAULT_DAYS, SURVEY_MANAGE_ERRORS, SURVEY_NOT_A_VOTE_NOTICE,
  SURVEY_OPTIONS_MAX, SURVEY_OPTIONS_MIN, SURVEY_OPTION_MAX, SURVEY_QUESTION_MAX, SURVEY_TEMPLATES,
  formatSurveyDate, isSurveyBusy, surveyClosesAt, surveyDaysLeft, surveyDeleteWarning, validateSurveyDraft,
} from '../../lib/survey'

// แท็บ "แบบสำรวจ" ในเมนูข่าวสาร/ภาพกิจกรรม — สร้าง ดูผล เปิด-ปิดช่องความเห็น ปิดก่อนกำหนด ลบความเห็น
// กติกาและสิทธิ์ตัดสินที่ฐานข้อมูล (survey_can_manage: superadmin + admin/officer/staff ของ อปท. นั้น) หน้านี้แค่แสดงผลที่ได้
// ลบทั้งแบบสำรวจ (ผลโหวต+ความเห็นหายหมด กู้คืนไม่ได้): เฉพาะผู้ดูแล (survey_can_delete) — ปุ่มอยู่ท้ายหน้ารายละเอียด มีขั้นยืนยันบอกจำนวนผู้ตอบ
// งานของเจ้าหน้าที่มีแค่ "สร้าง" (พิมพ์คำถาม เลือกวัน กดเผยแพร่) — นับคะแนน ปิดเมื่อครบกำหนด ลบความเห็นเก่า ระบบทำเอง
// ความเห็นไม่มีชื่อ/เวลา/บัญชีผู้พิมพ์ — ปุ่มลบมีไว้ให้เอาข้อความที่ไม่เหมาะสมออก (ยอดโหวตไม่เปลี่ยน)

const box = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-4'
const label = 'block text-xs font-semibold text-gray-600 mb-1'
const input = 'w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:border-gray-400'

function StatusChip({ status }) {
  return (
    <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${status === 'open' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
      {status === 'open' ? 'เปิดรับความเห็น' : 'ปิดรับแล้ว'}
    </span>
  )
}

function errorText(error, res, fallback) {
  if (error) return isSurveyBusy(error) ? SURVEY_BUSY_MESSAGE : fallback
  return SURVEY_MANAGE_ERRORS[res?.code] ?? fallback
}

// ───────────────────────────── ฟอร์มสร้าง ─────────────────────────────
function SurveyForm({ tenantId, onCancel, onCreated }) {
  const [templateKey, setTemplateKey] = useState('priority')
  const first = SURVEY_TEMPLATES[0]
  const [question, setQuestion] = useState(first.question)
  const [options, setOptions] = useState(first.options)
  const [days, setDays] = useState(SURVEY_DEFAULT_DAYS)
  const [allowComment, setAllowComment] = useState(true)
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [saving, setSaving] = useState(false)

  function pickTemplate(t) {
    setTemplateKey(t.key)
    setQuestion(t.question)
    setOptions(t.options)
    setErrors({}); setServerError('')
  }
  // แก้ช่องไหนก็เอาข้อความผิดพลาดของช่องนั้นออก (ไม่ให้ค้างทั้งที่พิมพ์ใหม่ถูกแล้ว)
  const clearError = key => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))
  const setOption = (i, v) => { setOptions(prev => prev.map((o, idx) => (idx === i ? v : o))); clearError('options') }

  async function publish() {
    const check = validateSurveyDraft({ question, options })
    if (!check.ok) { setErrors(check.errors); return }
    setErrors({}); setServerError(''); setSaving(true)
    const { data, error } = await supabase.rpc('create_survey', {
      _municipality_id: tenantId,
      p_question: check.clean.question,
      p_options: check.clean.options,
      p_allow_comment: allowComment,
      // ค่าเริ่มต้นให้ฐานข้อมูลคิดเวลาเอง (ไม่พึ่งนาฬิกาเครื่องผู้ใช้) เลือกวันอื่นค่อยคำนวณจากเครื่อง
      p_closes_at: days === SURVEY_DEFAULT_DAYS ? null : surveyClosesAt(days),
    })
    setSaving(false)
    if (error || !data?.ok) { setServerError(errorText(error, data, 'สร้างแบบสำรวจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')); return }
    onCreated(data.id)
  }

  return (
    <div className={`${box} space-y-4`}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} className="p-2 -ml-2 rounded-xl hover:bg-gray-100" aria-label="กลับ"><ArrowLeft size={18} /></button>
        <h3 className="font-bold text-gray-800">สร้างแบบสำรวจ</h3>
      </div>

      <div>
        <p className={label}>แม่แบบ</p>
        <div className="flex flex-wrap gap-2">
          {SURVEY_TEMPLATES.map(t => (
            <button key={t.key} type="button" onClick={() => pickTemplate(t)}
              className={`min-h-[40px] px-3 rounded-full text-xs font-semibold ${templateKey === t.key ? 'text-white' : 'bg-gray-100 text-gray-600'}`}
              style={templateKey === t.key ? { backgroundColor: 'var(--color-primary)' } : undefined}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="survey-q" className={label}>คำถาม</label>
        <textarea id="survey-q" rows={2} maxLength={SURVEY_QUESTION_MAX} value={question} onChange={e => { setQuestion(e.target.value); clearError('question') }} className={`${input} resize-none`} />
        {errors.question && <p role="alert" className="text-xs text-red-600 mt-1">{errors.question}</p>}
      </div>

      <div>
        <p className={label}>ตัวเลือก ({SURVEY_OPTIONS_MIN}–{SURVEY_OPTIONS_MAX} ข้อ)</p>
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input id={`survey-o-${i}`} aria-label={`ตัวเลือกที่ ${i + 1}`} maxLength={SURVEY_OPTION_MAX} value={o} onChange={e => setOption(i, e.target.value)} className={input} />
              {options.length > SURVEY_OPTIONS_MIN && (
                <button type="button" onClick={() => { setOptions(prev => prev.filter((_, idx) => idx !== i)); clearError('options') }}
                  className="shrink-0 p-2 rounded-xl text-gray-400 hover:bg-gray-100" aria-label={`ลบตัวเลือกที่ ${i + 1}`}><X size={16} /></button>
              )}
            </div>
          ))}
        </div>
        {options.length < SURVEY_OPTIONS_MAX && (
          <button type="button" onClick={() => { setOptions(prev => [...prev, '']); clearError('options') }}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
            <Plus size={14} /> เพิ่มตัวเลือก
          </button>
        )}
        {errors.options && <p role="alert" className="text-xs text-red-600 mt-1">{errors.options}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="survey-days" className={label}>เปิดรับความเห็น</label>
          <select id="survey-days" value={days} onChange={e => setDays(Number(e.target.value))} className={input}>
            {SURVEY_DAY_CHOICES.map(d => <option key={d} value={d}>{d} วัน (ถึง {formatSurveyDate(surveyClosesAt(d))})</option>)}
          </select>
        </div>
        <label htmlFor="survey-allow-comment" className="flex items-start gap-2 text-sm text-gray-700 min-h-[44px] pt-5">
          <input id="survey-allow-comment" type="checkbox" checked={allowComment} onChange={e => setAllowComment(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: 'var(--color-primary)' }} />
          <span>เปิดช่องให้พิมพ์ความเห็นเพิ่มเติม <span className="text-xs text-gray-500">(เห็นเฉพาะเจ้าหน้าที่)</span></span>
        </label>
      </div>

      <p className="text-xs text-blue-900 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
        ประชาชนจะเห็นป้าย "{SURVEY_NOT_A_VOTE_NOTICE}" ทุกหน้า · เผยแพร่แล้วแก้คำถามไม่ได้ แต่ปิดก่อนกำหนดได้ · ทุกการเผยแพร่และปิดมีประวัติ
      </p>
      {serverError && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{serverError}</p>}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button type="button" onClick={publish} disabled={saving}
          className="min-h-[48px] rounded-xl text-sm font-bold text-white disabled:opacity-40" style={{ backgroundColor: 'var(--color-primary)' }}>
          {saving ? 'กำลังเผยแพร่...' : 'เผยแพร่'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="min-h-[48px] px-4 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600">ยกเลิก</button>
      </div>
    </div>
  )
}

// ───────────────────────────── รายละเอียด/ผล ─────────────────────────────
function SurveyDetail({ surveyId, justCreated, canDelete, onBack, onDeleted }) {
  const [phase, setPhase] = useState('loading') // loading | ready | notfound | error
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState('') // '' | 'close' | 'delete' | <ballot id>
  const [actionError, setActionError] = useState('')
  const [deleteError, setDeleteError] = useState('') // แยกจาก actionError: ปุ่มลบอยู่ท้ายหน้า ข้อความที่ด้านบนจะพ้นจอมือถือ

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setPhase('loading')
    const { data: res, error } = await supabase.rpc('get_survey_staff', { _survey_id: surveyId })
    if (error) { setPhase('error'); return }
    if (!res?.found) { setPhase('notfound'); return }
    setData(res)
    setPhase('ready')
  }, [surveyId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดผลครั้งแรกตอนเปิดหน้า (async ภายใน load)
    load()
  }, [load])

  async function run(name, rpc, args) {
    setBusy(name); setActionError('')
    const { data: res, error } = await supabase.rpc(rpc, args)
    setBusy(''); setConfirm('')
    if (error || !res?.ok) { setActionError(errorText(error, res, 'ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')); if (res?.code === 'not_open') await load(true); return }
    await load(true)
  }

  // ลบสำเร็จ = แบบสำรวจไม่มีแล้ว ห้าม load ซ้ำ (จะเจอ notfound) — กลับหน้ารายการแทน
  async function remove() {
    setBusy('delete'); setDeleteError('')
    const { data: res, error } = await supabase.rpc('delete_survey', { _survey_id: surveyId })
    setBusy(''); setConfirm('')
    if (error || !res?.ok) {
      setDeleteError(errorText(error, res, 'ลบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'))
      if (res?.code === 'not_found') await load(true)
      return
    }
    onDeleted()
  }

  const open = data?.status === 'open'
  const labelOf = id => data?.options.find(o => o.id === id)?.label ?? ''

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-gray-600 min-h-[44px]"><ArrowLeft size={16} /> รายการแบบสำรวจ</button>

      {phase === 'loading' && <div className={`${box} flex items-center justify-center gap-2 py-8 text-sm text-gray-500`} role="status"><Loader2 size={16} className="animate-spin" /> กำลังโหลด...</div>}
      {(phase === 'error' || phase === 'notfound') && (
        <div className={`${box} text-center space-y-2 py-6`}>
          <AlertCircle size={28} className="mx-auto text-amber-400" />
          <p className="text-sm text-gray-700">{phase === 'notfound' ? 'ไม่พบแบบสำรวจนี้ หรือบัญชีนี้ไม่มีสิทธิ์ดู' : 'โหลดไม่สำเร็จ'}</p>
          {phase === 'error' && <button type="button" onClick={() => load()} className="inline-flex items-center gap-1 text-sm font-semibold underline"><RefreshCw size={14} /> ลองใหม่</button>}
        </div>
      )}

      {phase === 'ready' && data && (
        <>
          {justCreated && (
            <p role="status" className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              <CheckCircle2 size={16} className="inline -mt-0.5 mr-1" />เผยแพร่แล้ว ประชาชนเห็นการ์ดบนหน้าแรก ส่งลิงก์ต่อทาง LINE ได้ด้านล่าง
            </p>
          )}
          <section className={box}>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <StatusChip status={data.status} />
              <span className="text-xs text-gray-500">
                {open ? `ปิดรับ ${formatSurveyDate(data.closes_at)} · เหลือ ${surveyDaysLeft(data.closes_at)} วัน` : `ปิดเมื่อ ${formatSurveyDate(data.closes_at)}`}
              </span>
            </div>
            <h3 className="text-base font-bold text-gray-900 break-words">{data.question}</h3>
            <p className="text-xs text-gray-500 mt-1">
              ตอบแล้ว {data.split.total} คน (ประชาชน {data.split.citizen} · ผู้มีตำแหน่ง {data.split.official})
            </p>
          </section>

          <section className={box} aria-label="ผลรายตัวเลือก">
            <SurveyResultBars options={data.options} />
          </section>

          {open && (
            <section className={`${box} space-y-3`} aria-label="จัดการ">
              <label htmlFor="survey-toggle-comment" className="flex items-start gap-2 text-sm text-gray-700 min-h-[44px]">
                <input id="survey-toggle-comment" type="checkbox" checked={data.allow_comment} disabled={busy === 'comment'}
                  onChange={e => {
                    // เปลี่ยนที่หน้าจอทันที (ไม่รอเครือข่าย) — ถ้าฐานข้อมูลปฏิเสธ run() โหลดค่าจริงกลับมาทับ
                    const next = e.target.checked
                    setData(d => ({ ...d, allow_comment: next }))
                    run('comment', 'set_survey_comment_enabled', { _survey_id: surveyId, p_enabled: next })
                  }}
                  className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: 'var(--color-primary)' }} />
                <span>ช่องความเห็น <span className="text-xs text-gray-500">{data.allow_comment ? 'เปิดอยู่ ติ๊กออกเพื่อหยุดรับความเห็นใหม่ ความเห็นเดิมยังอยู่' : 'ปิดอยู่ ประชาชนไม่เห็นกล่องพิมพ์'}</span></span>
              </label>
              {confirm === 'close' ? (
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <button type="button" disabled={busy === 'close'} onClick={() => run('close', 'close_survey_early', { _survey_id: surveyId })}
                    className="min-h-[44px] rounded-xl text-sm font-bold text-white bg-red-600 disabled:opacity-40">{busy === 'close' ? 'กำลังปิด...' : 'ยืนยันปิดตอนนี้'}</button>
                  <button type="button" onClick={() => setConfirm('')} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600">ยกเลิก</button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirm('close')} className="min-h-[44px] w-full rounded-xl text-sm font-bold border-2 border-red-200 text-red-700 bg-red-50">ปิดแบบสำรวจตอนนี้</button>
              )}
              <SurveyShare surveyId={surveyId} />
            </section>
          )}
          {!open && <section className={`${box} space-y-2`}><p className="text-xs font-semibold text-gray-500">ลิงก์ผลแบบสำรวจ</p><SurveyShare surveyId={surveyId} /></section>}

          {actionError && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{actionError}</p>}

          <section className={box} aria-label="ความเห็น">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare size={16} className="text-gray-400" />
              <h4 className="text-sm font-bold text-gray-800">ความเห็นที่พิมพ์ ({data.comments.length})</h4>
            </div>
            {data.comments.length === 0 ? (
              <p className="text-sm text-gray-500">{data.allow_comment || data.comments.length ? 'ยังไม่มีความเห็น' : 'ปิดช่องความเห็นไว้'}</p>
            ) : (
              <ul className="space-y-2">
                {data.comments.map(c => (
                  <li key={c.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[11px] font-semibold rounded-full bg-white border border-gray-200 text-gray-600 px-2 py-0.5 break-words">{labelOf(c.option_id)}</span>
                      {confirm === c.id ? (
                        <span className="flex items-center gap-1 shrink-0">
                          <button type="button" disabled={busy === c.id} onClick={() => run(c.id, 'delete_survey_comment', { _ballot_id: c.id })}
                            className="min-h-[36px] px-3 rounded-lg text-xs font-bold text-white bg-red-600 disabled:opacity-40">ลบ</button>
                          <button type="button" onClick={() => setConfirm('')} className="min-h-[36px] px-3 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-gray-600">ไม่ลบ</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirm(c.id)} className="shrink-0 min-h-[36px] px-2 inline-flex items-center gap-1 text-xs font-semibold text-red-700" aria-label="ลบความเห็นนี้"><Trash2 size={14} /> ลบ</button>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{c.text}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-500 mt-3">
              ไม่มีชื่อ เวลา หรือบัญชีผู้พิมพ์ และเรียงสุ่ม ระบบซ่อนเบอร์โทร เลขบัตร และอีเมลให้ก่อนบันทึก
              · ระบบลบความเห็นทิ้งเอง {data.comment_keep_days} วันหลังปิดแบบสำรวจ เหลือแต่ยอดรวม
            </p>
          </section>

          {canDelete && (
            <section className={`${box} space-y-3`} aria-label="ลบแบบสำรวจ" data-survey-delete>
              {confirm === 'delete' ? (
                <>
                  <p role="alert" data-survey-delete-warning className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-3 py-2 break-words">
                    {surveyDeleteWarning({ open, total: data.split.total, comments: data.comments.length })}
                  </p>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <button type="button" disabled={busy === 'delete'} onClick={remove}
                      className="min-h-[44px] rounded-xl text-sm font-bold text-white bg-red-600 disabled:opacity-40">{busy === 'delete' ? 'กำลังลบ...' : 'ยืนยันลบถาวร'}</button>
                    <button type="button" disabled={busy === 'delete'} onClick={() => setConfirm('')} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600">ยกเลิก</button>
                  </div>
                </>
              ) : (
                <button type="button" onClick={() => { setDeleteError(''); setConfirm('delete') }}
                  className="min-h-[44px] w-full inline-flex items-center justify-center gap-1.5 rounded-xl text-sm font-bold border-2 border-red-200 text-red-700 bg-red-50"><Trash2 size={16} /> ลบแบบสำรวจนี้</button>
              )}
              {deleteError && <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{deleteError}</p>}
              <p className="text-xs text-gray-500">เฉพาะผู้ดูแลระบบลบได้ · ระบบบันทึกประวัติว่าใครลบเรื่องไหน มีผู้ตอบกี่คน (ไม่เก็บเนื้อความเห็น)</p>
            </section>
          )}
        </>
      )}
    </div>
  )
}

// ───────────────────────────── รายการ ─────────────────────────────
function SurveyList({ tenantId, notice, onOpen, onCreate }) {
  const [phase, setPhase] = useState('loading') // loading | ready | error
  const [items, setItems] = useState([])

  const load = useCallback(async () => {
    setPhase('loading')
    const { data, error } = await supabase.rpc('list_surveys_manage', { _municipality_id: tenantId })
    if (error) { setPhase('error'); return }
    setItems(Array.isArray(data) ? data : [])
    setPhase('ready')
  }, [tenantId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดรายการครั้งแรกตอนเปิดแท็บ (async ภายใน load)
    load()
  }, [load])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-gray-500 flex-1 min-w-0">ถามความเห็นประชาชนข้อเดียว ประชาชนตอบจากมือถือ เห็นผลทันทีหลังตอบ · {SURVEY_NOT_A_VOTE_NOTICE}</p>
        <button type="button" onClick={onCreate} className="shrink-0 flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: 'var(--color-primary)' }}>
          <Plus size={14} /> สร้างแบบสำรวจ
        </button>
      </div>

      {notice && <p role="status" data-survey-notice className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"><CheckCircle2 size={16} className="inline -mt-0.5 mr-1" />{notice}</p>}
      {phase === 'loading' && <div className={`${box} flex items-center justify-center gap-2 py-8 text-sm text-gray-500`} role="status"><Loader2 size={16} className="animate-spin" /> กำลังโหลด...</div>}
      {phase === 'error' && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <AlertCircle size={15} className="shrink-0 mt-0.5" /> โหลดรายการไม่สำเร็จ
          <button type="button" onClick={load} className="ml-auto text-xs underline shrink-0">ลองใหม่</button>
        </div>
      )}
      {phase === 'ready' && items.length === 0 && (
        <div className={`${box} text-center py-8 space-y-1`}>
          <ClipboardList size={28} className="mx-auto text-gray-300" />
          <p className="text-sm font-bold text-gray-800">ยังไม่มีแบบสำรวจ</p>
          <p className="text-xs text-gray-500">กด "สร้างแบบสำรวจ" เลือกแม่แบบ แล้วเผยแพร่ได้ในไม่กี่คลิก</p>
        </div>
      )}
      {phase === 'ready' && items.length > 0 && (
        <ul className="space-y-2">
          {items.map(s => (
            <li key={s.id}>
              <button type="button" onClick={() => onOpen(s.id)} className={`${box} w-full text-left hover:bg-gray-50`}>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <StatusChip status={s.status} />
                  <span className="text-xs text-gray-500">{s.status === 'open' ? `ปิดรับ ${formatSurveyDate(s.closes_at)}` : `ปิดเมื่อ ${formatSurveyDate(s.closes_at)}`}</span>
                </div>
                <p className="text-sm font-bold text-gray-900 break-words">{s.question}</p>
                <p className="text-xs text-gray-500 mt-1">ตอบแล้ว {s.total} คน · ความเห็น {s.comment_count} รายการ</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function SurveyManager({ canDelete = false }) {
  const { tenant } = useTenant()
  const tenantId = tenant?.id ?? null
  const [view, setView] = useState({ name: 'list' }) // list (+ notice หลังลบ) | create | detail

  if (!tenantId) return null
  if (view.name === 'create') {
    return <SurveyForm tenantId={tenantId} onCancel={() => setView({ name: 'list' })} onCreated={id => setView({ name: 'detail', id, justCreated: true })} />
  }
  if (view.name === 'detail') {
    return (
      <SurveyDetail key={view.id} surveyId={view.id} justCreated={Boolean(view.justCreated)} canDelete={canDelete}
        onBack={() => setView({ name: 'list' })} onDeleted={() => setView({ name: 'list', notice: 'ลบแบบสำรวจแล้ว' })} />
    )
  }
  return <SurveyList tenantId={tenantId} notice={view.notice} onOpen={id => setView({ name: 'detail', id })} onCreate={() => setView({ name: 'create' })} />
}
