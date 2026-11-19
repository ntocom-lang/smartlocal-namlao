import { useCallback, useEffect, useState } from 'react'
import { Loader2, Store, EyeOff, Eye, Trash2, Link2, Unlink } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import {
  LOCAL_MARKET_MODULE_KEY, PRODUCT_LIMITS, formatPriceWithUnit, normalizeHideReason, shortThaiDate,
} from '../../lib/localMarket'
import {
  fetchApprovedRegistrations, fetchManageProducts, fetchShopOwnerStatus, deleteProduct,
  linkShopOwner, setProductHidden, unlinkShopOwner,
} from '../../lib/localMarketApi'

/**
 * ส่ง "ตลาดชาวบ้าน" ในหน้าแก้ไขสถานที่ของเมนู เที่ยว กิน พัก ช้อป (TourismManager) — เจ้าหน้าที่ที่ดูแลร้านนี้เท่านั้น
 *  1) เจ้าของร้าน: มี/ไม่มี · ผูกจากคำขอลงทะเบียนที่อนุมัติแล้ว · ถอด
 *  2) สินค้าของร้าน (ทุกแถวรวมที่ซ่อน): ซ่อน (ต้องใส่เหตุผล เจ้าของร้านเห็น) / เลิกซ่อน / ลบ
 * ไม่มีขั้นอนุมัติรายสินค้า — เจ้าของร้านลงเองขึ้นทันที เจ้าหน้าที่ซ่อนภายหลัง ทุกการซ่อน/ลบมีสมุดบันทึกในฐานข้อมูล
 * ไม่โหลดรูปสินค้าในรายการนี้ (ประหยัด egress) · โมดูลปิด = ไม่แสดงอะไรเลย
 */
export default function LocalMarketStaffPanel({ tenant, place }) {
  const { isModuleEnabled } = useTenant()
  const enabled = !isModuleEnabled || isModuleEnabled(LOCAL_MARKET_MODULE_KEY)
  const placeId = place?.id

  const [owner, setOwner] = useState(undefined)          // undefined = กำลังโหลด · null = ไม่มีเจ้าของ
  const [products, setProducts] = useState(null)         // null = กำลังโหลด
  const [registrations, setRegistrations] = useState(null)
  const [pickedReg, setPickedReg] = useState('')
  const [busy, setBusy] = useState('')                   // 'link' | 'unlink' | id สินค้าที่กำลังทำรายการ
  const [error, setError] = useState('')
  const [hidingId, setHidingId] = useState(null)
  const [reason, setReason] = useState('')

  const reloadProducts = useCallback(async () => {
    const res = await fetchManageProducts(placeId)
    if (res.error) setError(res.error)
    else setProducts(res.data)
  }, [placeId])
  const reloadOwner = useCallback(async () => {
    const res = await fetchShopOwnerStatus(placeId)
    if (res.error) { setError(res.error); setOwner(null) } else setOwner(res.data)
  }, [placeId])

  useEffect(() => {
    if (!enabled || !placeId) return undefined
    let alive = true
    fetchShopOwnerStatus(placeId).then(res => {
      if (!alive) return
      if (res.error) { setError(res.error); setOwner(null) } else setOwner(res.data)
    })
    fetchManageProducts(placeId).then(res => {
      if (!alive) return
      if (res.error) { setError(res.error); setProducts([]) } else setProducts(res.data)
    })
    return () => { alive = false }
  }, [enabled, placeId])

  // รายการคำขอที่อนุมัติแล้วโหลดเมื่อยังไม่มีเจ้าของเท่านั้น (ไม่ต้องดึงทุกครั้งที่เปิดหน้าแก้ไข)
  useEffect(() => {
    if (!enabled || owner !== null || !tenant?.id) return undefined
    let alive = true
    fetchApprovedRegistrations(tenant.id).then(res => {
      if (!alive) return
      if (res.error) { setError(res.error); setRegistrations([]) } else setRegistrations(res.data)
    })
    return () => { alive = false }
  }, [enabled, owner, tenant?.id])

  if (!enabled || !placeId) return null

  async function handleLink() {
    if (!pickedReg || busy) return
    setBusy('link'); setError('')
    const res = await linkShopOwner(placeId, pickedReg)
    setBusy('')
    if (res.error) { setError(res.error); return }
    setPickedReg('')
    await reloadOwner()
  }

  async function handleUnlink() {
    if (busy) return
    if (!window.confirm('ถอดเจ้าของร้านออก? เจ้าของจะแก้สินค้าเองไม่ได้อีก (สินค้าที่ลงไว้ยังอยู่ เจ้าหน้าที่ซ่อน/ลบได้)')) return
    setBusy('unlink'); setError('')
    const res = await unlinkShopOwner(placeId)
    setBusy('')
    if (res.error) { setError(res.error); return }
    setRegistrations(null)
    await reloadOwner()
  }

  async function handleHide(product) {
    const text = normalizeHideReason(reason)
    if (!text) { setError('กรุณาระบุเหตุผลที่ซ่อน — เจ้าของร้านจะเห็นเหตุผลนี้'); return }
    setBusy(product.id); setError('')
    const res = await setProductHidden(product.id, true, text)
    setBusy('')
    if (res.error) { setError(res.error); return }
    setHidingId(null); setReason('')
    await reloadProducts()
  }

  async function handleUnhide(product) {
    setBusy(product.id); setError('')
    const res = await setProductHidden(product.id, false, null)
    setBusy('')
    if (res.error) { setError(res.error); return }
    await reloadProducts()
  }

  async function handleDelete(product) {
    if (!window.confirm(`ลบสินค้า "${product.name}" ออกจากร้านนี้? (ลบแล้วกู้คืนไม่ได้ ระบบบันทึกว่าเจ้าหน้าที่เป็นผู้ลบ)`)) return
    setBusy(product.id); setError('')
    const res = await deleteProduct(product.id)
    setBusy('')
    if (res.error) { setError(res.error); return }
    await reloadProducts()
  }

  return (
    <div className="space-y-2 pt-4 border-t border-gray-100" data-testid="local-market-staff-panel">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
        <Store size={13} /> ตลาดชาวบ้าน
      </p>
      <p className="text-[11px] text-gray-400 leading-relaxed">ปุ่มในส่วนนี้ทำงานทันที ไม่ต้องกด &quot;บันทึก&quot; ด้านบน</p>

      {error && (
        <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-2.5 py-2 leading-relaxed">{error}</p>
      )}

      {/* ── เจ้าของร้าน ── */}
      <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 space-y-2">
        <p className="text-[13px] font-semibold text-gray-700">เจ้าของร้าน</p>
        {owner === undefined ? (
          <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 size={13} className="animate-spin" /> กำลังโหลด...</div>
        ) : owner ? (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-green-700">
              มีเจ้าของร้านแล้ว{owner.linked_at ? ` · ผูกเมื่อ ${shortThaiDate(owner.linked_at)}` : ''}
            </p>
            <button type="button" onClick={handleUnlink} disabled={busy === 'unlink'}
              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 disabled:opacity-50">
              {busy === 'unlink' ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />} ถอดเจ้าของร้าน
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 leading-relaxed">
              ยังไม่มีเจ้าของร้านผูกไว้ — เจ้าของร้านจึงยังเพิ่มสินค้าเองไม่ได้ เลือกคำขอลงทะเบียนที่อนุมัติแล้วของร้านนี้เพื่อผูกบัญชีผู้ยื่น
            </p>
            {registrations === null ? (
              <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 size={13} className="animate-spin" /> กำลังโหลดรายการคำขอ...</div>
            ) : registrations.length === 0 ? (
              <p className="text-xs text-gray-400">ยังไม่มีคำขอลงทะเบียนที่อนุมัติแล้วในหน่วยงานนี้</p>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <select value={pickedReg} onChange={e => setPickedReg(e.target.value)} aria-label="เลือกคำขอลงทะเบียนที่อนุมัติแล้ว"
                  className="flex-1 min-w-0 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
                  <option value="">— เลือกคำขอที่อนุมัติแล้ว —</option>
                  {registrations.map(r => (
                    <option key={r.id} value={r.id} disabled={!r.hasAccount}>
                      {r.business_name} · ยื่น {shortThaiDate(r.created_at)}{r.hasAccount ? '' : ' (ไม่มีบัญชีผู้ยื่นแล้ว)'}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={handleLink} disabled={!pickedReg || busy === 'link'}
                  className="flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-primary)' }}>
                  {busy === 'link' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} ผูกเป็นเจ้าของร้าน
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── สินค้าของร้าน ── */}
      <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 space-y-2">
        <p className="text-[13px] font-semibold text-gray-700">
          สินค้าของร้าน{products ? ` (${products.length})` : ''}
        </p>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          เจ้าของร้านลงสินค้าเอง ขึ้นแสดงทันที — ซ่อนหรือลบได้เมื่อไม่เหมาะสม ระบบบันทึกประวัติทุกครั้ง
        </p>
        {products === null ? (
          <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 size={13} className="animate-spin" /> กำลังโหลด...</div>
        ) : products.length === 0 ? (
          <p className="text-xs text-gray-400">ร้านนี้ยังไม่มีสินค้า</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {products.map(p => (
              <li key={p.id} className="py-2.5 space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium leading-snug break-words ${p.is_hidden ? 'text-gray-400' : 'text-gray-800'}`}>{p.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatPriceWithUnit(p.price, p.unit)}
                      {p.is_available === false && <span className="ml-2 text-gray-400">· หมด</span>}
                    </p>
                    {p.is_hidden && (
                      <p className="text-xs text-red-600 mt-0.5 break-words">ซ่อนอยู่{p.hidden_reason ? `: ${p.hidden_reason}` : ''}</p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {p.is_hidden ? (
                      <button type="button" onClick={() => handleUnhide(p)} disabled={busy === p.id}
                        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700 disabled:opacity-50">
                        {busy === p.id ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} เลิกซ่อน
                      </button>
                    ) : (
                      <button type="button" onClick={() => { setHidingId(hidingId === p.id ? null : p.id); setReason(''); setError('') }} disabled={busy === p.id}
                        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 disabled:opacity-50">
                        <EyeOff size={12} /> ซ่อน
                      </button>
                    )}
                    <button type="button" onClick={() => handleDelete(p)} disabled={busy === p.id} aria-label={`ลบสินค้า ${p.name}`}
                      className="p-1.5 rounded-lg bg-red-50 text-red-500 disabled:opacity-50">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {hidingId === p.id && (
                  <div className="rounded-lg bg-amber-50 border border-amber-100 p-2.5 space-y-2">
                    <label className="text-xs font-semibold text-amber-800 block" htmlFor={`hide-reason-${p.id}`}>
                      เหตุผลที่ซ่อน (บังคับ — เจ้าของร้านจะเห็นเหตุผลนี้)
                    </label>
                    <input id={`hide-reason-${p.id}`} value={reason} maxLength={PRODUCT_LIMITS.hiddenReasonMax}
                      onChange={e => setReason(e.target.value)} placeholder="เช่น สินค้าไม่เหมาะสม / รูปไม่ตรงกับสินค้า"
                      className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-200" />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setHidingId(null); setReason('') }}
                        className="flex-1 py-2 rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-600">ยกเลิก</button>
                      <button type="button" onClick={() => handleHide(p)} disabled={busy === p.id || !normalizeHideReason(reason)}
                        className="flex-1 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1">
                        {busy === p.id && <Loader2 size={12} className="animate-spin" />} ยืนยันซ่อน
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
