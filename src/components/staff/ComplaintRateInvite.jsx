import { useRef, useState } from 'react'
import { CheckCircle2, Loader2, Share2, Smile, TriangleAlert, UserRoundPen } from 'lucide-react'
import { Notice } from '../esign/EsignBits'
import { useTenant } from '../../contexts/TenantContext'
import { appUrl } from '../../lib/basename'
import { supabase } from '../../lib/supabase'
import { shareTrackLink, trackPath, trackShareText } from '../../lib/complaintTrack'
import {
  COMMENT_MAX, INVITE_LIST_LIMIT, PROXY_COMMENT_WARNING, RATE_ALREADY_TEXT, RATING_OPTIONS, SHARE_NOTICE_COPIED, SHARE_NOTICE_FAILED, SHARE_NOTICE_SENT,
  canShareRow, cleanComment, inviteErrorMessage, inviteRowLines, inviteRowNote, inviteSummaryText, rateOutcome,
} from '../../lib/complaintRateInvite'

// แถว "เรื่องที่คุณแจ้ง ดำเนินการแล้ว รอประเมิน" ในส่วน "ต้องทำตอนนี้" ของหน้าแรกเจ้าหน้าที่
// ทำไมมี: สท. ยื่นคำร้องแทนชาวบ้านจากบัญชีตัวเอง แต่ล็อกอินแล้วเข้าฝั่งเจ้าหน้าที่ จึงไม่เคยเห็นหน้าต่างชวนประเมินของฝั่งประชาชน
// (นับจากฐานจริงน้ำเลา 2569-11-09: ปิดแล้ว 68 เรื่อง ได้คะแนน 11)
//
// ไม่บังคับ ไม่มี modal บังจอ — งานหลักคือ "ส่งลิงก์ให้ชาวบ้านประเมินเอง" (ปุ่มแรก) ส่วนอีกสองทางเป็นทางสำรอง:
//   บันทึกแทน (เฉพาะ สท. · ชาวบ้านไม่มีมือถือ) → rate_complaint_on_behalf · ประเมินเอง → rate_complaint
// ข้อมูลรายการ + สถานะ "ส่งลิงก์แล้ว" ถูกคัดกรองที่ StaffOperationalDashboard (ต้องนับเข้าตัวเลข "ต้องทำตอนนี้")
// คอมโพเนนต์นี้อยู่ติดจอเสมอเมื่อมีการทำรายการ เพื่อให้ข้อความ "ขอบคุณ/ส่งแล้ว" ยังอยู่หลังแถวสุดท้ายหายไป
export default function ComplaintRateInvite({ rows, canProxy, serverNow, onSent, onRated }) {
  const { tenant } = useTenant()
  const [form, setForm] = useState(null) // { id, mode: 'proxy' | 'self' }
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [thanks, setThanks] = useState([])
  const [manualLink, setManualLink] = useState(null) // { id, url } เมื่อส่ง/คัดลอกอัตโนมัติไม่ได้
  // กดซ้ำระหว่างรอเครือข่ายต้องไม่ยิงสองรอบ — state อัปเดตไม่ทันการกดรัว จึงใช้ ref กันด้วย
  const inFlight = useRef(false)
  // เวลาตอนเปิดหน้า (ไม่เรียก Date.now ตอนเรนเดอร์) — ใช้แค่เป็นค่าสำรองของ server_now ตอนนับวันที่ปิดเรื่อง
  const [nowMs] = useState(() => Date.now())

  if (rows.length === 0 && thanks.length === 0 && !notice) return null

  const shown = rows.slice(0, INVITE_LIST_LIMIT)

  function openForm(id, mode) {
    setForm({ id, mode })
    setSelected(null)
    setComment('')
    setError('')
    setNotice(null)
    setManualLink(null)
  }

  function closeForm() {
    setForm(null)
    setError('')
  }

  // ⚠️ ห้ามมี await ก่อน shareTrackLink: แผ่นแชร์ของ iOS Safari ต้องถูกเรียกในจังหวะที่ผู้ใช้เพิ่งแตะ (ดู TrackLinkCard.jsx)
  // โทเคนมากับรายการแล้วจึงไม่ต้องรอเครือข่ายก่อน
  async function share(row) {
    if (inFlight.current || !canShareRow(row)) return
    inFlight.current = true
    setNotice(null)
    setManualLink(null)
    const url = appUrl(trackPath(row.track_token))
    try {
      const result = await shareTrackLink({
        url,
        title: 'ติดตามเรื่องที่แจ้ง',
        text: trackShareText({ orgName: tenant?.name, refNo: row.ref_no }),
      })
      if (result === 'shared' || result === 'copied') {
        onSent(row.id)
        setNotice({ ok: true, text: result === 'copied' ? SHARE_NOTICE_COPIED : SHARE_NOTICE_SENT })
      } else if (result === 'failed') {
        setManualLink({ id: row.id, url })
        setNotice({ ok: false, text: SHARE_NOTICE_FAILED })
      }
      // 'cancelled' = ผู้ใช้ปิดแผ่นแชร์เอง ไม่ทำอะไร (ยังไม่ถือว่าส่ง)
    } finally {
      inFlight.current = false
    }
  }

  async function submit(row) {
    if (inFlight.current || !selected || !form) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const proxy = form.mode === 'proxy'
      const { data, error: rpcError } = await supabase.rpc(proxy ? 'rate_complaint_on_behalf' : 'rate_complaint', {
        p_complaint_id: row.id,
        p_rating: selected,
        p_comment: cleanComment(comment),
      })
      if (rpcError) throw rpcError
      const outcome = rateOutcome(data)
      if (outcome === 'error') {
        setError(inviteErrorMessage(data?.code))
        return
      }
      // already = มีผู้ประเมินก่อนแล้ว (เช่นชาวบ้านกดผ่านลิงก์ไปแล้ว) แถวจบเหมือนกัน แต่ห้ามขึ้น "ขอบคุณ" ราวกับคะแนนที่กรอกถูกบันทึก
      const title = inviteRowLines(row).title
      setThanks(prev => [...prev, {
        id: row.id,
        text: outcome === 'already' ? `${RATE_ALREADY_TEXT} — เรื่อง ${title}` : `ขอบคุณ — ${proxy ? 'บันทึกคะแนนแทนชาวบ้าน' : 'บันทึกคะแนนของคุณ'}เรื่อง ${title} แล้ว`,
      }])
      setForm(null)
      onRated(row.id)
    } catch (err) {
      console.error('[rate-invite] บันทึกคะแนนไม่สำเร็จ:', err?.message ?? err)
      setError(inviteErrorMessage(null))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <section data-rate-invite aria-label="ชวนประเมินความพึงพอใจ"
      className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Smile size={16} className="text-slate-500" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-800">
          {rows.length > 0 ? inviteSummaryText(rows.length) : 'ประเมินความพึงพอใจ'}
        </h2>
      </div>

      <Notice notice={notice} data-rate-invite-notice />

      {thanks.map(item => (
        <p key={item.id} role="status" data-rate-invite-thanks
          className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-800">
          <CheckCircle2 size={15} className="shrink-0" aria-hidden="true" /> {item.text}
        </p>
      ))}

      {shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map(row => {
            const lines = inviteRowLines(row)
            const note = inviteRowNote(row, { canProxy, serverNow, nowMs })
            const isForm = form?.id === row.id
            const isProxy = isForm && form.mode === 'proxy'
            return (
              <li key={row.id} data-rate-invite-row={row.id} data-follow-up={row.followUp ? 'true' : undefined}
                className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold text-slate-800">{lines.title}</p>
                  {lines.detail && <p className="break-words text-[11px] text-slate-500">{lines.detail}</p>}
                  <p className={`break-words text-[11px] font-semibold ${row.followUp ? 'text-amber-700' : 'text-slate-500'}`}>{note}</p>
                </div>

                {!isForm && (
                  <div className="space-y-2">
                    {canShareRow(row) && (
                      <button type="button" data-rate-invite-share onClick={() => share(row)}
                        className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white"
                        style={{ backgroundColor: 'var(--color-primary)' }}>
                        <Share2 size={16} aria-hidden="true" /> ส่งลิงก์ให้ชาวบ้านประเมิน
                      </button>
                    )}
                    {manualLink?.id === row.id && (
                      <p data-rate-invite-link className="select-all break-all rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-600">{manualLink.url}</p>
                    )}
                    <div className={`grid gap-2 ${canProxy ? 'sm:grid-cols-2' : ''}`}>
                      {canProxy && (
                        <button type="button" data-rate-invite-proxy onClick={() => openForm(row.id, 'proxy')}
                          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border-2 bg-white px-3 text-sm font-bold"
                          style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>
                          <UserRoundPen size={16} aria-hidden="true" /> ชาวบ้านไม่มีมือถือ — บันทึกแทน
                        </button>
                      )}
                      <button type="button" data-rate-invite-self onClick={() => openForm(row.id, 'self')}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700">
                        ฉันประเมินเอง
                      </button>
                    </div>
                  </div>
                )}

                {isForm && (
                  <div data-rate-invite-form={form.mode} className="space-y-2">
                    {isProxy ? (
                      <p role="note" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-900">
                        <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
                        เลือกตามที่ชาวบ้านตอบ ไม่ใช่ความเห็นของคุณ — ระบบบันทึกว่าคุณเป็นผู้บันทึกแทน
                      </p>
                    ) : (
                      <p className="text-xs font-semibold text-slate-600">คุณพึงพอใจกับการดำเนินการเรื่องนี้แค่ไหน</p>
                    )}
                    <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="ระดับความพึงพอใจ">
                      {RATING_OPTIONS.map(option => {
                        const on = selected === option.value
                        return (
                          <button key={option.value} type="button" data-rate-invite-score={option.value} aria-pressed={on}
                            onClick={() => setSelected(option.value)} disabled={busy}
                            className="flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-0.5 py-1 active:scale-[0.97] disabled:opacity-60"
                            style={{ backgroundColor: on ? option.bg : '#f9fafb', borderColor: on ? option.border : '#e5e7eb' }}>
                            <span className="text-2xl leading-none" aria-hidden="true">{option.emoji}</span>
                            <span className="text-[11px] font-semibold leading-tight" style={{ color: on ? option.color : '#374151' }}>{option.label}</span>
                          </button>
                        )
                      })}
                    </div>
                    {selected && (
                      <textarea value={comment} onChange={event => setComment(event.target.value)} rows={2} maxLength={COMMENT_MAX}
                        aria-label="ความเห็นเพิ่มเติม (ไม่บังคับ)" placeholder={isProxy ? `ความเห็นของชาวบ้าน (ไม่บังคับ) · ${PROXY_COMMENT_WARNING}` : "ความเห็นเพิ่มเติม (ไม่บังคับ)"}
                        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-200" />
                    )}
                    {isProxy && selected && <p data-rate-invite-comment-warning className="text-[11px] font-semibold text-amber-800">{PROXY_COMMENT_WARNING}</p>}
                    {error && <p role="alert" data-rate-invite-error className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
                    <div className="flex gap-2">
                      <button type="button" data-rate-invite-submit disabled={!selected || busy} onClick={() => submit(row)}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-40"
                        style={{ backgroundColor: 'var(--color-primary)' }}>
                        {busy ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> กำลังบันทึก…</> : 'บันทึกคะแนน'}
                      </button>
                      <button type="button" onClick={closeForm} disabled={busy}
                        className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-600 disabled:opacity-50">
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {rows.length > shown.length && (
        <p data-rate-invite-more className="text-[11px] text-slate-500">
          แสดง {shown.length} จาก {rows.length} เรื่อง · ทำเรื่องข้างบนเสร็จแล้วเรื่องถัดไปจะขึ้นมา
        </p>
      )}
    </section>
  )
}
