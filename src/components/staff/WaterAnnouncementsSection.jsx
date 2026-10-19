import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Megaphone } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useVisibleRefresh } from '../../hooks/useVisibleRefresh'
import { clearHomeRpcCache } from '../../lib/staffHomeData'
import { thaiDateTime } from '../../lib/waterEvents'
import {
  DEFAULT_EXPIRY_HOURS, DRAFT_LIFE_HOURS, actionFailureText, describeRpcError, draftCanApprove, draftDeadline,
  historyLine, isActive, isQuietListError, remainingText,
} from '../../lib/waterAnnouncements'
import WaterAnnouncementApprovers from './WaterAnnouncementApprovers'

// ส่วน "ประกาศน้ำ-ฝนของหน่วยงาน" บนหน้า "เหตุการณ์น้ำ-ฝน" ของเจ้าหน้าที่ (เฟส 2 · PR 2.2)
//
// ระบบร่างข้อความจากค่าที่วัดได้ → ผู้มีสิทธิ์ยืนยัน (ที่ admin ของหน่วยงานตั้งไว้) กดยืนยันครั้งเดียว → ขึ้นหน้าประชาชน
// ไม่มีคนกดยืนยัน = ไม่มีอะไรออก ระบบไม่ประกาศแทน ไม่สั่งอพยพ ไม่ประเมินความเสียหาย (ดุลพินิจของผู้บริหารท้องถิ่น)
//
// กติกาของหน้านี้ (เทสต์ tests/water-announcements-ui.playwright.mjs ล็อกไว้):
//  - อปท. ที่ไม่ได้เปิดประกาศ → ไม่เรียก/ไม่แสดงอะไรเลย (หน้าเดิมไม่เปลี่ยน) · ตอบ 42501/ฟังก์ชันไม่พร้อม = ซ่อนเงียบๆ
//  - เจ้าหน้าที่ทั่วไป = อ่านอย่างเดียว ไม่มีปุ่มตัดสิน (ไม่เพิ่มงาน) · ปุ่มตัดสินมีเฉพาะผู้มีสิทธิ์ยืนยัน และเฉพาะตอนมีร่าง/มีฉบับที่เผยแพร่อยู่
//  - เผยแพร่ต้องกดยืนยันซ้ำอีกขั้น (ผลถึงประชาชนทันที) · ร่างเก่าเกิน 3 ชม. ซ่อนปุ่ม (ค่าที่วัดไม่สดแล้ว)
//  - ช่องกรอก/ตัวเลือกมีเฉพาะในกล่องตั้งค่าผู้มีสิทธิ์ยืนยัน (admin เท่านั้น) — ปุ่มทุกปุ่มติดป้าย data-wa-action
//  - ข้อความประกาศแสดงตามที่ระบบร่างทุกตัวอักษร แก้ไม่ได้ (ฐานข้อมูลล็อกไว้)

const REFRESH_MS = 2 * 60 * 1000

const btnBase = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50'
const BTN = {
  primary: `${btnBase} bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-300`,
  secondary: `${btnBase} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus-visible:ring-blue-300`,
  danger: `${btnBase} border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-300`,
}

function Notice({ notice }) {
  if (!notice) return null
  const tone = {
    ok: { Icon: CheckCircle2, cls: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
    warn: { Icon: Info, cls: 'border-amber-300 bg-amber-50 text-amber-900' },
    error: { Icon: AlertTriangle, cls: 'border-rose-200 bg-rose-50 text-rose-800' },
  }[notice.tone]
  return (
    <p data-wa-notice={notice.tone} role="status" className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${tone.cls}`}>
      <tone.Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{notice.text}</span>
    </p>
  )
}

function BodyBox({ body }) {
  return <p data-wa-body className="whitespace-pre-line rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm leading-relaxed text-gray-900">{body}</p>
}

export default function WaterAnnouncementsSection({ tenantId }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null, loadedAt: 0 })
  const [deviceNow, setDeviceNow] = useState(Date.now)
  const [busy, setBusy] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [notice, setNotice] = useState(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback((silent = false) => {
    if (!tenantId) return Promise.resolve()
    return supabase.rpc('list_water_announcements', { _municipality_id: tenantId }).then(({ data, error }) => {
      if (!alive.current) return
      if (error || !data) {
        // รีเฟรชเบื้องหลังพลาด = คงค่าเดิม (ตัวเลข/สถานะเก่ายังดีกว่าหน้าว่าง) · ครั้งแรกพลาด = แสดงตามชนิด error
        setState(prev => (silent && prev.status === 'ok' ? prev : { status: 'error', data: null, error: error ?? new Error('empty'), loadedAt: 0 }))
        return
      }
      setState({ status: 'ok', data, error: null, loadedAt: Date.now() })
      setDeviceNow(Date.now())
    })
  }, [tenantId])

  useEffect(() => { queueMicrotask(() => load(false)) }, [load])
  // เวลาที่ใช้คำนวณ "เหลืออีก…/ยืนยันได้ถึง…" เดินต่อทุก 30 วิ (ฐาน = เวลาของฐานข้อมูลตอนโหลด ไม่ใช่นาฬิกาเครื่อง)
  useEffect(() => {
    const timer = setInterval(() => setDeviceNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const enabled = state.status === 'ok' && state.data?.enabled === true
  useVisibleRefresh(() => load(true), { intervalMs: REFRESH_MS, enabled })

  const run = useCallback(async (kind, fn) => {
    setBusy(kind); setNotice(null)
    try {
      const { data, error } = await fn()
      if (!alive.current) return
      if (error) setNotice({ tone: 'error', text: describeRpcError(error) })
      else if (data?.ok === false) setNotice({ tone: 'warn', text: actionFailureText(data.reason) })
      else return data
    } catch (error) {
      if (alive.current) setNotice({ tone: 'error', text: describeRpcError(error) })
    } finally {
      if (alive.current) { setBusy(null); setConfirming(null) }
    }
    return null
  }, [])

  if (state.status === 'loading') return null
  if (state.status === 'error') {
    // ส่วนนี้ไม่ควรโผล่ข้อความผิดพลาดให้ อปท. ที่ไม่ได้ใช้ประกาศ — ไม่มีสิทธิ์/ฟังก์ชันยังไม่พร้อม = ซ่อนเงียบๆ
    if (isQuietListError(state.error)) return null
    return (
      <p data-wa-error role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
        โหลดส่วนประกาศน้ำ-ฝนไม่สำเร็จ — ส่วนอื่นของหน้านี้ยังใช้ได้ตามปกติ (ปิดแล้วเปิดหน้านี้ใหม่เพื่อลองอีกครั้ง)
      </p>
    )
  }
  const data = state.data
  if (data.enabled !== true) return null

  // เวลาตอนนี้ = เวลาของฐานข้อมูลตอนโหลด + เวลาที่ผ่านไปบนเครื่อง
  const serverMs = Date.parse(data.now)
  const now = (Number.isNaN(serverMs) ? state.loadedAt : serverMs) + Math.max(0, deviceNow - state.loadedAt)
  const canApprove = data.can_approve === true
  const current = data.current && isActive(data.current, now) ? data.current : null
  const pending = data.pending ?? null
  const draftFresh = pending ? draftCanApprove(pending.drafted_at, now) : false
  const hours = Number(data.default_expiry_hours) || DEFAULT_EXPIRY_HOURS
  const history = Array.isArray(data.history) ? data.history : []
  const noApprovers = Number(data.approvers_count) === 0
  const afterAction = (tone, text) => { setNotice({ tone, text }); return load(true) }
  // งานที่ขึ้นบนหน้าแรก (ต้องทำตอนนี้) เปลี่ยนไปแล้ว — ล้างแคช 30 วิของหน้าแรกไม่ให้แถวเก่าค้าง
  const refreshHome = () => clearHomeRpcCache('water_announcement_todo')

  const approve = async () => {
    const result = await run('approve', () => supabase.rpc('approve_water_announcement', { _announcement_id: pending.id }))
    refreshHome()
    if (result) await afterAction('ok', `เผยแพร่ประกาศแล้ว — ประชาชนเห็นได้ทันที ใช้ได้ถึง ${thaiDateTime(result.expires_at)}`)
    else await load(true)
  }
  const decline = async () => {
    const result = await run('decline', () => supabase.rpc('decline_water_announcement', { _announcement_id: pending.id }))
    refreshHome()
    if (result) await afterAction('ok', 'บันทึกว่าไม่ประกาศแล้ว — ระบบจะไม่ร่างเรื่องเดิมซ้ำภายใน 12 ชั่วโมง')
    else await load(true)
  }
  const cancel = async () => {
    const result = await run('cancel', () => supabase.rpc('cancel_water_announcement', { _announcement_id: current.id }))
    refreshHome()
    if (result) await afterAction('ok', 'ยกเลิกประกาศแล้ว — ประชาชนไม่เห็นประกาศนี้อีก')
    else await load(true)
  }

  return (
    <section data-wa-section data-wa-can-approve={canApprove ? 'true' : 'false'} aria-label="ประกาศน้ำ-ฝนของหน่วยงาน" className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
          <Megaphone size={18} className="text-amber-600" aria-hidden="true" />ประกาศน้ำ-ฝนของหน่วยงาน
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
          ระบบร่างข้อความจากค่าที่วัดได้ ผู้มีสิทธิ์ยืนยันเป็นผู้เผยแพร่ — ไม่มีคนกดยืนยัน ประชาชนจะไม่เห็นอะไร ระบบไม่ประกาศแทน ไม่สั่งอพยพ ไม่ประเมินความเสียหาย
        </p>
      </div>

      <Notice notice={notice} />

      {noApprovers && (
        <p data-wa-no-approvers className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            ยังไม่ได้ตั้งผู้มีสิทธิ์ยืนยันประกาศ — ระบบจะร่างข้อความไว้ แต่ไม่มีใครกดยืนยันได้ ประชาชนจึงไม่เห็นประกาศ
            {data.can_manage_approvers ? ' · ตั้งได้ที่ด้านล่างของส่วนนี้' : ' · แจ้งผู้ดูแลระบบของหน่วยงาน'}
          </span>
        </p>
      )}
      {canApprove && (
        <p data-wa-you-approve className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
          <CheckCircle2 size={14} aria-hidden="true" />คุณเป็นผู้มีสิทธิ์ยืนยันประกาศของหน่วยงานนี้
        </p>
      )}

      {current && (
        <article data-wa-current className="space-y-2 rounded-2xl border-2 border-amber-300 bg-white p-3 shadow-sm">
          <p className="text-sm font-bold text-gray-900">ประกาศที่เผยแพร่อยู่ตอนนี้ <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">ประชาชนเห็นอยู่</span></p>
          <BodyBox body={current.body} />
          <p className="text-xs text-gray-600">
            เผยแพร่ {thaiDateTime(current.published_at)} · ใช้ได้ถึง {thaiDateTime(current.expires_at)} ({remainingText(current.expires_at, now)})
          </p>
          {canApprove && (confirming === 'cancel'
            ? (
              <div data-wa-confirm="cancel" className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
                <p className="text-sm font-semibold text-rose-900">ยกเลิกประกาศนี้? ประชาชนจะไม่เห็นประกาศนี้ทันที</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" data-wa-action="cancel-confirm" disabled={busy !== null} onClick={cancel} className={BTN.danger}>ยกเลิกประกาศ</button>
                  <button type="button" data-wa-action="cancel-back" disabled={busy !== null} onClick={() => setConfirming(null)} className={BTN.secondary}>ยังไม่ยกเลิก</button>
                </div>
              </div>
            )
            : <button type="button" data-wa-action="cancel" disabled={busy !== null} onClick={() => { setNotice(null); setConfirming('cancel') }} className={BTN.danger}>ยกเลิกประกาศนี้</button>)}
        </article>
      )}

      {pending && (
        <article data-wa-pending className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
          <p className="text-sm font-bold text-gray-900">
            {current ? 'ร่างฉบับต่ออายุ — รอผู้มีสิทธิ์ยืนยัน' : 'ร่างประกาศรอผู้มีสิทธิ์ยืนยัน'}
            <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">ยังไม่ขึ้นหน้าประชาชน</span>
          </p>
          <BodyBox body={pending.body} />
          <p className="text-xs text-gray-600">
            ร่างเมื่อ {thaiDateTime(pending.drafted_at)}
            {draftFresh ? ` · ยืนยันได้ถึง ${thaiDateTime(draftDeadline(pending.drafted_at))}` : ''}
          </p>
          {!draftFresh && (
            <p data-wa-draft-stale className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-900">
              ร่างนี้เก่าเกิน {DRAFT_LIFE_HOURS} ชั่วโมง ค่าที่วัดไว้อาจไม่เป็นปัจจุบันแล้ว จึงเผยแพร่ไม่ได้ — ระบบจะร่างใหม่ให้เองในรอบตรวจถัดไปหากเหตุการณ์ยังอยู่
            </p>
          )}
          {draftFresh && !canApprove && (
            <p data-wa-readonly className="text-xs leading-relaxed text-gray-600">
              {noApprovers ? 'ยังไม่มีผู้มีสิทธิ์ยืนยัน จึงยังไม่มีใครเผยแพร่ได้' : 'รอผู้มีสิทธิ์ยืนยันของหน่วยงานตรวจและกดเผยแพร่ — เจ้าหน้าที่คนอื่นไม่ต้องทำอะไร'}
            </p>
          )}
          {draftFresh && canApprove && (confirming === 'approve'
            ? (
              <div data-wa-confirm="approve" className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
                <p className="text-sm font-semibold text-emerald-900">เผยแพร่ประกาศนี้ให้ประชาชนเห็นทันที ใช้ได้ {hours} ชั่วโมง (ยกเลิกได้ทุกเมื่อ)</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" data-wa-action="approve-confirm" disabled={busy !== null} onClick={approve} className={BTN.primary}>
                    {busy === 'approve' ? 'กำลังเผยแพร่…' : 'เผยแพร่เลย'}
                  </button>
                  <button type="button" data-wa-action="approve-back" disabled={busy !== null} onClick={() => setConfirming(null)} className={BTN.secondary}>ยังก่อน</button>
                </div>
              </div>
            )
            : (
              <div className="flex flex-wrap gap-2">
                <button type="button" data-wa-action="approve" disabled={busy !== null} onClick={() => { setNotice(null); setConfirming('approve') }} className={BTN.primary}>ยืนยันและเผยแพร่</button>
                <button type="button" data-wa-action="decline" disabled={busy !== null} onClick={decline} className={BTN.secondary}>
                  {busy === 'decline' ? 'กำลังบันทึก…' : 'ไม่ประกาศ'}
                </button>
              </div>
            ))}
        </article>
      )}

      {!current && !pending && (
        <p data-wa-idle className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm leading-relaxed text-gray-700">
          ตอนนี้ไม่มีประกาศและไม่มีร่าง — ระบบจะร่างข้อความให้เองเมื่อมีเหตุการณ์ที่สถานีเข้าเกณฑ์ (ตรวจทุกชั่วโมง) แล้วผู้มีสิทธิ์ยืนยันเป็นผู้ตัดสินว่าจะเผยแพร่หรือไม่
        </p>
      )}

      {history.length > 0 && (
        <details data-wa-history className="rounded-xl border border-gray-200 bg-white p-3">
          <summary className="min-h-6 cursor-pointer text-sm font-semibold text-gray-700">ประวัติประกาศ ({history.length} รายการล่าสุด)</summary>
          <ul className="mt-2 space-y-2">
            {history.map(row => (
              <li key={row.id} data-wa-history-row={row.status} className="text-xs leading-relaxed text-gray-600">
                <p className="font-semibold text-gray-700">{historyLine(row, now)}</p>
                <details className="mt-0.5"><summary className="cursor-pointer text-gray-500">ดูข้อความ</summary><p className="mt-1 whitespace-pre-line rounded-lg bg-gray-50 p-2 text-gray-800">{row.body}</p></details>
              </li>
            ))}
          </ul>
        </details>
      )}

      {data.can_manage_approvers === true && <WaterAnnouncementApprovers tenantId={tenantId} onChanged={() => load(true)} />}
    </section>
  )
}
