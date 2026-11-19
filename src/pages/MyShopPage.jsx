import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, EyeOff, Loader2, Pencil, Plus, Store, Trash2, X } from 'lucide-react'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'
import { edgeImageUrl } from '../lib/edgeImage'
import { shrinkPhoto, POST_IMAGE_MAX_WIDTH, POST_IMAGE_QUALITY } from '../lib/imageUtils'
import { uploadFile } from '../lib/driveStorage'
import { driveFolderPath, driveMonthFolder, DRIVE_MODULES } from '../lib/driveFolders'
import {
  ATTEST_TEXT, EMPTY_PRODUCT_FORM, MARKET_PRODUCT_LIMIT, PRODUCT_LIMITS,
  buildProductPayload, formatPriceWithUnit, nextDisplayOrder, productToForm, sortProducts, validateProductForm,
} from '../lib/localMarket'
import {
  createProduct, deleteProduct, fetchManageProducts, fetchMyShops, setProductAvailable, updateProduct,
} from '../lib/localMarketApi'

// text-base (16px) กันมือถือ iOS ซูมหน้าเองตอนแตะช่องกรอก
const inp = 'w-full px-3 py-3 text-base text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-transparent'
const primaryBtn = 'flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-4 text-base font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50'
const lightBtn = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50'

// ── ฟอร์มเพิ่ม/แก้สินค้า (แผ่นเลื่อนขึ้นจากล่าง · เต็มจอบนมือถือ) ─────────────────────────────
function ProductSheet({ placeId, product, tenantSlug, onClose, onSaved, nextOrder }) {
  const isEdit = Boolean(product)
  const [form, setForm] = useState(() => (product ? productToForm(product) : { ...EMPTY_PRODUCT_FORM }))
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const set = (field) => (e) => setForm(p => ({ ...p, [field]: e.target.value }))

  async function handleFile(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP)'); return }
    if (file.size > 10 * 1024 * 1024) { setError('ไฟล์ใหญ่เกิน 10 MB'); return }
    setUploading(true); setError('')
    try {
      // ย่อให้กว้างไม่เกิน 800 px แบบเดียวกับรูปข่าว (PostsManager) — รูปสินค้าแสดงเป็นการ์ดเล็ก ไม่ต้องใช้ไฟล์ใหญ่ · ประหยัด egress
      const compressed = await shrinkPhoto(file, { maxWidth: POST_IMAGE_MAX_WIDTH, quality: POST_IMAGE_QUALITY })
      const ext = compressed.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg')
      // โฟลเดอร์บน Drive = ทะเบียนพาณิชย์ / เดือน เท่านั้น · subject ใช้ id ล้วน — ห้ามเอาชื่อร้าน/ชื่อเจ้าของมาตั้งชื่อ (PDPA:
      // ร้านของบุคคลธรรมดามักใช้ชื่อเจ้าของเป็นชื่อร้าน)
      const { url, error: upErr } = await uploadFile('complaint-attachments', compressed, {
        subject: `business/${placeId}/products`,
        folder: driveFolderPath(DRIVE_MODULES.business, driveMonthFolder()),
        filename: `${Date.now()}.${ext}`,
        municipality: tenantSlug,
      })
      if (upErr) setError('อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง')
      else setForm(p => ({ ...p, image_url: url }))
    } catch {
      setError('อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    const invalid = validateProductForm(form)
    if (invalid) { setError(invalid); return }
    setSaving(true); setError('')
    const res = isEdit
      ? await updateProduct(product.id, buildProductPayload(form))
      : await createProduct(buildProductPayload(form, { placeId, displayOrder: nextOrder }))
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onSaved(res.data)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={isEdit ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}>
      <div className="absolute inset-0 bg-black/40" onClick={saving ? undefined : onClose} />
      <div className="relative flex max-h-[94vh] w-full flex-col rounded-t-3xl bg-white shadow-2xl md:max-w-lg md:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-base font-bold text-gray-800">{isEdit ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}</h2>
          <button onClick={onClose} disabled={saving} aria-label="ปิด" className="rounded-xl p-2 text-gray-500 hover:bg-gray-100"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500" htmlFor="mk-name">ชื่อสินค้า *</label>
            <input id="mk-name" value={form.name} onChange={set('name')} maxLength={PRODUCT_LIMITS.nameMax} placeholder="เช่น กล้วยตาก" className={inp} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-500" htmlFor="mk-price">ราคา (บาท)</label>
              <input id="mk-price" value={form.price} onChange={set('price')} inputMode="decimal" placeholder="ว่าง = สอบถามราคา" className={inp} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-500" htmlFor="mk-unit">หน่วย</label>
              <input id="mk-unit" value={form.unit} onChange={set('unit')} maxLength={PRODUCT_LIMITS.unitMax} placeholder="เช่น ถุง, กก." className={inp} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500" htmlFor="mk-desc">รายละเอียด</label>
            <textarea id="mk-desc" value={form.description} onChange={set('description')} rows={3} maxLength={PRODUCT_LIMITS.descriptionMax}
              placeholder="ขนาด วัตถุดิบ วิธีสั่ง ฯลฯ (ไม่บังคับ)" className={`${inp} resize-none`} />
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold text-gray-500">รูปสินค้า (1 รูป)</p>
            {form.image_url ? (
              <div className="relative h-32 w-32 overflow-hidden rounded-xl bg-gray-100">
                <img src={edgeImageUrl(form.image_url)} alt="รูปสินค้า" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                <button type="button" onClick={() => setForm(p => ({ ...p, image_url: '' }))} aria-label="เอารูปออก"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 shadow"><X size={12} className="text-white" /></button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                className="flex h-32 w-32 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-300 text-gray-400 hover:border-amber-400 disabled:opacity-60">
                {uploading ? <Loader2 size={22} className="animate-spin" /> : <><Camera size={22} /><span className="text-xs">เพิ่มรูป</span></>}
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }} />
          </div>

          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <input type="checkbox" checked={form.is_available} onChange={(e) => setForm(p => ({ ...p, is_available: e.target.checked }))} className="h-5 w-5 rounded accent-green-600" />
            <span className="text-sm text-gray-700">มีของพร้อมขาย <span className="text-gray-400">(ไม่ติ๊ก = แสดงว่า &quot;หมด&quot;)</span></span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
            <input type="checkbox" checked={form.attest} onChange={(e) => setForm(p => ({ ...p, attest: e.target.checked }))} className="mt-0.5 h-5 w-5 shrink-0 rounded accent-amber-600" />
            <span className="text-sm leading-relaxed text-amber-900">{ATTEST_TEXT}</span>
          </label>

          {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-gray-100 px-4 pb-5 pt-3">
          <button onClick={onClose} disabled={saving} className={`${lightBtn} flex-1`}>ยกเลิก</button>
          <button onClick={handleSave} disabled={saving || uploading} className={`${primaryBtn} flex-[2]`} style={{ backgroundColor: 'var(--color-primary)' }}>
            {saving && <Loader2 size={16} className="animate-spin" />} บันทึก
          </button>
        </div>
      </div>
    </div>
  )
}

// ── การ์ดสินค้าหนึ่งรายการ ───────────────────────────────────────────────────────
function ProductRow({ product, busy, onToggle, onEdit, onDelete }) {
  return (
    <li className="rounded-2xl border border-gray-100 bg-white p-3">
      <div className="flex gap-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-gray-100">
          {product.image_url
            ? <img src={edgeImageUrl(product.image_url)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center text-xl">🛍️</div>}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`break-words text-sm font-bold leading-snug ${product.is_hidden ? 'text-gray-400' : 'text-gray-800'}`}>{product.name}</p>
          <p className="mt-0.5 text-sm text-gray-600">{formatPriceWithUnit(product.price, product.unit)}</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${product.is_available ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {product.is_available ? 'มีของ' : 'หมด'}
          </span>
        </div>
      </div>

      {product.is_hidden && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
          <EyeOff size={14} className="mt-0.5 shrink-0" />
          <span>
            ถูกซ่อนโดยเจ้าหน้าที่{product.hidden_reason ? `: ${product.hidden_reason}` : ''}
            <span className="block text-red-500">สินค้านี้ยังไม่แสดงต่อสาธารณะ — แก้ไขตามเหตุผลแล้วแจ้งเจ้าหน้าที่ให้เลิกซ่อน</span>
          </span>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={onToggle} disabled={busy} className={lightBtn}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {product.is_available ? 'ตั้งเป็น "หมด"' : 'ตั้งเป็น "มีของ"'}
        </button>
        <button onClick={onEdit} disabled={busy} className={lightBtn}><Pencil size={14} /> แก้ไข</button>
        <button onClick={onDelete} disabled={busy} aria-label={`ลบสินค้า ${product.name}`}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-red-100 bg-red-50 px-3 text-red-500 disabled:opacity-50"><Trash2 size={16} /></button>
      </div>
    </li>
  )
}

/**
 * ร้านของฉัน (ตลาดชาวบ้าน) — เจ้าของร้านเพิ่ม/แก้/ลบสินค้าของร้านตัวเอง · ขึ้นแสดงทันที ไม่มีขั้นอนุมัติ
 * เส้นทางนี้ห่อ RequireAuth + ModuleGuard (MODULE_ROUTES 'local-market') ใน App.jsx — โมดูลปิดแล้วเข้าไม่ได้
 * ตัวตัดสินสิทธิ์จริง (ร้านของใคร · เพดาน 30 รายการ · รูปต้อง https · ซ่อนโดยเจ้าหน้าที่) อยู่ที่ RLS/trigger ในฐานข้อมูล
 * หน้านี้แค่ตรวจเบื้องต้นให้เห็นข้อความไทย และแสดงข้อความของฐานข้อมูลตรงๆ ถ้าถูกปฏิเสธ
 */
export default function MyShopPage() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const { session } = useAuth()
  const uid = session?.user?.id

  const [shops, setShops] = useState(null)           // null = กำลังโหลด
  const [placeId, setPlaceId] = useState(null)
  const [products, setProducts] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [sheet, setSheet] = useState(null)           // null | 'add' | product
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    if (!uid) return undefined
    let alive = true
    fetchMyShops(uid).then(res => {
      if (!alive) return
      if (res.error) { setLoadError(res.error); setShops([]); return }
      setShops(res.data)
      setPlaceId(prev => prev ?? res.data[0]?.place_id ?? null)
    })
    return () => { alive = false }
  }, [uid])

  // ผูกการโหลดสินค้ากับ "ร้านที่เลือก" — เปลี่ยนร้านแล้วรายการเก่าต้องไม่ค้างโชว์ (pickShop เคลียร์ products ก่อนเปลี่ยน placeId)
  useEffect(() => {
    if (!placeId) return undefined
    let alive = true
    fetchManageProducts(placeId).then(res => {
      if (!alive) return
      if (res.error) { setLoadError(res.error); setProducts([]); return }
      setLoadError('')
      setProducts(res.data)
    })
    return () => { alive = false }
  }, [placeId])

  function pickShop(id) {
    if (id === placeId) return
    setProducts(null); setNotice(''); setLoadError(''); setPlaceId(id)
  }

  const shop = shops?.find(s => s.place_id === placeId) ?? null
  const full = (products?.length ?? 0) >= MARKET_PRODUCT_LIMIT

  function onSaved(row) {
    setProducts(prev => {
      const list = (prev ?? []).filter(p => p.id !== row.id)
      return sortProducts([...list, row])
    })
    setNotice(sheet === 'add' ? 'เพิ่มสินค้าแล้ว — ขึ้นแสดงในหน้าร้านทันที' : 'บันทึกแล้ว')
    setSheet(null)
  }

  async function toggleAvailable(product) {
    setBusyId(product.id); setNotice(''); setLoadError('')
    const res = await setProductAvailable(product.id, !product.is_available)
    setBusyId(null)
    if (res.error) { setLoadError(res.error); return }
    setProducts(prev => (prev ?? []).map(p => (p.id === product.id ? res.data : p)))
  }

  async function removeProduct(product) {
    if (!window.confirm(`ลบสินค้า "${product.name}" ออกจากร้าน? (ลบแล้วกู้คืนไม่ได้)`)) return
    setBusyId(product.id); setNotice(''); setLoadError('')
    const res = await deleteProduct(product.id)
    setBusyId(null)
    if (res.error) { setLoadError(res.error); return }
    setProducts(prev => (prev ?? []).filter(p => p.id !== product.id))
    setNotice('ลบสินค้าแล้ว')
  }

  const header = (
    <>
      <div className="md:hidden sticky top-0 z-30 bg-gray-50/95 px-4 pb-2 pt-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} aria-label="ย้อนกลับ" className="-ml-1 rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-200/60"><ArrowLeft size={20} /></button>
          <h1 className="text-base font-bold text-gray-800">ร้านของฉัน</h1>
        </div>
      </div>
      <div className="mb-2 hidden items-center gap-3 border-b border-gray-100 px-4 pb-5 pt-8 md:flex">
        <button onClick={() => navigate(-1)} aria-label="ย้อนกลับ" className="-ml-1 rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-200/60"><ArrowLeft size={20} /></button>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><Store size={22} /></div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">ร้านของฉัน</h1>
          <p className="mt-0.5 text-sm text-gray-500">ลงสินค้าของร้านเอง ขึ้นแสดงในหน้าร้านทันที</p>
        </div>
      </div>
    </>
  )

  if (shops === null) {
    return <div className="flex justify-center py-24"><Loader2 size={28} className="animate-spin text-gray-300" /></div>
  }

  if (shops.length === 0) {
    return (
      <div className="mx-auto max-w-lg pb-28 md:pb-8">
        {header}
        <div className="space-y-3 px-4 pt-3">
          {loadError && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{loadError}</p>}
          <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
            <Store size={32} className="mx-auto text-gray-300" />
            <p className="mt-2 text-sm font-semibold text-gray-700">บัญชีนี้ยังไม่ได้เป็นเจ้าของร้านในระบบ</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              ถ้ามีร้านค้าหรือสินค้าชุมชน ลงทะเบียนร้านได้ฟรี แล้วรอเจ้าหน้าที่ตรวจและอนุมัติ — เมื่ออนุมัติแล้วร้านจะผูกกับบัญชีนี้ และกลับมาลงสินค้าที่หน้านี้ได้
            </p>
            <button onClick={() => navigate('/business-register')} className={`${primaryBtn} mx-auto mt-4 w-full`} style={{ backgroundColor: 'var(--color-primary)' }}>
              ลงทะเบียนร้านค้า
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl pb-28 md:pb-8">
      {header}
      <div className="space-y-3 px-4 pt-3">
        {shops.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }} role="tablist" aria-label="เลือกร้าน">
            {shops.map(s => (
              <button key={s.place_id} role="tab" aria-selected={s.place_id === placeId} onClick={() => pickShop(s.place_id)}
                className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${s.place_id === placeId ? 'border-amber-500 bg-amber-500 text-white' : 'border-gray-200 bg-white text-gray-600'}`}>
                {s.name ?? 'ร้านของฉัน'}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-amber-900">{shop?.name ?? 'ร้านของฉัน'}</p>
            <p className="text-xs text-amber-700">สินค้า {products?.length ?? '–'} / {MARKET_PRODUCT_LIMIT} รายการ</p>
          </div>
          <button onClick={() => { setNotice(''); setSheet('add') }} disabled={full || products === null}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Plus size={16} /> เพิ่มสินค้า
          </button>
        </div>
        {full && <p className="text-xs text-gray-500">ร้านนี้มีสินค้าครบ {MARKET_PRODUCT_LIMIT} รายการแล้ว ลบรายการเก่าก่อนจึงจะเพิ่มใหม่ได้</p>}

        {notice && <p role="status" className="rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}
        {loadError && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{loadError}</p>}

        {products === null ? (
          <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
        ) : products.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
            <p className="text-3xl">🛍️</p>
            <p className="mt-2 text-sm font-semibold text-gray-700">ร้านนี้ยังไม่มีสินค้า</p>
            <p className="mt-1 text-xs text-gray-500">กด &quot;เพิ่มสินค้า&quot; เพื่อลงสินค้าชิ้นแรก — ประชาชนจะเห็นในหน้าร้านทันที</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {products.map(p => (
              <ProductRow key={p.id} product={p} busy={busyId === p.id}
                onToggle={() => toggleAvailable(p)} onEdit={() => { setNotice(''); setSheet(p) }} onDelete={() => removeProduct(p)} />
            ))}
          </ul>
        )}

        <p className="px-1 pt-2 text-xs leading-relaxed text-gray-400">
          ระบบนี้ไม่มีตะกร้าและไม่รับชำระเงิน ประชาชนติดต่อสั่งซื้อกับร้านโดยตรงตามช่องทางของร้าน
        </p>
      </div>

      {sheet && (
        <ProductSheet
          key={sheet === 'add' ? 'add' : sheet.id}
          placeId={placeId}
          product={sheet === 'add' ? null : sheet}
          tenantSlug={tenant?.slug}
          nextOrder={nextDisplayOrder(products)}
          onClose={() => setSheet(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
