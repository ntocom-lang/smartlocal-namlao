import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Layers, Loader2, Megaphone, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { appUrl } from '../../lib/basename'
import { orgHeadTitle } from '../../lib/orgTerms'
import {
  MAX_BATCH_ITEMS, MAX_NEWS_PHOTOS, batchMoreText, buildBatchNewsModel, buildNewsSvg, createCanvasMeasure, newsFontStack,
  groupNewsCandidates, thaiLongDate, villageLevel, villageList,
} from '../../lib/complaintNewsImage'
import { DialogShell, NewsOutputPanel } from './newsDialogParts'
import { loadImage, useDepartmentTheme, useNewsBranding, useNewsFont, usePreparedPng } from './newsDialogData'

// กล่อง "ภาพข่าวรวม" — เรื่องหมวดเดียวกันที่เสร็จวันเดียวกัน รวมเป็นภาพเดียว: 1 รูปต่อเรื่อง + ป้ายหมู่ใต้รูป
// (เจ้าของระบบตัดสิน 2569-11-11: ไม่มี SQL · ระบบจัดกลุ่ม "วันเดียวกัน+หมวดเดียวกัน" ให้ + ติ๊กเลือกเองได้ ·
//  4 ช่องรูป เกินขึ้น "และอีก N จุด" · ป้ายเวลาซ่อนยกเว้นทันกำหนดทุกเรื่อง · ใช้ได้ทั้งหน้าคำร้องและห้องผู้บริหาร)
//
// source = 'staff': ผู้เรียกส่งเรื่องเข้ามาพร้อมข้อมูล (detail) ครบ — กล่องไม่อ่านฐานข้อมูลเพิ่ม
// source = 'exec': ผู้เรียกส่งแค่รายการจาก RPC exec_complaint_news_items แล้วกล่องโหลดรายละเอียดทีละเรื่องที่ติ๊ก
//   ผ่าน RPC exec_complaint_news_detail เท่านั้น (ไม่อ่านตาราง complaints ตรง — RLS ไม่ให้ viewer อ่าน + PDPA)
//
// ⚠️ PDPA: ภาพรวมใช้เฉพาะ "รูปหลังดำเนินการ" ไม่มีรูปจากผู้แจ้ง · ป้ายใต้รูปเป็นระดับหมู่เท่านั้น (villageLevel)
// ⚠️ ติ๊กข้ามกลุ่มไม่ได้: ติ๊กเรื่องของกลุ่มอื่น = ย้ายไปกลุ่มนั้น (เหลือเรื่องที่ติ๊กอันเดียว) เพื่อให้วันที่/หมวด/หัวข่าวถูกต้องเสมอ

/**
 * @typedef {{
 *   id: string, ref?: string, day: string, categoryKey: string, categoryLabel: string, departmentName?: string,
 *   detail?: { village?: string, createdAt?: string, closedAt?: string, dueDate?: string, workPhotos?: string[] } | null,
 * }} BatchCandidate
 */

const MAX_REFS_PER_ITEM = 3

/** @param {{ source?: 'staff' | 'exec', candidates: BatchCandidate[], tenant: object, onClose?: () => void }} props */
export default function ComplaintNewsBatchDialog({ source = 'staff', candidates, tenant, onClose }) {
  const isExec = source === 'exec'
  const tenantName = tenant?.name ?? ''
  const reportUrl = useMemo(() => appUrl('/complaint'), [])
  const groups = useMemo(() => groupNewsCandidates(candidates), [candidates])
  const { logo, branding, mayorPhoto } = useNewsBranding(tenant)

  const firstGroup = groups[0] ?? null
  const [groupKey, setGroupKey] = useState(() => firstGroup?.key ?? null)
  const [picked, setPicked] = useState(() => new Set((firstGroup?.items ?? []).slice(0, MAX_BATCH_ITEMS).map(item => item.id)))
  const [showSingles, setShowSingles] = useState(false)
  const [headlineEdit, setHeadlineEdit] = useState(null)
  const [detailEdit, setDetailEdit] = useState('')
  const [statusOn, setStatusOn] = useState(true)
  // QR + ลิงก์แจ้งเรื่องในแถบท้าย (ติ๊กไว้ก่อน) · ปิด = แถบท้ายเป็นข้อความขอบคุณ และข้อความที่แชร์ไม่มีลิงก์
  const [linkOn, setLinkOn] = useState(true)
  const [durationEdit, setDurationEdit] = useState(null)
  const [mayorEdit, setMayorEdit] = useState(null)
  // ข้อมูลรายเรื่องที่โหลดตามหลัง (exec) และรูปที่โหลดแล้ว — คีย์ด้วย id
  const [fetched, setFetched] = useState({})
  const [photos, setPhotos] = useState({})
  // กันโหลดซ้ำตอน StrictMode รัน effect สองรอบ / effect รันซ้ำก่อน state ใหม่ commit
  const startedDetails = useRef(new Set())
  const startedPhotos = useRef(new Set())
  // ผลโหลดที่กลับมาหลัง effect รอบนั้นถูกล้างแล้วยังต้องบันทึก (state เปลี่ยนทุกครั้งที่ผลมา effect จึงรันซ้ำบ่อย) — ทิ้งผลเฉพาะตอนกล่องถูกปิด
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const group = groups.find(item => item.key === groupKey) ?? null
  const pickedItems = useMemo(() => (group?.items ?? []).filter(item => picked.has(item.id)), [group, picked])
  const detailOf = item => item.detail ?? fetched[item.id]?.data ?? null

  // exec: โหลดรายละเอียดของเรื่องที่ติ๊ก (หมู่/วันกำหนดเสร็จ/รูป) ผ่าน RPC ทีละเรื่อง
  useEffect(() => {
    if (!isExec) return
    for (const item of pickedItems) {
      if (item.detail || startedDetails.current.has(item.id)) continue
      startedDetails.current.add(item.id)
      setFetched(prev => ({ ...prev, [item.id]: { status: 'loading' } }))
      supabase.rpc('exec_complaint_news_detail', { _municipality_id: tenant?.id, _complaint_id: item.id })
        .then(({ data, error }) => {
          if (!mounted.current) return
          if (error || !data) {
            if (error) console.error('exec_complaint_news_detail error:', error.message)
            setFetched(prev => ({ ...prev, [item.id]: { status: 'error' } }))
            return
          }
          setFetched(prev => ({ ...prev, [item.id]: {
            status: 'ok',
            data: {
              village: data.village, createdAt: data.created_at, closedAt: data.closed_at, dueDate: data.due_date, category: data.category,
              workPhotos: Array.isArray(data.work_photos) ? data.work_photos : [],
            },
          } }))
        }, () => {
          if (!mounted.current) return
          setFetched(prev => ({ ...prev, [item.id]: { status: 'error' } }))
        })
    }
  }, [isExec, pickedItems, tenant?.id])

  // รูป 1 รูปต่อเรื่อง (รูปแรกที่โหลดได้ ลองไม่เกิน 3 รูป) — โหลดตามลำดับที่ติ๊กเท่าที่จำเป็นให้ครบ 4 ช่อง
  // เรื่องที่รูปโหลดไม่ได้ถูกข้าม แล้วโหลดเรื่องถัดไปแทน (ประหยัด egress: ไม่โหลดรูปของเรื่องที่ไม่ได้ขึ้นภาพ)
  useEffect(() => {
    let slots = 0
    for (const item of pickedItems) {
      if (slots >= MAX_NEWS_PHOTOS) break
      const detail = detailOf(item)
      if (!detail) { slots += 1; continue }
      const state = photos[item.id]
      if (state && state.status !== 'loading' && !state.dataUrl) continue
      slots += 1
      if (state || startedPhotos.current.has(item.id)) continue
      startedPhotos.current.add(item.id)
      const refs = (detail.workPhotos ?? []).filter(Boolean).slice(0, MAX_REFS_PER_ITEM)
      setPhotos(prev => ({ ...prev, [item.id]: { status: 'loading', dataUrl: null } }))
      ;(async () => {
        let dataUrl = null
        for (const ref of refs) {
          dataUrl = (await loadImage(ref)).dataUrl
          if (dataUrl) break
        }
        if (!mounted.current) return
        setPhotos(prev => ({ ...prev, [item.id]: { status: 'done', dataUrl } }))
      })()
    }
    // detailOf อ่านจาก fetched/item.detail — fetched เปลี่ยนแล้วต้องคำนวณใหม่
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedItems, photos, fetched])

  const shown = []
  for (const item of pickedItems) {
    if (shown.length >= MAX_NEWS_PHOTOS) break
    const dataUrl = photos[item.id]?.dataUrl
    if (dataUrl) shown.push({ item, dataUrl })
  }
  const readyInfos = pickedItems.map(detailOf).filter(Boolean)
  const failedDetails = pickedItems.filter(item => fetched[item.id]?.status === 'error').length
  const loadingCount = pickedItems.filter(item => (!detailOf(item) && fetched[item.id]?.status !== 'error')
    || photos[item.id]?.status === 'loading').length
  const shownIds = new Set(shown.map(entry => entry.item.id))
  const hiddenItems = pickedItems.filter(item => !shownIds.has(item.id) && detailOf(item))
  const shownVillages = villageList(shown.map(entry => detailOf(entry.item)?.village))
  const hiddenVillages = villageList(hiddenItems.map(item => detailOf(item)?.village)).filter(label => !shownVillages.includes(label))
  // กำลังโหลดอยู่ = ยังไม่รู้ว่าจะเหลือกี่จุด จึงยังไม่ขึ้น "และอีก N จุด" (กันตัวเลขกระโดดตอนรูปทยอยมา)
  const moreText = loadingCount > 0 ? '' : batchMoreText(hiddenItems.length, hiddenVillages)

  const departments = [...new Set(pickedItems.map(item => String(item.departmentName ?? '').trim()).filter(Boolean))]
  const departmentName = departments.length === 1 ? departments[0] : ''
  const categoryLabel = group?.items[0]?.categoryLabel ?? ''
  // รหัสหมวดไว้เลือกไอคอน: staff ส่ง categoryKey = รหัสหมวด · exec ส่ง categoryKey = ชื่อหมวด (รายการจาก RPC ไม่มีรหัส) จึงใช้รหัสจากรายละเอียดที่โหลดแล้ว
  // (กลุ่มเดียวกัน = หมวดเดียวกัน) · ยังโหลดไม่เสร็จ/ไม่มีรหัส = ไม่วาดไอคอน
  const categoryCode = isExec ? (pickedItems.map(item => detailOf(item)?.category).find(Boolean) ?? '') : (group?.categoryKey ?? '')
  // สีธีมตามสีกอง — ภาพรวมที่เลือกจากหลายกอง (departmentName ว่าง) ได้สีส้ม
  const theme = useDepartmentTheme(tenant?.id, departmentName)

  const hasMayorData = !!(branding?.photo_url || branding?.mayor_name)
  const mayorOn = hasMayorData && (mayorEdit ?? true)
  const executive = useMemo(() => (mayorOn
    ? { name: branding?.mayor_name ?? '', title: branding?.mayor_title || orgHeadTitle(tenant) }
    : null), [mayorOn, branding?.mayor_name, branding?.mayor_title, tenant])

  // readyInfos/photoDataUrls/photoCaptions เป็นอาร์เรย์ใหม่ทุกรอบ — คีย์ด้วยเนื้อหาจริงเพื่อไม่ให้ภาพและไฟล์ PNG ถูกสร้างใหม่ทุกครั้งที่เรนเดอร์
  const infosKey = JSON.stringify(readyInfos)
  const model = useMemo(() => buildBatchNewsModel({
    items: readyInfos, tenantName, departmentName, categoryLabel, categoryCode, showStatus: statusOn, showDuration: durationEdit ?? undefined,
    headline: headlineEdit ?? undefined, detail: detailEdit, reportUrl: linkOn ? reportUrl : '', executive, theme,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [infosKey, tenantName, departmentName, categoryLabel, categoryCode, statusOn, durationEdit, headlineEdit, detailEdit, reportUrl, linkOn, executive, theme])
  const deferredModel = useDeferredValue(model)

  const photoDataUrls = shown.map(entry => entry.dataUrl)
  const photoCaptions = shown.map(entry => villageLevel(detailOf(entry.item)?.village))
  const photosKey = photoDataUrls.join('|')
  const captionsKey = photoCaptions.join('|')
  const newsFont = useNewsFont()
  const image = useMemo(() => {
    if (!newsFont.ready) return null
    const { font } = newsFont
    try {
      return buildNewsSvg(deferredModel, createCanvasMeasure(font ? newsFontStack(font.family) : undefined), {
        font,
        // ภาพรวมใช้เฉพาะรูปหลังดำเนินการ (ไม่มีรูปจากผู้แจ้ง) ทุกช่องจึงเป็น 'after'
        logoDataUrl: logo, photoDataUrls, photoCaptions, photoKinds: photoDataUrls.map(() => 'after'), moreText, executivePhotoDataUrl: mayorOn ? mayorPhoto : null,
      })
    } catch {
      return null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsFont, deferredModel, logo, photosKey, captionsKey, moreText, mayorOn, mayorPhoto])
  const png = usePreparedPng(image, `news-batch-${group?.day ?? 'x'}-${pickedItems.length}.png`)

  function toggleItem(target, itemGroup) {
    if (itemGroup.key !== groupKey) {
      setGroupKey(itemGroup.key)
      setPicked(new Set([target.id]))
      setHeadlineEdit(null)
      return
    }
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(target.id)) next.delete(target.id)
      else if (next.size < MAX_BATCH_ITEMS) next.add(target.id)
      return next
    })
  }

  function pickWholeGroup(itemGroup) {
    setGroupKey(itemGroup.key)
    setPicked(new Set(itemGroup.items.slice(0, MAX_BATCH_ITEMS).map(item => item.id)))
    if (itemGroup.key !== groupKey) setHeadlineEdit(null)
  }

  const multiGroups = groups.filter(item => item.items.length >= 2)
  const singleGroups = groups.filter(item => item.items.length < 2)
  const visibleGroups = [...multiGroups, ...(showSingles ? singleGroups : singleGroups.filter(item => item.key === groupKey))]

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="flex items-center gap-1.5 text-base font-bold text-gray-800"><Layers size={16} style={{ color: '#c2410c' }} /> ภาพข่าวรวม</p>
        <p className="mt-0.5 text-xs text-gray-500">เรื่องหมวดเดียวกัน เสร็จวันเดียวกัน รวมเป็นภาพเดียว · ในภาพไม่มีชื่อ เบอร์ หรือที่อยู่ของผู้แจ้ง</p>
      </div>
      <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-gray-100" aria-label="ปิด"><X size={18} className="text-gray-500" /></button>
    </div>
  )

  if (!groups.length) {
    return (
      <DialogShell onClose={onClose}>
        {header}
        <p role="status" className="mt-6 text-sm text-gray-500">ยังไม่มีเรื่องที่ทำภาพรวมได้ (ต้องเป็นเรื่องที่ดำเนินการแล้วและมีรูปหลังดำเนินการ)</p>
      </DialogShell>
    )
  }

  return (
    <DialogShell onClose={onClose}>
      {header}
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-2" data-news-batch-groups>
            <p className="text-xs font-semibold text-gray-600">
              เลือกเรื่อง ({pickedItems.length}/{MAX_BATCH_ITEMS}) <span className="font-normal text-gray-400">· ระบบจัดกลุ่ม วันเดียวกัน + หมวดเดียวกัน ให้แล้ว</span>
            </p>
            {visibleGroups.map(itemGroup => (
              <fieldset key={itemGroup.key} className={`space-y-1.5 rounded-xl border p-2.5 ${itemGroup.key === groupKey ? 'border-orange-400 bg-orange-50/40' : 'border-gray-200 bg-white'}`}>
                <legend className="sr-only">{thaiLongDate(itemGroup.day)} {itemGroup.items[0].categoryLabel}</legend>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-xs font-bold text-gray-800">
                    {thaiLongDate(itemGroup.day)} · {itemGroup.items[0].categoryLabel} <span className="font-normal text-gray-500">({itemGroup.items.length} เรื่อง)</span>
                  </p>
                  {itemGroup.items.length >= 2 && (
                    <button type="button" onClick={() => pickWholeGroup(itemGroup)}
                      className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
                      เลือกทั้งกลุ่ม
                    </button>
                  )}
                </div>
                <ul className="space-y-1">
                  {itemGroup.items.map(item => {
                    const on = itemGroup.key === groupKey && picked.has(item.id)
                    const blocked = !on && itemGroup.key === groupKey && picked.size >= MAX_BATCH_ITEMS
                    const state = fetched[item.id]
                    const village = villageLevel(detailOf(item)?.village)
                    return (
                      <li key={item.id}>
                        <label className={`flex min-h-9 items-center gap-2 rounded-lg px-1.5 text-sm ${blocked ? 'opacity-40' : 'cursor-pointer hover:bg-white'}`}>
                          <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={on} disabled={blocked || state?.status === 'error'}
                            onChange={() => toggleItem(item, itemGroup)} aria-label={`เลือกเรื่อง ${item.ref ?? item.id}`} />
                          <span className="min-w-0 break-all font-semibold text-gray-800">{item.ref ?? String(item.id).slice(0, 8)}</span>
                          {village && <span className="text-xs text-gray-500">{village}</span>}
                          {state?.status === 'loading' && <Loader2 size={12} className="animate-spin text-gray-400" aria-hidden="true" />}
                          {state?.status === 'error' && <span className="text-[11px] text-red-600">โหลดข้อมูลไม่สำเร็จ</span>}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </fieldset>
            ))}
            {singleGroups.length > 0 && (
              <button type="button" onClick={() => setShowSingles(value => !value)} className="text-[11px] font-semibold text-gray-600 underline">
                {showSingles ? 'ซ่อนเรื่องที่ไม่มีคู่' : `แสดงเรื่องที่ไม่มีคู่ (${singleGroups.length} กลุ่ม)`}
              </button>
            )}
            <p className="text-[11px] text-gray-500">ติ๊กเรื่องของกลุ่มอื่น = ย้ายไปกลุ่มนั้น (กันหัวข่าว วันที่ และหมวดไม่ตรงกับเรื่องในภาพ)</p>
            {failedDetails > 0 && <p role="alert" className="text-[11px] text-red-600">โหลดข้อมูลไม่สำเร็จ {failedDetails} เรื่อง — ภาพนี้ไม่รวมเรื่องเหล่านั้น (ปิดกล่องแล้วเปิดใหม่เพื่อลองอีกครั้ง)</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="news-batch-headline" className="text-xs font-semibold text-gray-600">ข้อความข่าว <span className="font-normal text-gray-400">(ระบบร่างให้ แก้ได้)</span></label>
            <textarea id="news-batch-headline" value={headlineEdit ?? model.headline} onChange={e => setHeadlineEdit(e.target.value)} rows={4} maxLength={400}
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-200" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="news-batch-detail" className="text-xs font-semibold text-gray-600">รายละเอียด <span className="font-normal text-gray-400">(เว้นว่างได้ · ภาพรวมไม่ดึงบันทึกปิดงานมาต่อกัน · ตรวจว่าไม่มีชื่อ/เบอร์ผู้แจ้งก่อนเผยแพร่)</span></label>
            <textarea id="news-batch-detail" value={detailEdit} onChange={e => setDetailEdit(e.target.value)} rows={3} maxLength={1000}
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-200" />
          </div>

          <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={statusOn} onChange={e => setStatusOn(e.target.checked)} />
              แสดง "ดำเนินการแล้ว"
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={model.showDuration} disabled={!model.durationLabel}
                onChange={e => setDurationEdit(e.target.checked)} />
              แสดง "{model.durationLabel || 'ใช้เวลาไม่เกิน — วันทำการ'}"
            </label>
            <p className="text-[11px] text-gray-500">ป้ายเวลาแสดงได้เมื่อทุกเรื่องในภาพเสร็จทันกำหนด · มีเรื่องเกินกำหนดแม้เรื่องเดียวจะไม่มีป้ายนี้</p>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={linkOn} onChange={e => setLinkOn(e.target.checked)} />
              แสดง QR และลิงก์แจ้งเรื่อง
            </label>
            {!linkOn && <p className="text-[11px] text-gray-500">ไม่แสดง = แถบท้ายเป็น "ขอบคุณทุกการแจ้งปัญหาจากประชาชน · มุ่งสู่เมืองอัจฉริยะ (Smart City)"</p>}
            {hasMayorData && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={mayorOn} onChange={e => setMayorEdit(e.target.checked)} />
                แสดงรูปและชื่อนายก
              </label>
            )}
          </div>
          {loadingCount > 0 && <p role="status" className="flex items-center gap-1.5 text-[11px] text-gray-500"><Loader2 size={12} className="animate-spin" aria-hidden="true" /> กำลังโหลดข้อมูลและรูป...</p>}
          {pickedItems.length > 0 && shown.length === 0 && loadingCount === 0 && (
            <p className="flex items-center gap-1.5 text-[11px] text-red-600"><Megaphone size={12} aria-hidden="true" /> เรื่องที่เลือกยังโหลดรูปไม่ได้ ภาพจะไม่มีรูป</p>
          )}
        </div>

        <NewsOutputPanel image={image} model={model} tenantName={tenantName} file={png.file} error={png.error} onRetry={png.retry} />
      </div>
    </DialogShell>
  )
}
