import { useCallback, useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { thaiShortDate } from '../../../lib/complaintReportPeriods'
import { EXEC_OVERDUE_WD, execNf } from '../../../lib/executiveData'
import { loadOverdue, nudgeItem } from '../../../lib/execFollowNudge'
import {
  canRetry, followRowKind, itemCategoryLabel, itemKey, itemKindName, itemOwnerText, itemStatusLabel, nudgeBlocked, nudgeConfirmText,
  nudgeDeliveryText, nudgeResultMessage, overdueWorkingDays, sensitiveSummaryLines, truncatedText,
} from '../../../lib/execFollowNudgeHelpers'
import { simpleAlertWords } from '../../../lib/execSimpleView'
import { ActionBtn, Flag, Item, LoadFail, Loading, OpenBtn } from './ExecSimpleParts'

// รายการที่กางใต้ข้อใน ② ของห้องผู้บริหารแบบเรียบ (อยู่หน้าเดิม ไม่ออกจากหน้า)
//   OverdueItems = เรื่องช้าเกิน 5 วันทำการ + ปุ่มส่งให้กองเร่ง (ตรรกะ/ข้อความยืนยัน/ผลส่งชุดเดียวกับ ExecOverdueList ของหน้าเต็ม)
//   FollowItems  = เรื่องที่ท่านติดตาม (อ่านอย่างเดียว) · RatingSources = ที่มาของคะแนนต่ำ (ไม่แสดงข้อความความเห็น) · MinorItems = เรื่องเล็ก
// PDPA: ไม่มีชื่อผู้ร้อง/ผู้ประเมิน/รายละเอียดเรื่อง — เลขที่เรื่อง + หมวด + กอง + จำนวนวัน เท่านั้น · หมวดคุ้มครองผู้ร้องเป็นยอดรวม ไม่มีเลขที่
//   ยกเว้นชื่อ+ตำแหน่ง "เจ้าหน้าที่ผู้รับผิดชอบ" ของเรื่องเลยกำหนด (เจ้าของระบบสั่ง 2026-11-11 ให้นายกสั่งการถูกคน · ไม่มีในหมวดคุ้มครองผู้ร้อง)
// ไม่มีปุ่มอนุมัติ — ปุ่มเร่งเป็น "ส่งข้อความ Telegram ถึงหัวหน้ากอง" ที่ฐานข้อมูลตรวจสิทธิ์ซ้ำ (exec_assert_actor) และจดบันทึกทุกครั้ง

const LIST_LIMIT = 10
const TONE_OF = { ok: 'green', warn: 'amber', wait: 'gray' }

const dueText = (due) => (typeof due === 'string' && due ? thaiShortDate(due.slice(0, 10)) : '—')

/**
 * เรื่องช้าเกิน 5 วันทำการ เรียงช้าสุดก่อน ไม่เกิน 10 รายการ — mount ตอนกางเท่านั้น (ไม่ยิง exec_overdue_items ตอนเปิดหน้า)
 * tick เปลี่ยน (รอบอัปเดตเอง) = โหลดใหม่เงียบๆ ขณะที่กางอยู่ · พลาด = คงรายการเดิม
 * @param {{ tenant: object, today: string, canNudge: boolean, tick: number }} props
 */
export function OverdueItems({ tenant, today, canNudge, tick }) {
  const tenantId = tenant?.id
  const [state, setState] = useState({ status: 'loading', data: null, stale: false })
  const [now, setNow] = useState(() => new Date())
  const [busy, setBusy] = useState(null) // itemKey ที่กำลังส่ง
  const [notes, setNotes] = useState({}) // itemKey → { tone, text }

  const load = useCallback(async () => {
    try {
      const data = await loadOverdue(tenantId)
      setState({ status: 'ok', data, stale: false })
      setNow(new Date())
    } catch (e) {
      console.error('exec_overdue_items error:', e?.cause?.message ?? e?.message)
      setState((prev) => (prev.status === 'ok' ? { ...prev, stale: true } : { status: 'error', data: null, stale: false }))
    }
  }, [tenantId])

  useEffect(() => { load() }, [load, tick])

  const send = async (item) => {
    if (!window.confirm(nudgeConfirmText(item, item.dept))) return
    const key = itemKey(item)
    setBusy(key)
    setNotes((n) => { const next = { ...n }; delete next[key]; return next })
    try {
      const message = nudgeResultMessage(await nudgeItem(tenantId, item.k, item.id))
      setNotes((n) => ({ ...n, [key]: message }))
    } catch (e) {
      // ข้อความไทยจากเซิร์ฟเวอร์ (ไม่มีสิทธิ์ / เร่งไม่ได้ / ครบเพดานวัน ฯลฯ) แสดงตรงๆ — ส่งไม่ถึงต้องบอก
      setNotes((n) => ({ ...n, [key]: { tone: 'warn', text: e.message } }))
    } finally {
      setBusy(null)
      await load()
    }
  }

  if (state.status === 'loading') return <Loading text="กำลังโหลดรายการ…" />
  if (state.status === 'error') return <LoadFail text="โหลดรายการเรื่องที่ช้าไม่ได้" onRetry={load} />
  const data = state.data
  const late = data.items
    .map((item) => ({ item, days: overdueWorkingDays(item.due, today) }))
    .filter((x) => x.days > EXEC_OVERDUE_WD)
    .sort((a, b) => b.days - a.days || String(a.item.due).localeCompare(String(b.item.due)))
  const shown = late.slice(0, LIST_LIMIT)
  const trunc = truncatedText(data)

  return (
    <>
      {state.stale && <Flag tone="gray">ยังอัปเดตรายการไม่ได้ — ที่เห็นเป็นของรอบก่อน</Flag>}
      {shown.length === 0 && <p className="es-note">ไม่มีเรื่องที่ช้าเกิน {EXEC_OVERDUE_WD} วันทำการในรายการนี้</p>}
      {shown.map(({ item, days }) => {
        const key = itemKey(item)
        const nudge = item.nudge
        const blocked = nudgeBlocked(item, now)
        const retry = Boolean(item.nudged_today) && canRetry(nudge, now)
        const sent = nudge ? nudgeDeliveryText(nudge.delivery) : null
        const note = notes[key]
        const owner = itemOwnerText(item)
        return (
          <Item key={key} data-exec-simple-overdue-row={key}>
            <div className="es-item-head"><span>{item.ref}</span><span className="late">เลยมา {execNf(days)} วันทำการ</span></div>
            <div className="es-item-title">{itemCategoryLabel(item, tenant)}</div>
            <div className="es-item-sub">{itemKindName(item.k)} · {item.dept || 'ไม่ระบุกอง'} · {itemStatusLabel(item.k, item.s)} · กำหนดเสร็จ {dueText(item.due)}</div>
            {owner && <div className={`es-item-owner${owner.tone === 'warn' ? ' warn' : ''}`} data-exec-simple-owner>{owner.tone === 'warn' ? '⚠ ' : ''}{owner.text}</div>}
            {note && <Flag tone={TONE_OF[note.tone] ?? 'amber'} data-exec-simple-nudge-note>{note.text}</Flag>}
            {canNudge && !note && blocked && sent && (
              <Flag tone={TONE_OF[sent.tone] ?? 'amber'} data-exec-simple-nudge-done>วันนี้ส่งให้กองเร่งแล้ว (เร่งได้วันละครั้ง) · {sent.label}</Flag>
            )}
            {canNudge && !blocked && (
              <ActionBtn Icon={Send} disabled={busy !== null} onClick={() => send(item)} data-exec-simple-nudge-btn>
                {busy === key ? 'กำลังส่ง…' : (retry ? 'ส่งเร่งรัดซ้ำ' : `ส่งให้${item.dept || 'กอง'}เร่ง`)}
              </ActionBtn>
            )}
          </Item>
        )
      })}
      {late.length > shown.length && <p className="es-note">แสดง {shown.length} จาก {execNf(late.length)} เรื่อง (ช้าสุดก่อน) — ดูทั้งหมดในหน้ารายละเอียด</p>}
      {trunc && <p className="es-note">{trunc}</p>}
      {sensitiveSummaryLines(data.sensitive).map((line) => <p key={line} className="es-note">{line}</p>)}
      <p className="es-note">ไม่แสดงชื่อผู้ร้อง · เรื่องร้องเรียนเจ้าหน้าที่แสดงเป็นยอดรวมเท่านั้น</p>
    </>
  )
}

/** เรื่องที่ท่านติดตาม (exec_my_follows) — อ่านอย่างเดียว: สถานะปัจจุบัน + ป้าย "สถานะเปลี่ยน" */
export function FollowItems({ rows, tenant }) {
  return rows.map((row) => {
    const kind = followRowKind(row)
    return (
      <Item key={itemKey(row)} data-exec-simple-follow-row={itemKey(row)}>
        {kind === 'gone' && <div className="es-item-title">เรื่องถูกลบ/ย้ายแล้ว{row.ref ? ` (เลขที่ ${row.ref})` : ''}</div>}
        {kind === 'hidden' && <div className="es-item-title">เรื่องหมวดคุ้มครองผู้ร้อง</div>}
        {kind === 'normal' && (
          <>
            <div className="es-item-head"><span>{row.ref}</span></div>
            <div className="es-item-title">{itemKindName(row.k)} · {itemCategoryLabel(row, tenant)}</div>
            <div className="es-item-sub">
              {row.dept ? `${row.dept} · ` : ''}
              {row.open === false ? 'เสร็จ/ปิดแล้ว' : itemStatusLabel(row.k, row.s)}
              {row.changed ? ' · สถานะเปลี่ยน' : ''}
              {row.due ? ` · กำหนดเสร็จ ${dueText(row.due)}` : ''}
            </div>
          </>
        )}
      </Item>
    )
  })
}

/** ที่มาของคะแนนต่ำ (จำนวนต่อที่มา) + ปุ่มไปอ่านความเห็นที่เมนูความพึงพอใจ — หน้านี้ไม่แสดงข้อความความเห็น (ผู้ประเมินพิมพ์เอง) */
export function RatingSources({ low, onOpenSatisfaction }) {
  return (
    <Item>
      {low.map((x) => <div key={x.key} className="es-item-title">{x.label} {execNf(x.n)} ครั้ง</div>)}
      <p className="es-note">หน้านี้ไม่แสดงข้อความความเห็น (ผู้ประเมินพิมพ์เอง) — อ่านได้ที่เมนูความพึงพอใจ</p>
      {onOpenSatisfaction && <OpenBtn onClick={onOpenSatisfaction}>ไปอ่านความเห็น</OpenBtn>}
    </Item>
  )
}

/** เรื่องเล็ก (นอกรายการสำคัญ / เกิน 3 แถวเด่น) — ชื่อ + จำนวน + ปุ่มไปหน้าเดิม ถ้าบัญชีนี้เปิดได้ */
export function MinorItems({ items, resolveLink }) {
  return items.map((it) => {
    const w = simpleAlertWords(it)
    const go = resolveLink(it.entry)
    return (
      <Item key={it.id} data-exec-simple-minor={it.id}>
        <div className="es-item-head"><span>{w.what}</span>{it.showCount && <span className="wait">{execNf(it.count)} {w.unit}</span>}</div>
        <div className="es-item-sub">{it.entry?.label}{it.detail ? ` · ${it.detail}` : ''}</div>
        {go && <OpenBtn onClick={go}>{w.go}</OpenBtn>}
      </Item>
    )
  })
}
