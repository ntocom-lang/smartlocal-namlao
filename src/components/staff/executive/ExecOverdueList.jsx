import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Send, Star } from 'lucide-react'
import { thaiShortDate } from '../../../lib/complaintReportPeriods'
import { EXEC_OVERDUE_WD, execNf } from '../../../lib/executiveData'
import {
  followItem, loadMyFollows, loadOverdue, nudgeItem, unfollowItem,
} from '../../../lib/execFollowNudge'
import {
  canRetry, followRowKind, groupByDept, itemCategoryLabel, itemKey, itemKindName, itemOwnerText, itemStatusLabel, nudgeBlocked,
  nudgeConfirmText, nudgeDeliveryText, nudgeResultMessage, overdueWorkingDays, sensitiveSummaryLines, thaiDateTime, truncatedText,
} from '../../../lib/execFollowNudgeHelpers'
import { LoadingLine, SectionError, SubHead } from './ExecParts'

// แผง "รายการเรื่องเลยกำหนด" + ⭐ ติดตาม + ส่งให้กองเร่งรัด (ห้องผู้บริหาร E3-2) — เปิดจากการ์ด "เลยกำหนด" แล้วถึงโหลดข้อมูล (lazy)
// ข้อมูลมาจาก RPC exec_overdue_items / exec_my_follows เท่านั้น: ไม่มีชื่อผู้ร้อง/รายละเอียดเรื่อง (PDPA) · ไม่มีปุ่มอนุมัติ · ไม่มีลิงก์เข้าไปแก้เรื่อง
// มีชื่อ+ตำแหน่งเจ้าหน้าที่ผู้รับผิดชอบ (itemOwnerText) ให้นายกสั่งการถูกคน — เจ้าของระบบสั่ง 2026-11-11 · หมวดคุ้มครองผู้ร้องไม่มี
// ปุ่มเร่ง: แสดงเฉพาะผู้ที่ exec_assert_actor ให้ผ่าน (canNudge — ตัดสินที่ผู้เรียก) ฝั่งฐานข้อมูลตรวจซ้ำเสมอ (42501)
// "ส่งไม่ถึงต้องบอก": ผลการส่งทุกครั้งแสดงบนแถวพร้อมข้อความจากเซิร์ฟเวอร์ว่าไปถึงใครหรือไม่ถึงเพราะอะไร
// ชื่อคลาส Tailwind เขียนเต็มทุกตัว (ห้ามต่อสตริง)

const NOTE_TONE = {
  ok: 'text-emerald-800',
  warn: 'text-amber-800',
  wait: 'text-slate-600',
}

const BTN = 'inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border px-3 text-xs font-bold active:scale-95 disabled:cursor-not-allowed disabled:opacity-50'

/** แถวเรื่องเลยกำหนดแถวเดียว (การ์ดพับได้ทุกความกว้าง — ไม่ใช้ตารางจึงไม่ล้นแนวนอนบนมือถือ) */
function OverdueRow({ item, tenant, today, now, deptName, canNudge, busy, note, onFollow, onNudge }) {
  const late = overdueWorkingDays(item.due, today)
  const hot = late > EXEC_OVERDUE_WD
  const nudge = item.nudge
  const nudgeText = nudge ? nudgeDeliveryText(nudge.delivery) : null
  const blocked = nudgeBlocked(item, now)
  const retry = Boolean(item.nudged_today) && canRetry(nudge, now)
  const owner = itemOwnerText(item)
  return (
    <li data-exec-overdue-row={itemKey(item)} className="min-w-0 space-y-1.5 rounded-xl border border-slate-200 bg-white p-2.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="break-all text-sm font-black text-slate-900">{item.ref}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{itemKindName(item.k)}</span>
        <span className="min-w-0 break-words text-xs font-semibold text-slate-700">{itemCategoryLabel(item, tenant)}</span>
      </div>
      <p className="text-[11px] leading-snug text-slate-600">
        {itemStatusLabel(item.k, item.s)} · กำหนดเสร็จ {item.due ? thaiShortDate(item.due.slice(0, 10)) : '—'}
        {' · '}
        <span data-exec-overdue-days className={hot ? 'font-bold text-rose-700' : 'font-semibold text-amber-700'}>เลย {execNf(late)} วันทำการ</span>
      </p>
      {owner && (
        <p data-exec-overdue-owner className={`text-xs font-bold leading-snug ${owner.tone === 'warn' ? 'text-amber-700' : 'text-slate-800'}`}>
          {owner.tone === 'warn' ? '⚠ ' : ''}{owner.text}
        </p>
      )}
      {nudge && (
        <p data-exec-nudge-line className={`text-[11px] leading-snug ${NOTE_TONE[nudgeText.tone]}`}>
          {nudge.by || 'ผู้บริหาร'} เร่งแล้ว {thaiDateTime(nudge.at)} · {nudgeText.label}
        </p>
      )}
      {note && <p role="status" data-exec-nudge-note className={`text-[11px] font-semibold leading-snug ${NOTE_TONE[note.tone] ?? NOTE_TONE.warn}`}>{note.text}</p>}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" data-exec-follow-btn aria-pressed={Boolean(item.followed)} disabled={Boolean(busy)} onClick={() => onFollow(item)}
          className={`${BTN} ${item.followed ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
          {busy === 'follow'
            ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            : <Star size={13} className={item.followed ? 'fill-amber-400 text-amber-500' : ''} aria-hidden="true" />}
          {item.followed ? 'เลิกติดตาม' : 'ติดตาม'}
        </button>
        {canNudge && (
          <button type="button" data-exec-nudge-btn disabled={Boolean(busy) || blocked} onClick={() => onNudge(item, deptName)}
            title={blocked ? 'วันนี้มีการเร่งเรื่องนี้แล้ว (วันละครั้งต่อเรื่อง)' : undefined}
            className={`${BTN} border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100`}>
            {busy === 'nudge'
              ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              : <Send size={13} aria-hidden="true" />}
            {busy === 'nudge' ? 'กำลังส่ง…' : (retry ? 'ส่งเร่งรัดซ้ำ' : 'ส่งให้กองเร่งรัด')}
          </button>
        )}
      </div>
    </li>
  )
}

/** แถวเรื่องที่ติดตามอยู่ */
function FollowRow({ row, tenant, busy, note, onUnfollow }) {
  const kind = followRowKind(row)
  const unfollow = (
    <button type="button" data-exec-unfollow-btn disabled={Boolean(busy)} onClick={() => onUnfollow(row)}
      className={`${BTN} border-amber-400 bg-amber-50 text-amber-800`}>
      {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Star size={13} className="fill-amber-400 text-amber-500" aria-hidden="true" />}
      เลิกติดตาม
    </button>
  )
  return (
    <li data-exec-follow-row={itemKey(row)} className="min-w-0 space-y-1.5 rounded-xl border border-slate-200 bg-white p-2.5">
      {kind === 'gone' && <p className="text-xs font-semibold text-slate-600">เรื่องถูกลบ/ย้ายแล้ว{row.ref ? ` (เลขที่ ${row.ref})` : ''}</p>}
      {kind === 'hidden' && <p className="text-xs font-semibold text-slate-600">เรื่องหมวดคุ้มครองผู้ร้อง</p>}
      {kind === 'normal' && (
        <>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="break-all text-sm font-black text-slate-900">{row.ref}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{itemKindName(row.k)}</span>
            <span className="min-w-0 break-words text-xs font-semibold text-slate-700">{itemCategoryLabel(row, tenant)}</span>
            {row.changed && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">สถานะเปลี่ยน</span>}
          </div>
          <p className="text-[11px] leading-snug text-slate-600">
            {row.open === false ? 'เสร็จ/ปิดแล้ว' : itemStatusLabel(row.k, row.s)}
            {row.due ? ` · กำหนดเสร็จ ${thaiShortDate(row.due.slice(0, 10))}` : ''}
            {row.dept ? ` · ${row.dept}` : ''}
          </p>
        </>
      )}
      {note && <p role="status" className={`text-[11px] font-semibold ${NOTE_TONE[note.tone] ?? NOTE_TONE.warn}`}>{note.text}</p>}
      <div className="flex flex-wrap gap-1.5">{unfollow}</div>
    </li>
  )
}

/**
 * @param {{ tenant: object, today: string, canNudge: boolean }} props
 *   today = วันที่ไทย YYYY-MM-DD ที่ใช้นับวันทำการที่เลยมา (ov.today — วันเดียวกับที่ SQL ตัดสินเลยกำหนด)
 */
export default function ExecOverdueList({ tenant, today, canNudge }) {
  const tenantId = tenant?.id
  const [tab, setTab] = useState('overdue')
  const [overdue, setOverdue] = useState({ status: 'loading', data: null })
  const [follows, setFollows] = useState({ status: 'loading', rows: [] })
  const [now, setNow] = useState(() => new Date())
  const [busy, setBusy] = useState({}) // itemKey → 'follow' | 'nudge'
  const [notes, setNotes] = useState({}) // itemKey → { tone, text }

  const reloadOverdue = useCallback(async () => {
    try {
      const data = await loadOverdue(tenantId)
      setOverdue({ status: 'ok', data })
      setNow(new Date())
    } catch (e) {
      // โหลดซ้ำพลาดหลังเคยโหลดได้ = คงรายการเดิมไว้ (ไม่ทิ้งหน้าให้ว่าง) · ครั้งแรกพลาด = ขึ้นปุ่มลองใหม่
      console.error('exec_overdue_items error:', e?.cause?.message ?? e?.message)
      setOverdue((prev) => (prev.status === 'ok' ? prev : { status: 'error', data: null, message: e?.message }))
    }
  }, [tenantId])

  const reloadFollows = useCallback(async () => {
    try {
      setFollows({ status: 'ok', rows: await loadMyFollows(tenantId) })
    } catch (e) {
      console.error('exec_my_follows error:', e?.cause?.message ?? e?.message)
      setFollows((prev) => (prev.status === 'ok' ? prev : { status: 'error', rows: [], message: e?.message }))
    }
  }, [tenantId])

  useEffect(() => {
    reloadOverdue()
    reloadFollows()
  }, [reloadOverdue, reloadFollows])

  const setBusyFor = (key, value) => setBusy((b) => {
    const next = { ...b }
    if (value) next[key] = value
    else delete next[key]
    return next
  })
  const setNoteFor = (key, value) => setNotes((n) => {
    const next = { ...n }
    if (value) next[key] = value
    else delete next[key]
    return next
  })
  const markFollowed = (key, followed) => setOverdue((prev) => (prev.status !== 'ok' ? prev : {
    ...prev, data: { ...prev.data, items: prev.data.items.map((i) => (itemKey(i) === key ? { ...i, followed } : i)) },
  }))

  const toggleFollow = async (item) => {
    const key = itemKey(item)
    setBusyFor(key, 'follow')
    setNoteFor(key, null)
    try {
      if (item.followed) await unfollowItem(tenantId, item.k, item.id)
      else await followItem(tenantId, item.k, item.id)
      markFollowed(key, !item.followed)
      reloadFollows()
    } catch (e) {
      setNoteFor(key, { tone: 'warn', text: e.message })
    } finally {
      setBusyFor(key, null)
    }
  }

  const unfollowRow = async (row) => {
    const key = itemKey(row)
    setBusyFor(key, 'follow')
    setNoteFor(key, null)
    try {
      await unfollowItem(tenantId, row.k, row.id)
      setFollows((prev) => ({ ...prev, rows: prev.rows.filter((r) => itemKey(r) !== key) }))
      markFollowed(key, false)
    } catch (e) {
      setNoteFor(key, { tone: 'warn', text: e.message })
    } finally {
      setBusyFor(key, null)
    }
  }

  const sendNudge = async (item, deptName) => {
    if (!window.confirm(nudgeConfirmText(item, deptName))) return
    const key = itemKey(item)
    setBusyFor(key, 'nudge')
    setNoteFor(key, null)
    try {
      setNoteFor(key, nudgeResultMessage(await nudgeItem(tenantId, item.k, item.id)))
    } catch (e) {
      // ข้อความไทยจากเซิร์ฟเวอร์ (ไม่มีสิทธิ์ / เร่งไม่ได้ / ครบเพดานวัน ฯลฯ) แสดงตรงๆ
      setNoteFor(key, { tone: 'warn', text: e.message })
    } finally {
      setBusyFor(key, null)
      await reloadOverdue()
    }
  }

  const refresh = () => { reloadOverdue(); reloadFollows() }
  const data = overdue.data
  const groups = data ? groupByDept(data.items, today, EXEC_OVERDUE_WD) : []
  const followCount = follows.status === 'ok' ? follows.rows.length : null
  const trunc = data ? truncatedText(data) : null

  return (
    <div data-exec-overdue-panel className="space-y-2 rounded-2xl border border-rose-200 bg-white p-2.5 shadow-sm sm:p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label="รายการที่แสดง" className="flex flex-wrap gap-1.5">
          <button type="button" data-exec-overdue-tab="overdue" aria-pressed={tab === 'overdue'} onClick={() => setTab('overdue')}
            className={`min-h-9 rounded-full border px-3.5 text-xs font-bold active:scale-95 ${tab === 'overdue' ? 'border-rose-600 bg-rose-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            เรื่องเลยกำหนด{data ? ` (${execNf(data.total)})` : ''}
          </button>
          <button type="button" data-exec-overdue-tab="follows" aria-pressed={tab === 'follows'} onClick={() => setTab('follows')}
            className={`min-h-9 rounded-full border px-3.5 text-xs font-bold active:scale-95 ${tab === 'follows' ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            ที่ท่านติดตาม{followCount != null ? ` (${execNf(followCount)})` : ''}
          </button>
        </div>
        <button type="button" onClick={refresh} aria-label="โหลดรายการใหม่"
          className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 active:scale-95">
          <RefreshCw size={13} aria-hidden="true" /> โหลดใหม่
        </button>
      </div>
      <p className="text-[10px] leading-snug text-slate-500">
        ติดตาม = แจ้งความเคลื่อนไหวในสรุปเช้า (เร็วๆ นี้) · ส่งให้กองเร่งรัด = Telegram ถึงหัวหน้ากอง วันละครั้งต่อเรื่อง
        {!canNudge && ' · บัญชีนี้ติดตามได้อย่างเดียว (ส่งเร่งรัดได้เฉพาะคณะผู้บริหารและปลัด)'}
      </p>

      {tab === 'overdue' && (
        <div className="space-y-2">
          {overdue.status === 'loading' && <LoadingLine text="กำลังโหลดรายการเรื่องเลยกำหนด…" />}
          {overdue.status === 'error' && <SectionError text={overdue.message || 'โหลดรายการเรื่องเลยกำหนดไม่ได้'} onRetry={reloadOverdue} />}
          {data && data.items.length === 0 && data.sensitive.length === 0 && (
            <p data-exec-overdue-empty className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">ไม่มีเรื่องที่เลยกำหนด</p>
          )}
          {trunc && <p data-exec-overdue-truncated className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">{trunc}</p>}
          {groups.map((g) => (
            <section key={g.key} data-exec-overdue-dept={g.key} className="space-y-1.5">
              <SubHead tone="border-rose-500 text-rose-950">
                {g.name} · {execNf(g.items.length)} เรื่อง{g.over > 0 ? ` · เกิน ${EXEC_OVERDUE_WD} วันทำการ ${execNf(g.over)}` : ''}
              </SubHead>
              <ul className="space-y-1.5">
                {g.items.map((item) => (
                  <OverdueRow key={itemKey(item)} item={item} tenant={tenant} today={today} now={now} deptName={g.name}
                    canNudge={canNudge} busy={busy[itemKey(item)]} note={notes[itemKey(item)]} onFollow={toggleFollow} onNudge={sendNudge} />
                ))}
              </ul>
            </section>
          ))}
          {data && sensitiveSummaryLines(data.sensitive).map((line) => (
            <p key={line} data-exec-overdue-sensitive className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] leading-snug text-slate-700">{line}</p>
          ))}
        </div>
      )}

      {tab === 'follows' && (
        <div className="space-y-2">
          {follows.status === 'loading' && <LoadingLine text="กำลังโหลดเรื่องที่ท่านติดตาม…" />}
          {follows.status === 'error' && <SectionError text={follows.message || 'โหลดเรื่องที่ติดตามไม่ได้'} onRetry={reloadFollows} />}
          {follows.status === 'ok' && follows.rows.length === 0 && (
            <p data-exec-follows-empty className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
              ยังไม่ได้ติดตามเรื่องใด — กด ⭐ ติดตามที่แถวของเรื่องในแท็บเรื่องเลยกำหนด
            </p>
          )}
          {follows.status === 'ok' && follows.rows.length > 0 && (
            <ul className="space-y-1.5">
              {follows.rows.map((row) => (
                <FollowRow key={itemKey(row)} row={row} tenant={tenant} busy={busy[itemKey(row)]} note={notes[itemKey(row)]} onUnfollow={unfollowRow} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
