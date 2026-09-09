import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, CalendarClock, Check, CheckCircle2, Loader2, PackageOpen, Printer, XCircle,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { thaiDateFromDateInput } from '../../lib/thaiDate'
import { buildAssetBorrowHtml } from '../../lib/assetBorrowPrint'
import {
  SIGNATORY_REGISTRY_SELECT, SIGNATORY_SCOPE,
  pickSignatory, signatoryName, signatoryTitle,
} from '../../lib/documentSignatories'

const numCls = 'w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-center text-sm'
const textCls = 'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm'

const STATUS_META = {
  submitted:  { label: 'รอพิจารณา',            cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved:   { label: 'อนุมัติแล้ว รอรับของ', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  issued:     { label: 'จ่ายของแล้ว',          cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  settlement: { label: 'รอผลชดใช้',            cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  returned:   { label: 'คืนครบแล้ว',           cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected:   { label: 'ไม่อนุมัติ/ยกเลิก',    cls: 'bg-gray-100 text-gray-600 border-gray-200' },
}

function todayBangkok() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
}

/**
 * แผงจัดการคำขอยืมพัสดุฝั่งเจ้าหน้าที่ — แทนที่ปุ่มเปลี่ยนสถานะแบบทั่วไปของ StaffDashboard
 *
 * ⚠️ ห้ามให้ประเภทนี้ใช้ปุ่ม "ดำเนินการเสร็จสิ้น" ตัวกลาง — การอนุมัติให้ยืมยังไม่ใช่การจบงาน
 * งานจบเมื่อของกลับมาครบและเคลียร์ความเสียหายเรียบร้อยเท่านั้น ปุ่มกลางจะข้ามขั้นตอน
 * จ่ายของ/รับคืนทั้งหมดแล้วปิดงานทันที ซึ่งทำให้ของหายไปจากระบบโดยไม่มีใครรับผิดชอบ
 *
 * ทุกปุ่มยิง RPC ฝั่งฐานข้อมูล ไม่ได้ UPDATE ตารางตรงๆ — ตารางลูกไม่มีสิทธิ์เขียนให้
 * authenticated เลย และ RPC เป็นที่เดียวที่ล็อกของ ตรวจจำนวนว่าง และเขียน audit ในธุรกรรมเดียว
 *
 * ⚠️ "เกินกำหนดคืน" คำนวณสดจากวันที่ ไม่ใช่สถานะที่เก็บไว้ — จึงไม่ต้องมี cron และไม่มีทาง
 * ค้างเป็นค่าเก่าเมื่อ cron ล่ม
 */
export default function AssetBorrowRequestPanel({ requestId, tenant, onChanged }) {
  const [header, setHeader] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [acting, setActing] = useState(false)
  const [draft, setDraft] = useState({})      // itemId -> ค่าที่เจ้าหน้าที่กำลังกรอก
  const [formNo, setFormNo] = useState('')
  const [note, setNote] = useState('')
  const [extendTo, setExtendTo] = useState('')
  const [showExtend, setShowExtend] = useState(false)
  const [printData, setPrintData] = useState({ department: '', clerk: null, mayor: null })
  const [snapshot, setSnapshot] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    const [headRes, itemRes] = await Promise.all([
      supabase.from('asset_borrow_requests').select('*').eq('request_id', requestId).maybeSingle(),
      supabase.from('asset_borrow_items').select('*').eq('request_id', requestId).order('sort_order'),
    ])
    // ⚠️ แยก "โหลดไม่สำเร็จ" ออกจาก "ไม่มีข้อมูล" — เจ้าหน้าที่ที่เห็นจอว่างตอนเน็ตมีปัญหา
    // จะเข้าใจว่าคำขอนี้ไม่มีรายการของ แล้วกดปฏิเสธทิ้ง
    if (headRes.error || itemRes.error) {
      setLoadError((headRes.error ?? itemRes.error).message)
      setLoading(false)
      return
    }
    setLoadError('')
    setHeader(headRes.data)
    setItems(itemRes.data ?? [])
    setFormNo(headRes.data?.form_no ?? '')
    setDraft({})
    setLoading(false)

    // ข้อมูลสำหรับใบพิมพ์อย่างเดียว — โหลดแยกและไม่กันหน้าจอ ถ้าอ่านไม่ได้ยังทำงานต่อได้
    // ใบจะพิมพ์ชื่อผู้ลงนามเป็นเส้นจุดให้เขียนมือแทน ซึ่งยังใช้งานได้จริง
    const muni = headRes.data?.municipality_id
    if (!muni) return
    const [deptRes, signRes, parentRes] = await Promise.all([
      headRes.data.department_id
        ? supabase.from('departments').select('name').eq('id', headRes.data.department_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('document_signatories').select(SIGNATORY_REGISTRY_SELECT)
        .eq('municipality_id', muni).eq('document_type', SIGNATORY_SCOPE).eq('is_active', true),
      supabase.from('document_requests').select('permit_form_data').eq('id', requestId).maybeSingle(),
    ])
    const registry = signRes.data ?? []
    const toSignatory = row => (row ? { name: signatoryName(row), title: signatoryTitle(row) } : null)
    setPrintData({
      department: deptRes.data?.name ?? '',
      clerk: toSignatory(pickSignatory(registry, { role: 'clerk' })),
      mayor: toSignatory(pickSignatory(registry, { role: 'mayor' })),
    })
    setSnapshot(parentRes.data?.permit_form_data ?? {})
  }, [requestId])

  // สิทธิ์ดำเนินการ — อ่านโปรไฟล์ตัวเองแทนการรับเป็น prop เพราะแผงนี้ถูกเรนเดอร์ลึกอยู่ใน
  // TaskDetailSheet การส่ง prop ลงมาต้องแก้ทางผ่านหลายชั้นที่ไม่เกี่ยวกับพัสดุเลย
  // เงื่อนไขต้องตรงกับ asset_can_manage() ฝั่งฐานข้อมูล ไม่งั้นได้ปุ่มหลอกที่กดแล้ว error
  const [me, setMe] = useState(null)
  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      supabase.from('profiles').select('role, asset_role, department_id, municipality_id')
        .eq('id', data.session.user.id).maybeSingle()
        .then(({ data: profile }) => { if (!cancelled) setMe(profile ?? {}) })
    })
    return () => { cancelled = true }
  }, [])

  const canAct = Boolean(
    me && header && (
      me.role === 'superadmin'
      || (me.municipality_id === header.municipality_id && (
        me.role === 'admin'
        || me.asset_role === 'asset_admin'
        || (me.asset_role === 'asset_staff'
            && header.department_id && me.department_id === header.department_id)
      ))
    ),
  )

  useEffect(() => { load() }, [load])

  const status = header?.workflow_status
  // ใช้กับส่วนที่แก้ข้อมูลได้เท่านั้น — ช่องกรอกและปุ่มดำเนินการ ส่วนที่แสดงผลอย่างเดียว
  // ยังใช้ status ตามปกติ คนที่ไม่มีสิทธิ์จึงยังตามเรื่องได้ครบ แค่ลงมือแทนไม่ได้
  const editStatus = canAct ? status : ''
  const isOverdue = status === 'issued' && header?.return_due_date < todayBangkok()

  function fieldValue(item, key, fallback) {
    return draft[item.id]?.[key] ?? fallback
  }

  function setField(item, key, value) {
    setDraft(current => ({ ...current, [item.id]: { ...current[item.id], [key]: value } }))
  }

  async function run(fn, label) {
    setActing(true)
    const { error } = await fn()
    setActing(false)
    if (error) {
      // ข้อความจาก RAISE EXCEPTION เป็นภาษาไทยอยู่แล้ว แสดงตรงๆ ได้
      alert(`${label}ไม่สำเร็จ: ${error.message}`)
      return
    }
    await load()
    onChanged?.()
  }

  const approve = () => run(() => supabase.rpc('approve_asset_borrow_request', {
    p_request_id: requestId,
    p_items: items.map(item => ({
      item_id: item.id,
      approved_qty: Number(fieldValue(item, 'approved_qty', item.requested_qty)),
    })),
    p_form_no: formNo.trim() || null,
    p_note: note.trim() || null,
  }), 'อนุมัติ')

  const reject = () => {
    const reason = window.prompt('เหตุผลที่ไม่อนุมัติ (ผู้ยื่นจะเห็นข้อความนี้)')
    if (!reason?.trim()) return
    return run(() => supabase.rpc('reject_asset_borrow_request', {
      p_request_id: requestId, p_reason: reason.trim(),
    }), 'ไม่อนุมัติ')
  }

  const issue = () => run(() => supabase.rpc('issue_asset_borrow_items', {
    p_request_id: requestId,
    p_items: items.map(item => ({
      item_id: item.id,
      issued_qty: Number(fieldValue(item, 'issued_qty', item.approved_qty ?? 0)),
    })),
  }), 'บันทึกการจ่ายของ')

  const receive = () => run(() => supabase.rpc('receive_asset_borrow_items', {
    p_request_id: requestId,
    p_items: items.map(item => ({
      item_id: item.id,
      returned_qty: Number(fieldValue(item, 'returned_qty', item.returned_qty)),
      damaged_qty: Number(fieldValue(item, 'damaged_qty', item.damaged_qty)),
      lost_qty: Number(fieldValue(item, 'lost_qty', item.lost_qty)),
    })),
  }), 'บันทึกการรับคืน')

  const settle = () => run(() => supabase.rpc('settle_asset_borrow_request', {
    p_request_id: requestId,
    p_items: items.map(item => ({
      item_id: item.id,
      settlement_note: fieldValue(item, 'settlement_note', item.settlement_note ?? ''),
    })),
    p_note: note.trim() || null,
  }), 'ปิดเรื่องชดใช้')

  const extend = () => {
    const reason = window.prompt('เหตุผลที่ขยายกำหนดคืน (บันทึกไว้ให้ตรวจสอบได้)')
    if (!reason?.trim()) return
    return run(() => supabase.rpc('extend_asset_borrow_due_date', {
      p_request_id: requestId, p_new_date: extendTo, p_reason: reason.trim(),
    }), 'ขยายกำหนดคืน').then(() => setShowExtend(false))
  }

  function handlePrint() {
    const html = buildAssetBorrowHtml({
      header, items, form: snapshot, tenant,
      departmentName: printData.department,
      clerk: printData.clerk, mayor: printData.mayor,
      // เลขอ้างอิง 8 ตัวแรกของ request id — รูปแบบเดียวกับที่ Inbox ใช้แสดงบนหน้าจอ
      // เป็นร่องรอยคู่กับลายมือชื่ออิเล็กทรอนิกส์ ให้ตรวจย้อนกลับไปหาคำขอต้นทางได้
      referenceNo: String(requestId ?? '').slice(0, 8).toUpperCase(),
    })
    const win = window.open('', '_blank', 'width=860,height=1100')
    if (!win) return
    win.document.write(html)
    win.document.close()
    setTimeout(() => { win.focus(); win.print() }, 400)
  }

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
  }

  if (loadError) {
    return (
      <div className="m-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center">
        <AlertTriangle size={24} className="mx-auto text-rose-500" />
        <p className="mt-2 text-sm font-semibold text-rose-900">โหลดรายละเอียดการยืมไม่สำเร็จ</p>
        <p className="mt-1 text-xs text-rose-700">{loadError}</p>
        <p className="mt-1 text-xs text-rose-800">ไม่ใช่ว่าคำขอนี้ไม่มีรายการของ — อย่าเพิ่งปฏิเสธคำขอ</p>
        <button onClick={load} className="mt-3 min-h-[44px] rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-700">
          ลองใหม่
        </button>
      </div>
    )
  }

  if (!header) {
    return (
      <div className="m-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
        คำขอนี้ไม่มีข้อมูลการยืมแนบอยู่ — อาจเป็นคำขอที่สร้างก่อนเปิดใช้โมดูลนี้
      </div>
    )
  }

  const meta = STATUS_META[status] ?? STATUS_META.submitted

  return (
    <div className="space-y-3 border-t border-gray-100 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
        {isOverdue && (
          <span className="flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">
            <AlertTriangle size={12} /> เกินกำหนดคืนแล้ว
          </span>
        )}
        {header.form_no && (
          <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs text-gray-600">บย. {header.form_no}</span>
        )}
      </div>

      {/* บอกให้ชัดว่าทำไมไม่มีปุ่ม — จอที่เงียบเฉยๆ ทำให้เจ้าหน้าที่คิดว่าระบบพัง แล้วโทรหา
          คนที่แก้ไม่ได้ ข้อความนี้ชี้ตรงไปที่คนที่แก้ให้ได้จริงคือแอดมินของ อปท. */}
      {me && !canAct && status !== 'returned' && status !== 'rejected' && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          ท่านดูเรื่องนี้ได้อย่างเดียว — การอนุมัติ จ่ายของ และรับคืน ต้องเป็นเจ้าหน้าที่พัสดุ
          ของกองที่ดูแลของชิ้นนี้ ขอสิทธิ์ได้ที่ผู้ดูแลระบบของหน่วยงาน
        </div>
      )}

      <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
        ใช้ตั้งแต่ {thaiDateFromDateInput(header.borrow_start_date)}
        {' · '}กำหนดคืน <span className={isOverdue ? 'font-bold text-rose-700' : 'font-semibold'}>
          {thaiDateFromDateInput(header.return_due_date)}
        </span>
        {header.place_of_use && <><br />สถานที่ใช้: {header.place_of_use}</>}
        {header.borrower_position && <><br />ตำแหน่งผู้ยืม: {header.borrower_position}</>}
      </div>

      {/* ── รายการของ ────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400">
              <th className="py-1.5 text-left font-semibold">รายการ</th>
              <th className="py-1.5 text-center font-semibold">ขอ</th>
              {status === 'submitted' && <th className="py-1.5 text-center font-semibold">อนุมัติ</th>}
              {status !== 'submitted' && <th className="py-1.5 text-center font-semibold">อนุมัติ</th>}
              {status === 'approved' && <th className="py-1.5 text-center font-semibold">จ่าย</th>}
              {(status === 'issued' || status === 'settlement' || status === 'returned') && (
                <>
                  <th className="py-1.5 text-center font-semibold">จ่าย</th>
                  <th className="py-1.5 text-center font-semibold">คืนดี</th>
                  <th className="py-1.5 text-center font-semibold">ชำรุด</th>
                  <th className="py-1.5 text-center font-semibold">หาย</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map(item => (
              <tr key={item.id}>
                <td className="py-2 pr-2 text-gray-800">
                  {item.asset_name_snapshot}
                  {item.asset_code_snapshot && <span className="text-gray-400"> · {item.asset_code_snapshot}</span>}
                  <span className="block text-[11px] text-gray-400">{item.unit_snapshot}</span>
                </td>
                <td className="py-2 text-center font-semibold text-gray-700">{item.requested_qty}</td>

                {editStatus === 'submitted' ? (
                  <td className="py-2 text-center">
                    <input className={numCls} type="number" min="0" max={item.requested_qty}
                      value={fieldValue(item, 'approved_qty', item.requested_qty)}
                      onChange={e => setField(item, 'approved_qty', e.target.value)} />
                  </td>
                ) : (
                  <td className="py-2 text-center font-semibold text-gray-700">{item.approved_qty ?? '—'}</td>
                )}

                {status === 'approved' && (
                  <td className="py-2 text-center">
                    {canAct ? (
                      <input className={numCls} type="number" min="0" max={item.approved_qty ?? 0}
                        value={fieldValue(item, 'issued_qty', item.approved_qty ?? 0)}
                        onChange={e => setField(item, 'issued_qty', e.target.value)} />
                    ) : <span className="font-semibold text-gray-400">—</span>}
                  </td>
                )}

                {(status === 'issued' || status === 'settlement' || status === 'returned') && (
                  <>
                    <td className="py-2 text-center font-semibold text-gray-700">{item.issued_qty}</td>
                    {editStatus === 'issued' ? (
                      <>
                        <td className="py-2 text-center">
                          <input className={numCls} type="number" min="0" max={item.issued_qty}
                            value={fieldValue(item, 'returned_qty', item.returned_qty)}
                            onChange={e => setField(item, 'returned_qty', e.target.value)} />
                        </td>
                        <td className="py-2 text-center">
                          <input className={numCls} type="number" min="0" max={item.issued_qty}
                            value={fieldValue(item, 'damaged_qty', item.damaged_qty)}
                            onChange={e => setField(item, 'damaged_qty', e.target.value)} />
                        </td>
                        <td className="py-2 text-center">
                          <input className={numCls} type="number" min="0" max={item.issued_qty}
                            value={fieldValue(item, 'lost_qty', item.lost_qty)}
                            onChange={e => setField(item, 'lost_qty', e.target.value)} />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 text-center text-emerald-700">{item.returned_qty}</td>
                        <td className="py-2 text-center text-amber-700">{item.damaged_qty}</td>
                        <td className="py-2 text-center text-rose-700">{item.lost_qty}</td>
                      </>
                    )}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── ปิดเรื่องชดใช้ ────────────────────────────────────────────── */}
      {editStatus === 'settlement' && (
        <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs font-semibold text-rose-900">
            มีของชำรุด/สูญหาย — ต้องบันทึกผลดำเนินการทุกรายการก่อนปิดงาน
          </p>
          {items.filter(i => i.damaged_qty + i.lost_qty > 0).map(item => (
            <div key={item.id}>
              <label className="mb-1 block text-[11px] font-semibold text-rose-800">
                {item.asset_name_snapshot} (ชำรุด {item.damaged_qty} · หาย {item.lost_qty})
              </label>
              <input className={textCls}
                placeholder="เช่น ผู้ยืมชดใช้เป็นเงิน 500 บาท ตามใบเสร็จเลขที่..."
                value={fieldValue(item, 'settlement_note', item.settlement_note ?? '')}
                onChange={e => setField(item, 'settlement_note', e.target.value)} />
            </div>
          ))}
          {/* ⚠️ ระบบไม่ตัดจำนวนของที่หายออกจากทะเบียนให้เอง — ต้องจำหน่ายพัสดุตามระเบียบก่อน */}
          <p className="text-[11px] leading-relaxed text-rose-700">
            ของที่สูญหายจะยังนับว่าว่างให้ยืมอยู่ จนกว่าจะปรับจำนวนในทะเบียนของให้ยืมเอง
            หลังดำเนินการจำหน่ายพัสดุตามระเบียบเสร็จแล้ว
          </p>
        </div>
      )}

      {/* ── ช่องกรอกร่วม ─────────────────────────────────────────────── */}
      {editStatus === 'submitted' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-gray-500">เลขที่ บย.</label>
            <input className={textCls} value={formNo} onChange={e => setFormNo(e.target.value)}
              placeholder="เช่น 12/2569" maxLength={40} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-gray-500">บันทึกภายใน</label>
            <input className={textCls} value={note} onChange={e => setNote(e.target.value)} />
          </div>
        </div>
      )}

      {/* ── ปุ่มดำเนินการ ────────────────────────────────────────────── */}
      {editStatus === 'submitted' && (
        <div className="space-y-2">
          <button onClick={approve} disabled={acting}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-teal-700 text-sm font-bold text-white disabled:opacity-50">
            {acting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            อนุมัติให้ยืม (ตามจำนวนที่กรอก)
          </button>
          <button onClick={reject} disabled={acting}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-red-50 text-sm font-semibold text-red-600">
            <XCircle size={16} /> ไม่อนุมัติ
          </button>
          <p className="text-center text-[11px] text-gray-400">
            อนุมัติแล้วงานยังไม่จบ — ต้องจ่ายของและรับคืนให้ครบก่อน
          </p>
        </div>
      )}

      {editStatus === 'approved' && (
        <div className="space-y-2">
          <button onClick={issue} disabled={acting}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-sm font-bold text-white disabled:opacity-50">
            {acting ? <Loader2 size={16} className="animate-spin" /> : <PackageOpen size={16} />}
            บันทึกการจ่ายของ
          </button>
          <p className="text-center text-[11px] text-gray-400">
            ให้ผู้ยืมลงชื่อ &quot;ผู้รับของ&quot; ในใบ บย. ที่พิมพ์ออกมาด้วยปากกาก่อนจ่ายของจริง
          </p>
        </div>
      )}

      {editStatus === 'issued' && (
        <div className="space-y-2">
          <button onClick={receive} disabled={acting}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50">
            {acting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            บันทึกการรับคืน
          </button>
          {!showExtend ? (
            <button onClick={() => { setExtendTo(header.return_due_date); setShowExtend(true) }}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600">
              <CalendarClock size={15} /> ขยายกำหนดคืน
            </button>
          ) : (
            <div className="flex gap-2">
              <input className={textCls} type="date" value={extendTo}
                min={header.return_due_date} onChange={e => setExtendTo(e.target.value)} />
              <button onClick={extend} disabled={acting || !extendTo}
                className="min-h-[44px] shrink-0 rounded-xl bg-gray-800 px-4 text-sm font-semibold text-white disabled:opacity-50">
                บันทึก
              </button>
            </div>
          )}
          <p className="text-center text-[11px] text-gray-400">
            คืนไม่ครบให้กรอกเท่าที่ได้คืนจริง งานจะยังไม่ปิดจนกว่าจะครบ
          </p>
        </div>
      )}

      {editStatus === 'settlement' && (
        <button onClick={settle} disabled={acting}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50">
          {acting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          ปิดเรื่องชดใช้และจบงาน
        </button>
      )}

      {/* พิมพ์ได้ทุกสถานะยกเว้นที่ถูกปฏิเสธ — ต้องพิมพ์ก่อนจ่ายของเพื่อให้ผู้ยืมลงชื่อ
          "ผู้รับของ" ด้วยปากกา และพิมพ์ซ้ำตอนรับคืนเพื่อลงชื่อ "ผู้ส่งคืน/ผู้รับคืน" */}
      {status !== 'rejected' && (
        <button onClick={handlePrint}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-gray-300 text-sm font-semibold text-gray-700">
          <Printer size={15} /> พิมพ์ใบยืมพัสดุ/ครุภัณฑ์ (บย.)
        </button>
      )}

      {(status === 'returned' || status === 'rejected') && (
        <div className="rounded-xl bg-gray-50 p-3 text-center text-xs text-gray-500">
          {status === 'returned' ? 'คืนของครบและเคลียร์เรียบร้อยแล้ว' : (header.reject_reason || 'คำขอถูกปฏิเสธ/ยกเลิก')}
        </div>
      )}
    </div>
  )
}
