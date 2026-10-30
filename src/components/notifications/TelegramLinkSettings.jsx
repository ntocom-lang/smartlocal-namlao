// เชื่อม Telegram ส่วนตัว (ข้อ 3b ตั้งค่าแจ้งเตือน) — เฉพาะบุคลากร · ฝั่ง server: Edge Function telegram-webhook
// ผูกได้ทางเดียว: ลิงก์ใช้ครั้งเดียวจากหน้านี้ (ต้องล็อกอินอยู่) → กด Start ในแชทกับบอต
// ตรวจผลด้วยการอ่านแถวของตัวเองทุก 5 วินาทีเฉพาะตอนหน้าเปิดอยู่และลิงก์ยังไม่หมดอายุ
// ไม่ดึงทันทีตอนสลับกลับมาหน้าเว็บ (เคยทำ supabase ค้างบนมือถือ)
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Loader2, MessageCircle, ShieldCheck } from 'lucide-react'
import { QUIET_MODULES, qrLayout } from '../../lib/qrSvg'
import {
  getMyTelegramLink, isMissingTelegramLinkTable, linkExpired, minutesLeft, requestTelegramLink,
  setupTelegramWebhook, telegramBotStatus, unlinkMyTelegram,
} from '../../lib/telegramLink'

const POLL_MS = 5000

const formatThaiDateTime = (value) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function LinkQr({ url }) {
  const qr = useMemo(() => qrLayout(url, 168), [url])
  if (!qr) return null
  const box = qr.size + QUIET_MODULES * 2
  // ซ่อนบนจอเล็ก: เปิดจากโทรศัพท์กดปุ่มได้เลย QR มีไว้ให้คนที่เปิดหน้านี้บนคอมพิวเตอร์สแกนด้วยโทรศัพท์
  return (
    <svg viewBox={`0 0 ${box} ${box}`} width={qr.side} height={qr.side} role="img" aria-label="QR เปิดแชทกับบอตบนโทรศัพท์"
      className="hidden shrink-0 rounded-lg border border-slate-200 sm:block" data-telegram-link-qr>
      <rect width={box} height={box} fill="#fff" />
      <path transform={`translate(${QUIET_MODULES} ${QUIET_MODULES})`} d={qr.d} fill="#000" shapeRendering="crispEdges" />
    </svg>
  )
}

function BotAdmin() {
  const [state, setState] = useState({ busy: false, info: null, error: '' })
  const run = async (fn) => {
    setState((s) => ({ ...s, busy: true, error: '' }))
    const result = await fn().catch(() => ({ ok: false, error: 'ติดต่อระบบไม่สำเร็จ' }))
    setState({ busy: false, info: result.ok || result.other ? result : null, error: result.ok ? '' : result.error })
  }
  const info = state.info
  return (
    <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-3" data-telegram-bot-admin>
      <p className="text-xs font-semibold text-slate-700">ผู้ดูแลระบบสูงสุด: สถานะบอต</p>
      <p className="mt-1 text-xs leading-6 text-slate-500">ต้องตั้ง webhook ครั้งเดียวหลัง deploy ฟังก์ชัน telegram-webhook บุคลากรจึงจะเชื่อมได้ เมื่อตั้งแล้ว getUpdates ของบอตจะใช้ไม่ได้ (ระบบจดกลุ่มที่บอตอยู่ไว้ให้แทน)</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={state.busy} onClick={() => run(telegramBotStatus)} data-telegram-bot-status
          className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">ตรวจสถานะ</button>
        {info && !info.configured && (
          <button type="button" disabled={state.busy} data-telegram-bot-setup
            onClick={() => {
              if (info.other && !window.confirm(`บอตส่ง update ไปที่ ${info.otherHost} อยู่ ทับด้วยระบบนี้? ที่เดิมจะไม่ได้รับข้อความจากบอตอีก`)) return
              run(() => setupTelegramWebhook(Boolean(info.other)))
            }}
            className="inline-flex min-h-11 items-center rounded-xl bg-teal-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{info.other ? 'ทับ webhook เดิม' : 'ตั้ง webhook'}</button>
        )}
      </div>
      {state.busy && <p className="mt-2 text-xs text-slate-500">กำลังตรวจ…</p>}
      {state.error && <p role="alert" className="mt-2 text-xs leading-6 text-red-700">{state.error}</p>}
      {info && (
        <p role="status" className="mt-2 text-xs leading-6 text-slate-600" data-telegram-bot-result>
          {info.configured ? `พร้อมใช้ (@${info.bot ?? 'บอต'})` : info.other ? `บอตตั้ง webhook ไว้ที่ ${info.otherHost}` : 'ยังไม่ได้ตั้ง webhook'}
          {info.pending > 0 && ` · ค้างส่ง ${info.pending} รายการ`}
          {info.lastError && ` · ข้อผิดพลาดล่าสุด: ${info.lastError}`}
        </p>
      )}
    </div>
  )
}

export default function TelegramLinkSettings({ userId, isSuperadmin }) {
  const [state, setState] = useState({ loading: true, hidden: false, link: null, error: '' })
  const [pending, setPending] = useState(null) // { url, expires_at }
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const apply = useCallback((result) => {
    if (!result.error) setState({ loading: false, hidden: false, link: result.link, error: '' })
    else if (isMissingTelegramLinkTable(result.error)) setState({ loading: false, hidden: true, link: null, error: '' })
    else setState((s) => ({ ...s, loading: false, error: 'โหลดสถานะ Telegram ไม่สำเร็จ' }))
    return result.link ?? null
  }, [])
  const fetchLink = useCallback(
    () => getMyTelegramLink(userId).then((link) => ({ link }), (error) => ({ error })),
    [userId],
  )
  const load = useCallback(async () => apply(await fetchLink()), [apply, fetchLink])

  useEffect(() => {
    if (!userId) return undefined
    let cancelled = false
    fetchLink().then((result) => { if (!cancelled) apply(result) })
    return () => { cancelled = true }
  }, [userId, fetchLink, apply])

  const waiting = Boolean(pending) && !state.link && !linkExpired(pending?.expires_at, now)
  useEffect(() => {
    if (!waiting) return undefined
    const timer = setInterval(async () => {
      setNow(Date.now())
      if (document.hidden) return
      const link = await load()
      if (link) {
        setPending(null)
        setNote('เชื่อม Telegram เรียบร้อยแล้ว')
      }
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [waiting, load])

  if (state.hidden || !userId) return null

  const start = async () => {
    setBusy(true)
    setNote('')
    const result = await requestTelegramLink().catch(() => ({ ok: false, error: 'ขอลิงก์เชื่อม Telegram ไม่สำเร็จ กรุณาลองใหม่' }))
    setBusy(false)
    if (result.ok && result.url) {
      setNow(Date.now())
      setPending({ url: result.url, expires_at: result.expires_at })
    } else {
      setNote(result.error || 'ขอลิงก์เชื่อม Telegram ไม่สำเร็จ กรุณาลองใหม่')
    }
  }

  const unlink = async () => {
    if (!window.confirm('ยกเลิกการเชื่อม Telegram? แชทนั้นจะไม่ได้รับงานที่มอบหมายให้คุณอีก')) return
    setBusy(true)
    try {
      await unlinkMyTelegram(userId)
      await load()
      setNote('ยกเลิกการเชื่อมแล้ว')
    } catch {
      setNote('ยกเลิกไม่สำเร็จ กรุณาลองใหม่')
    }
    setBusy(false)
  }

  const expired = Boolean(pending) && linkExpired(pending.expires_at, now)

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="account-telegram-title" data-telegram-link-settings>
      <h2 id="account-telegram-title" className="flex items-center gap-2 text-sm font-bold text-slate-800"><MessageCircle size={19} aria-hidden="true" />Telegram ส่วนตัว</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">รับงานที่มอบหมายให้คุณทางแชทส่วนตัวกับบอตของระบบ แยกจากกลุ่ม Telegram ของหน่วยงาน</p>

      {state.loading ? <p className="mt-3 text-sm text-slate-500">กำลังตรวจสอบ…</p>
        : state.error ? <p role="alert" className="mt-3 text-sm text-red-700">{state.error}</p>
          : state.link ? (
            <div className="mt-3 space-y-3" data-telegram-linked>
              <p role="status" className="rounded-xl bg-teal-50 p-3 text-sm font-semibold text-teal-900">
                เชื่อมแล้ว{state.link.tg_display ? ` กับ ${state.link.tg_display}` : ''} · {formatThaiDateTime(state.link.linked_at)}
              </p>
              <p className="text-xs leading-6 text-slate-500">ถ้าชื่อนี้ไม่ใช่ Telegram ของคุณ ให้กดยกเลิกทันทีแล้วเชื่อมใหม่ · พิมพ์ /stop ในแชทกับบอตก็ยกเลิกได้</p>
              <button type="button" disabled={busy} onClick={unlink} data-telegram-unlink
                className="inline-flex min-h-11 items-center rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">ยกเลิกการเชื่อม</button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600" data-telegram-consent>
                <p className="flex items-center gap-1.5 font-semibold text-slate-700"><ShieldCheck size={15} aria-hidden="true" />ก่อนเชื่อม</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  <li>ระบบเก็บรหัสแชทและชื่อที่แสดงใน Telegram ของคุณ เพื่อส่งงานที่มอบหมายให้คุณเท่านั้น</li>
                  <li>ข้อความมีแค่เลขที่เรื่อง ประเภท และลิงก์เข้าระบบ ไม่มีชื่อหรือเบอร์โทรของประชาชน</li>
                  <li>Telegram เป็นบริการของต่างประเทศ ข้อความผ่านเซิร์ฟเวอร์ของ Telegram</li>
                  <li>ยกเลิกได้ทุกเมื่อจากหน้านี้ หรือพิมพ์ /stop ในแชท</li>
                </ul>
              </div>
              {waiting ? (
                <div className="flex flex-wrap items-start gap-4" data-telegram-link-pending>
                  <LinkQr url={pending.url} />
                  <div className="min-w-0 flex-1 space-y-2 text-sm leading-6 text-slate-600">
                    <p>กดปุ่มด้านล่าง<span className="hidden sm:inline"> (หรือสแกน QR ด้วยโทรศัพท์)</span> แล้วกด <b>Start</b> ในแชทกับบอต</p>
                    <a href={pending.url} target="_blank" rel="noopener noreferrer" data-telegram-open
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700">
                      <ExternalLink size={15} aria-hidden="true" />เปิด Telegram
                    </a>
                    <p className="text-xs text-slate-500">ลิงก์ใช้ได้ครั้งเดียว อีก {minutesLeft(pending.expires_at, now)} นาที · หน้านี้จะขึ้น "เชื่อมแล้ว" เอง</p>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={busy} onClick={start} data-telegram-link-start
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50">
                  {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}{expired ? 'ลิงก์หมดอายุ ขอลิงก์ใหม่' : 'เชื่อม Telegram'}
                </button>
              )}
            </div>
          )}
      {note && <p role="status" className="mt-3 text-xs leading-6 text-slate-600" data-telegram-link-note>{note}</p>}
      {isSuperadmin && <BotAdmin />}
    </section>
  )
}
