import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Megaphone, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { appUrl } from '../../lib/basename'
import { orgHeadTitle } from '../../lib/orgTerms'
import {
  MAX_NEWS_PHOTOS, buildNewsModel, buildNewsSvg, createCanvasMeasure, newsFontStack, defaultShowDuration, draftHeadline,
} from '../../lib/complaintNewsImage'
import { DialogShell, NewsOutputPanel } from './newsDialogParts'
import { GENERIC_ERROR, SHOWABLE_CODES, loadImage, useDepartmentTheme, useNewsBranding, useNewsFont, usePreparedPng } from './newsDialogData'

// กล่องสร้าง "ภาพข่าวประชาสัมพันธ์" ของคำร้องที่ดำเนินการแล้ว (เจ้าของระบบอนุมัติ 2569-11-11)
// ภาพที่เห็นในกล่อง = ไฟล์ PNG ที่ดาวน์โหลด/แชร์ (สตริง SVG ก้อนเดียวกัน ดู src/lib/complaintNewsImage.js)
// ในภาพไม่มีชื่อ/เบอร์/ที่อยู่/พิกัด/รายละเอียดเรื่องของผู้แจ้ง — มีแค่ที่เจ้าหน้าที่เห็นและแก้ในกล่องนี้
//
// source = 'staff' (ค่าเริ่ม): เจ้าหน้าที่ส่งเรื่องเข้ามาทั้งก้อน อ่านบันทึกปิดงานจาก complaint_timeline และมีรูปผู้แจ้งให้เลือก
// source = 'exec' (ห้องผู้บริหาร): ส่งแค่ complaintId แล้วโหลดผ่าน RPC exec_complaint_news_detail เท่านั้น
//   — ไม่อ่านตาราง complaints/complaint_timeline ตรง (RLS ไม่ให้ viewer อ่าน + PDPA) · ไม่มีส่วนรูปผู้แจ้งเลย
// ทั้งสองแบบ: บล็อกนายก (รูป/ชื่อ/ตำแหน่ง) มาจาก RPC complaint_news_branding · ติ๊กไว้ก่อนเมื่อมีรูปหรือชื่อ
//
// เตรียมไฟล์ PNG ไว้ล่วงหน้า ไม่ใช่ตอนกดปุ่ม: navigator.share() ต้องถูกเรียกในจังหวะที่ผู้ใช้เพิ่งกด
// (แบบเดียวกับ ComplaintMonthlyInfographic)

const MAX_CANDIDATES = 12

/**
 * @param {{
 *   complaint?: object, complaintId?: string, source?: 'staff' | 'exec', tenant: object,
 *   departmentName?: string, categoryLabel?: string, closedAt?: string | null, onClose?: () => void,
 * }} props  staff ส่ง complaint · exec ส่ง complaintId (โหลดเองผ่าน RPC)
 */
export default function ComplaintNewsDialog({ source = 'staff', complaintId = null, complaint = null, ...rest }) {
  if (source !== 'exec') return <NewsDialogBody source="staff" complaint={complaint} {...rest} />
  return <ExecNewsDialogLoader complaintId={complaintId} {...rest} />
}

function ExecNewsDialogLoader({ complaintId, tenant, onClose }) {
  const [state, setState] = useState({ status: 'loading', data: null, message: '' })
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let alive = true
    supabase.rpc('exec_complaint_news_detail', { _municipality_id: tenant?.id, _complaint_id: complaintId })
      .then(({ data, error }) => {
        if (!alive) return
        if (error || !data) {
          if (error) console.error('exec_complaint_news_detail error:', error.message)
          setState({ status: 'error', data: null, message: SHOWABLE_CODES.has(error?.code) && error?.message ? error.message : GENERIC_ERROR })
          return
        }
        setState({ status: 'ok', data, message: '' })
      }, () => { if (alive) setState({ status: 'error', data: null, message: GENERIC_ERROR }) })
    return () => { alive = false }
  }, [tenant?.id, complaintId, retry])

  if (state.status !== 'ok') {
    return (
      <DialogShell onClose={onClose}>
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-center gap-1.5 text-base font-bold text-gray-800"><Megaphone size={16} style={{ color: '#c2410c' }} /> ภาพข่าวประชาสัมพันธ์</p>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-gray-100" aria-label="ปิด"><X size={18} className="text-gray-500" /></button>
        </div>
        {state.status === 'loading'
          ? <p role="status" className="mt-6 flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> กำลังโหลดข้อมูลเรื่อง...</p>
          : (
            <p role="alert" className="mt-6 text-sm text-red-700">{state.message}{' '}
              <button type="button" className="font-bold underline" onClick={() => { setState({ status: 'loading', data: null, message: '' }); setRetry(value => value + 1) }}>ลองใหม่</button>
            </p>
          )}
      </DialogShell>
    )
  }

  const d = state.data
  // ไม่ส่ง attachments (รูปผู้แจ้ง) เข้ากล่องเลย — RPC ก็ไม่คืนมาอยู่แล้ว
  const complaint = {
    id: d.id, ref_no: d.ref, category: d.category, village: d.village, created_at: d.created_at, closed_at: d.closed_at, due_date: d.due_date,
    work_photos: Array.isArray(d.work_photos) ? d.work_photos : [],
  }
  return (
    <NewsDialogBody source="exec" complaint={complaint} tenant={tenant} departmentName={d.dept ?? ''} categoryLabel={d.cat_label ?? ''}
      closedAt={d.closed_at} execNote={d.note ?? ''} onClose={onClose} />
  )
}

function NewsDialogBody({ source, complaint: c, tenant, departmentName = '', categoryLabel = '', closedAt = null, execNote = '', onClose }) {
  const isExec = source === 'exec'
  const tenantName = tenant?.name ?? ''
  const reportUrl = useMemo(() => appUrl('/complaint'), [])
  const workRefs = useMemo(() => (c.work_photos ?? []).filter(Boolean).slice(0, MAX_CANDIDATES), [c.work_photos])
  const reporterRefs = useMemo(() => (isExec ? [] : (c.attachments ?? []).filter(Boolean).slice(0, MAX_CANDIDATES)), [isExec, c.attachments])

  const [headline, setHeadline] = useState(() => draftHeadline({ departmentName, tenantName, categoryLabel, village: c.village }))
  const [timelineRow, setTimelineRow] = useState(null)
  const [detailEdit, setDetailEdit] = useState(null)
  const [statusOn, setStatusOn] = useState(true)
  // QR + ลิงก์แจ้งเรื่องในแถบท้าย (ติ๊กไว้ก่อน) · ปิด = แถบท้ายเป็นข้อความขอบคุณ และข้อความที่แชร์ไม่มีลิงก์
  const [linkOn, setLinkOn] = useState(true)
  const [durationEdit, setDurationEdit] = useState(null)
  // รูปที่เลือก: ใช้ "กลุ่ม:ลำดับ" เป็นคีย์ (รูปผลงานติ๊กไว้ก่อน สูงสุด 4 · รูปผู้แจ้งไม่ติ๊กไว้ก่อน)
  const [picked, setPicked] = useState(() => new Set(workRefs.slice(0, MAX_NEWS_PHOTOS).map((_, i) => `w:${i}`)))
  const [loaded, setLoaded] = useState({})
  const [mayorEdit, setMayorEdit] = useState(null)
  const { logo, branding, mayorPhoto, officePhoto, officeIsTemplate } = useNewsBranding(tenant)
  // ที่อยู่บนป้ายรูปแม่แบบ — แยกเป็นค่าเดี่ยวไว้ใส่ dependency ของ useMemo
  const officeDistrict = tenant?.district ?? null
  const officeProvince = tenant?.province ?? null
  // สีธีมตามสีกอง (หาไม่เจอ = ส้ม) · staff: departmentName มาจาก complaint.department · exec: d.dept
  const theme = useDepartmentTheme(tenant?.id, departmentName)

  // บันทึกผลตอนปิดงาน = แถว complaint_timeline สถานะ closed ล่าสุดของเรื่องนี้ (finish_complaint เขียนไว้ทุกครั้ง)
  useEffect(() => {
    if (isExec) return undefined
    let alive = true
    supabase.from('complaint_timeline')
      .select('note, created_at')
      .eq('complaint_id', c.id)
      .eq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) console.error('complaint_timeline load error:', error.message)
        setTimelineRow(data?.[0] ?? null)
      }, () => {})
    return () => { alive = false }
  }, [c.id, isExec])

  // รูปทั้งหมดที่เลือกได้ — โหลดไม่ได้ = ข้าม
  useEffect(() => {
    let alive = true
    const refs = [...workRefs.map((ref, i) => [`w:${i}`, ref]), ...reporterRefs.map((ref, i) => [`a:${i}`, ref])]
    for (const [key, ref] of refs) {
      loadImage(ref).then(result => { if (alive) setLoaded(prev => ({ ...prev, [key]: result })) })
    }
    return () => { alive = false }
  }, [workRefs, reporterRefs])

  const detail = detailEdit ?? (isExec ? execNote : (timelineRow?.note ?? c.technician_note ?? ''))
  const closed = closedAt ?? timelineRow?.created_at ?? c.closed_at
  // บล็อกนายก: มีรูปหรือชื่อ = ติ๊กไว้ก่อน (แก้ได้) · ไม่มีทั้งคู่ = ไม่มี checkbox · ตำแหน่งว่างใช้ชื่อตำแหน่งสำรองชุดเดียวกับช่องนายกในใบพิมพ์ (orgHeadTitle)
  const hasMayorData = !!(branding?.photo_url || branding?.mayor_name)
  const mayorOn = hasMayorData && (mayorEdit ?? true)
  const executive = useMemo(() => (mayorOn
    ? { name: branding?.mayor_name ?? '', title: branding?.mayor_title || orgHeadTitle(tenant) }
    : null), [mayorOn, branding?.mayor_name, branding?.mayor_title, tenant])
  const durationOn = durationEdit ?? defaultShowDuration({ closedAt: closed, dueDate: c.due_date })

  const model = useMemo(() => buildNewsModel({
    complaint: c, tenantName, departmentName, categoryLabel, categoryCode: c.category ?? '', closedAt: closed, createdAt: c.created_at, dueDate: c.due_date,
    showStatus: statusOn, showDuration: durationOn, headline, detail, reportUrl: linkOn ? reportUrl : '', executive, theme,
  }), [c, tenantName, departmentName, categoryLabel, closed, statusOn, durationOn, headline, detail, reportUrl, linkOn, executive, theme])
  const deferredModel = useDeferredValue(model)

  // รูปที่เลือกเรียงตามลำดับ + ชนิดรูปคู่กัน: w: = รูปผลงานเจ้าหน้าที่ (หลังดำเนินการ) · a: = รูปจากผู้แจ้ง (ก่อนดำเนินการ) — ป้ายมุมรูปต้องตรงความจริง
  const pickedPhotos = useMemo(() => {
    const keys = [...workRefs.map((_, i) => `w:${i}`), ...reporterRefs.map((_, i) => `a:${i}`)]
    return keys.filter(key => picked.has(key)).map(key => ({ dataUrl: loaded[key]?.dataUrl ?? null, kind: key.startsWith('w:') ? 'after' : 'before' }))
  }, [picked, loaded, workRefs, reporterRefs])
  const photoDataUrls = useMemo(() => pickedPhotos.map(photo => photo.dataUrl), [pickedPhotos])
  const photoKinds = useMemo(() => pickedPhotos.map(photo => photo.kind), [pickedPhotos])

  const newsFont = useNewsFont()
  const image = useMemo(() => {
    if (!newsFont.ready) return null
    const { font } = newsFont
    try {
      return buildNewsSvg(deferredModel, createCanvasMeasure(font ? newsFontStack(font.family) : undefined), {
        font, logoDataUrl: logo, photoDataUrls, photoKinds, executivePhotoDataUrl: mayorOn ? mayorPhoto : null, officePhotoDataUrl: officePhoto,
        // รูปแม่แบบ = วาดชื่อ อปท./อำเภอ/จังหวัดทับ · รูปที่ อปท. อัปโหลดเอง = ไม่วาดทับ
        officeTemplate: officeIsTemplate ? { district: officeDistrict, province: officeProvince } : null })
    } catch {
      return null
    }
  }, [newsFont, deferredModel, logo, photoDataUrls, photoKinds, mayorOn, mayorPhoto, officePhoto, officeIsTemplate, officeDistrict, officeProvince])
  const fileName = `news-${String(c.ref_no ?? c.id).replace(/[^A-Za-z0-9_-]+/g, '-')}.png`
  const png = usePreparedPng(image, fileName)

  function toggle(key) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < MAX_NEWS_PHOTOS) next.add(key)
      return next
    })
  }

  const failedCount = Object.values(loaded).filter(item => !item.dataUrl).length
  const stillLoading = workRefs.length + reporterRefs.length - Object.keys(loaded).length
  const photoGroup = (refs, prefix) => (
    <div className="grid grid-cols-4 gap-1.5">
      {refs.map((_, i) => {
        const key = `${prefix}:${i}`
        const item = loaded[key]
        const on = picked.has(key)
        const blocked = !on && picked.size >= MAX_NEWS_PHOTOS
        return (
          <label key={key} className={`relative aspect-square overflow-hidden rounded-xl border-2 bg-gray-100 ${on ? 'border-orange-500' : 'border-transparent'} ${blocked || (item && !item.dataUrl) ? 'opacity-40' : 'cursor-pointer'}`}>
            {item?.dataUrl
              ? <img src={item.dataUrl} alt="" className="h-full w-full object-cover" />
              : <span className="flex h-full w-full items-center justify-center text-[10px] text-gray-500">{item ? 'โหลดไม่ได้' : <Loader2 size={14} className="animate-spin" />}</span>}
            <input type="checkbox" className="absolute left-1 top-1 h-4 w-4 accent-orange-600" checked={on}
              disabled={blocked || !item?.dataUrl} onChange={() => toggle(key)} aria-label={`เลือกรูปที่ ${i + 1}`} />
          </label>
        )
      })}
    </div>
  )

  return (
    <DialogShell onClose={onClose}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-base font-bold text-gray-800"><Megaphone size={16} style={{ color: '#c2410c' }} /> ภาพข่าวประชาสัมพันธ์</p>
            <p className="mt-0.5 text-xs text-gray-500">ดาวน์โหลดหรือแชร์ลง LINE/เพจได้ · ในภาพไม่มีชื่อ เบอร์ หรือที่อยู่ของผู้แจ้ง</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-gray-100" aria-label="ปิด"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="news-headline" className="text-xs font-semibold text-gray-600">ข้อความข่าว <span className="font-normal text-gray-400">(ระบบร่างให้ แก้ได้)</span></label>
              <textarea id="news-headline" value={headline} onChange={e => setHeadline(e.target.value)} rows={4} maxLength={400}
                className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-200" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="news-detail" className="text-xs font-semibold text-gray-600">รายละเอียด <span className="font-normal text-gray-400">(บันทึกผลตอนปิดงาน · เว้นว่างได้ · ตรวจว่าไม่มีชื่อ/เบอร์ผู้แจ้งก่อนเผยแพร่)</span></label>
              <textarea id="news-detail" value={detail} onChange={e => setDetailEdit(e.target.value)} rows={3} maxLength={1000}
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
                แสดง "{model.durationLabel || 'ใช้เวลา — วันทำการ'}"
              </label>
              <p className="text-[11px] text-gray-500">ระบบติ๊กให้เองเมื่อเสร็จทันกำหนด · เกินกำหนดจะไม่ติ๊กไว้ก่อน</p>
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

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600">
                รูปในภาพ ({picked.size}/{MAX_NEWS_PHOTOS}) <span className="font-normal text-gray-400">· รูปหลังดำเนินการ</span>
              </p>
              {workRefs.length > 0 ? photoGroup(workRefs, 'w') : <p className="text-xs text-gray-500">ยังไม่มีรูปหลังดำเนินการ</p>}
              {!isExec && reporterRefs.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs font-semibold text-gray-600">รูปจากผู้แจ้ง</p>
                  <p className="flex gap-1.5 rounded-xl border border-orange-200 bg-orange-50 p-2.5 text-xs font-medium text-orange-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>เลือกรูปจากผู้แจ้ง: ตรวจก่อนว่าไม่มีหน้าคน ป้ายทะเบียน หรือเลขที่บ้าน รูปนี้ผู้แจ้งส่งมาเพื่อแจ้งเรื่อง ไม่ได้ส่งมาเพื่อลงเพจ</span>
                  </p>
                  {photoGroup(reporterRefs, 'a')}
                </div>
              )}
              {stillLoading > 0 && <p role="status" className="text-[11px] text-gray-500">กำลังโหลดรูป...</p>}
              {failedCount > 0 && <p className="text-[11px] text-red-600">มี {failedCount} รูปที่โหลดไม่สำเร็จ ระบบข้ามรูปนั้นให้</p>}
            </div>
          </div>

          <NewsOutputPanel image={image} model={model} tenantName={tenantName} file={png.file} error={png.error} onRetry={png.retry} />
        </div>
    </DialogShell>
  )
}
