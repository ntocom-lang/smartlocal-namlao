import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, ChevronRight, Copy, Loader2,
  Minus, PackageOpen, Plus, Search,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { notifyTelegram } from '../lib/notifyTelegram'
import { NAME_TITLES, joinThaiFullName, splitThaiFullName } from '../lib/thaiName'
import { thaiDateFromDateInput } from '../lib/thaiDate'
import { tenantDefaultSubdistrict } from '../lib/tenantSubdistrict'

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-200'

// ประเภทผู้ยืมตามที่ใบ บย. แยกได้จริง — ช่อง "ตำแหน่ง" บนใบมีความหมายต่างกันสามแบบ
// บุคคลทั่วไปเว้นว่างได้ ไม่ใช่ข้อบังคับ
const BORROWER_TYPES = [
  { value: 'citizen',    label: 'ประชาชนทั่วไป',        hint: 'ยืมในนามตนเอง' },
  { value: 'internal',   label: 'บุคลากรของหน่วยงาน',   hint: 'เจ้าหน้าที่ อปท. นี้' },
  { value: 'government', label: 'หน่วยงานราชการอื่น',   hint: 'โรงเรียน กำนัน ผู้ใหญ่บ้าน ฯลฯ' },
]

function todayInput() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
}

function addDaysInput(value, days) {
  const at = new Date(`${value}T00:00:00`)
  at.setDate(at.getDate() + days)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(at)
}

function addressPart(address, prefix) {
  if (!address) return ''
  const match = String(address).match(new RegExp(`${prefix}\\s*([^\\s]+)`))
  return match?.[1]?.trim() || ''
}

function Field({ label, required, children, className = '' }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-semibold text-gray-500">
        {label}{required && <span className="text-rose-600"> *</span>}
      </label>
      {children}
    </div>
  )
}

function StepDots({ step }) {
  return (
    <div className="mb-5 flex items-center justify-center gap-2">
      {[1, 2, 3].map(n => (
        <span key={n}
          className={`h-2 rounded-full transition-all ${
            n === step ? 'w-7 bg-teal-600' : n < step ? 'w-2 bg-teal-300' : 'w-2 bg-gray-200'
          }`} />
      ))}
    </div>
  )
}

/**
 * แบบคำขอยืมพัสดุ/ครุภัณฑ์ — ตรงกับ "ใบยืมพัสดุ/ครุภัณฑ์" (บย.) ที่ อปท. ใช้อยู่
 *
 * ต่างจาก wizard ใบอื่นในระบบตรงที่ **ไม่ได้ insert document_requests ตรงๆ**
 * แต่เรียก RPC create_asset_borrow_request() เพราะหนึ่งคำขอต้องเขียน 3 ตารางพร้อมกัน
 * (parent + header + รายการของ) ถ้าเขียนทีละตารางจากฝั่ง client แล้วเน็ตหลุดกลางทาง
 * จะได้คำขอที่ไม่มีรายการของ ซึ่งเจ้าหน้าที่พิจารณาไม่ได้และลบเองก็ไม่ได้
 *
 * ⚠️ รุ่นแรกบังคับ 1 คำขอ = 1 กองเจ้าของพัสดุ — ใบ บย. มีช่อง "ไปจากส่วนราชการ" ช่องเดียว
 * และแต่ละกองออกเลข บย. ในทะเบียนของตัวเอง หน้าจอจึงล็อกกองทันทีที่หยิบของชิ้นแรก
 * แล้วบอกให้ผู้ยื่นแยกคำขอ ไม่ใช่ปล่อยให้เลือกข้ามกองแล้วไปเด้ง error ตอนกดส่ง
 *
 * ⚠️ ห้ามเขียนข้อความทำนองว่า "ยื่นแล้วนำของออกได้เลย" — ใบต้นฉบับต้องผ่านความเห็นปลัดฯ
 * และอนุมัติโดยนายกฯ (ผู้ให้ยืม) ก่อนเสมอ การยื่นในระบบเป็นแค่การขอ
 *
 * ⚠️ ไม่มีข้อความ "ยืนยันว่าใช้เพื่อประโยชน์ของทางราชการ" ในหน้ายืนยัน — ระบบนี้เปิดให้
 * ประชาชนยืมด้วย ซึ่งไม่ใช่การใช้เพื่อราชการ การบังคับติ๊กข้อความนั้นจะทำให้ประชาชน
 * ต้องรับรองข้อความเท็จ ข้อความที่ใช้จึงยึดตามที่ปรากฏบนใบ บย. จริงเท่านั้น
 * (ความรับผิดกรณีชำรุด สูญหาย หรือใช้การไม่ได้)
 */
export default function AssetBorrowRequestWizard({ tenant, session, onBack, staffId, onDone }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [done, setDone] = useState(null)

  const [assets, setAssets] = useState([])
  const [assetsState, setAssetsState] = useState('idle') // idle | loading | ready | error
  const [assetsError, setAssetsError] = useState('')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState({}) // assetId -> จำนวน

  const [form, setForm] = useState(() => {
    const start = todayInput()
    return {
      form_type: 'asset_borrow_request',
      form_version: 1,
      borrower_type: 'citizen',
      title: '', first: '', last: '',
      position: '',
      org: '',
      phone: '',
      addr_no: '', addr_moo: '',
      addr_subdistrict: '', addr_district: '', addr_province: '',
      purpose: '',
      place_of_use: '',
      borrow_start_date: start,
      return_due_date: addDaysInput(start, 2),
    }
  })

  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }))

  // เติมค่าที่อยู่ตั้งต้นจากข้อมูล อปท. เหมือนใบคำร้องอื่น
  useEffect(() => {
    if (!tenant) return
    setForm(current => ({
      ...current,
      addr_subdistrict: current.addr_subdistrict || tenantDefaultSubdistrict(tenant) || addressPart(tenant.address, 'ตำบล'),
      addr_district: current.addr_district || tenant.district?.trim() || addressPart(tenant.address, 'อำเภอ'),
      addr_province: current.addr_province || tenant.province?.trim() || addressPart(tenant.address, 'จังหวัด'),
    }))
  }, [tenant])

  useEffect(() => {
    if (!session) return
    supabase.from('profiles')
      .select('full_name, phone, job_title, address_detail, address_moo')
      .eq('id', session.user.id).single()
      .then(({ data: profile }) => {
        if (!profile) return
        const { title, first, last } = splitThaiFullName(profile.full_name)
        setForm(current => ({
          ...current,
          title, first, last,
          phone: profile.phone ?? '',
          position: profile.job_title ?? '',
          addr_no: profile.address_detail ?? '',
          addr_moo: profile.address_moo ?? '',
        }))
      })
  }, [session])

  // จำนวนของว่างขึ้นกับ "ช่วงวันที่" ที่ขอ จึงต้องโหลดใหม่ทุกครั้งที่วันที่เปลี่ยน
  const loadAssets = useCallback(async () => {
    if (!tenant?.id || !form.borrow_start_date || !form.return_due_date) return
    setAssetsState('loading')
    const { data, error } = await supabase.rpc('list_borrowable_assets', {
      p_municipality_id: tenant.id,
      p_start: form.borrow_start_date,
      p_end: form.return_due_date,
    })
    if (error) {
      setAssetsState('error')
      setAssetsError(error.message)
      return
    }
    setAssets(data ?? [])
    setAssetsState('ready')
  }, [tenant?.id, form.borrow_start_date, form.return_due_date])

  useEffect(() => { if (step === 2) loadAssets() }, [step, loadAssets])

  // เลือกข้ามกองได้แล้ว (2569-09-11) — ของที่ อปท. เปิดให้ยืมกระจายอยู่หลายกองจริง
  // การบังคับให้ประชาชนยื่นทีละกองคือการผลักภาระจากโครงสร้างภายในของ อปท. ไปให้เขา
  // ระบบแตกใบตามกองให้เองตอนกดส่งผ่าน create_asset_borrow_batch — ยังต้องแตกอยู่เพราะ
  // ใบ บย. มีช่อง "ไปจากส่วนราชการ" และช่องผู้จ่ายของ/ผู้รับคืนชุดเดียว ใบเดียวหลายกอง
  // พิมพ์ออกมาแล้วไม่มีใครเซ็นได้ครบ และสิทธิ์ asset_staff ก็ผูกกับกองตัวเอง

  const visibleAssets = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return assets
    return assets.filter(a =>
      a.name.toLowerCase().includes(keyword)
      || (a.asset_code ?? '').toLowerCase().includes(keyword)
      || (a.department_name ?? '').toLowerCase().includes(keyword))
  }, [assets, search])

  const cartLines = useMemo(
    () => Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ asset: assets.find(a => a.id === id), qty }))
      .filter(line => line.asset),
    [cart, assets],
  )

  // จัดของที่เลือกเป็นกลุ่มตามกองเจ้าของพัสดุ = 1 กลุ่ม 1 ใบยืม
  // ⚠️ ใช้ '__none__' แทน null เป็นคีย์ Map เพราะของที่ยังไม่ผูกกอง (department_id = NULL)
  // ต้องรวมเป็นกลุ่มเดียวกันได้ ถ้าใช้ null ตรงๆ จะกลายเป็นคีย์ "null" ปนกับกองชื่อ null ไม่ได้
  const cartGroups = useMemo(() => {
    const map = new Map()
    for (const line of cartLines) {
      const key = line.asset.department_id ?? '__none__'
      if (!map.has(key)) {
        map.set(key, {
          key,
          departmentId: line.asset.department_id ?? null,
          departmentName: line.asset.department_name || 'ไม่ระบุกอง',
          lines: [],
        })
      }
      map.get(key).lines.push(line)
    }
    return [...map.values()]
  }, [cartLines])

  function changeQty(asset, delta) {
    setCart(current => {
      const next = (current[asset.id] ?? 0) + delta
      if (next <= 0) {
        const rest = { ...current }
        delete rest[asset.id]
        return rest
      }
      return { ...current, [asset.id]: Math.min(next, asset.available_qty) }
    })
  }

  const applicantName = joinThaiFullName(form.title, form.first, form.last)

  function step1Valid() {
    return form.first.trim() && form.last.trim() && form.phone.trim()
      && form.purpose.trim() && form.borrow_start_date && form.return_due_date
      && form.return_due_date >= form.borrow_start_date
  }

  async function handleSubmit() {
    if (cartLines.length === 0) return
    setSaving(true)
    // 1 กอง = 1 ใบ = 1 request_id ทั้งหมดผูกกันด้วย batchId เดียว
    // ⚠️ id สร้างจากฝั่ง client เหมือนเดิม เพื่อให้ยิงซ้ำตอนเน็ตหลุดแล้วไม่เกิดคำขอซ้ำ
    // (create_asset_borrow_request เป็น idempotent ตาม request_id)
    const batchId = crypto.randomUUID()
    const groups = cartGroups.map(group => ({
      ...group,
      requestId: crypto.randomUUID(),
    }))
    const requestId = groups[0].requestId
    const submittedAt = new Date().toISOString()
    const channel = session && !staffId ? 'online' : 'counter'

    const address = [
      form.addr_no.trim() && `บ้านเลขที่ ${form.addr_no.trim()}`,
      form.addr_moo.trim() && `หมู่ที่ ${form.addr_moo.trim()}`,
      form.addr_subdistrict.trim() && `ตำบล${form.addr_subdistrict.trim()}`,
      form.addr_district.trim() && `อำเภอ${form.addr_district.trim()}`,
      form.addr_province.trim() && `จังหวัด${form.addr_province.trim()}`,
    ].filter(Boolean).join(' ')

    // permit_form_data = snapshot ตอนยื่นที่ห้ามแก้ ใช้พิมพ์ใบให้เหมือนวันที่ยื่นเสมอ
    // ส่วนค่าที่เจ้าหน้าที่แก้ได้ (วันกำหนดคืน จำนวนที่อนุมัติ) อยู่ในตาราง ไม่ใช่ในนี้
    const snapshot = {
      form_type: 'asset_borrow_request',
      form_version: 1,
      borrower_type: form.borrower_type,
      // จำนวนใบทั้งหมดในชุด ณ วันยื่น — เก็บใน snapshot เพราะหน้า "เอกสารของฉัน" อ่าน
      // permit_form_data อยู่แล้ว ไม่ต้องยิง query เพิ่มทั้งหน้าเพื่อบอกแค่ว่า "1 ใน 2 ใบ"
      // ⚠️ ค่านี้เท่ากันทุกใบในชุด จึงบอกได้แค่จำนวนรวม ไม่ได้บอกว่าใบนี้เป็นใบที่เท่าไร
      batch_total: cartGroups.length,
      applicant: {
        title: form.title, first: form.first.trim(), last: form.last.trim(),
        position: form.position.trim(), org: form.org.trim(), phone: form.phone.trim(),
        addr_no: form.addr_no.trim(), addr_moo: form.addr_moo.trim(),
        addr_subdistrict: form.addr_subdistrict.trim(),
        addr_district: form.addr_district.trim(),
        addr_province: form.addr_province.trim(),
      },
      purpose: form.purpose.trim(),
      place_of_use: form.place_of_use.trim(),
      borrow_start_date: form.borrow_start_date,
      return_due_date: form.return_due_date,
      acknowledgement: 'ยินดีจัดการแก้ไขซ่อมแซมให้คงสภาพเดิมโดยเสียค่าใช้จ่ายของตนเอง '
        + 'หรือชดใช้เป็นพัสดุประเภท ชนิด ขนาด ลักษณะ และคุณภาพอย่างเดียวกัน '
        + 'หรือชดใช้เป็นเงินตามราคาที่เป็นอยู่ในขณะที่ยืม ตามหลักเกณฑ์ที่กระทรวงการคลังกำหนด',
      signed_at: submittedAt,
      signed_by: {
        channel,
        name: applicantName,
        user_id: channel === 'online' ? (session?.user?.id ?? null) : null,
        entered_by_staff_id: staffId ?? null,
      },
    }

    const payload = {
      borrower_type: form.borrower_type,
      borrower_name: applicantName,
      borrower_position: form.position.trim(),
      borrower_org: form.org.trim(),
      borrower_phone: form.phone.trim(),
      borrower_address: address,
      purpose: form.purpose.trim(),
      place_of_use: form.place_of_use.trim(),
      borrow_start_date: form.borrow_start_date,
      return_due_date: form.return_due_date,
      acknowledged_terms: true,
      staff_entry: Boolean(staffId),
      form_snapshot: snapshot,
    }
    const itemsOf = group => group.lines.map(line => ({
      asset_id: line.asset.id,
      requested_qty: line.qty,
    }))

    // ⚠️ กองเดียวต้องเรียก RPC เดิม ไม่ใช่ตัวชุด — ลำดับ deploy: ถ้าโค้ดนี้ขึ้นก่อน migration
    // create_asset_borrow_batch ยังไม่มีในฐานข้อมูล การยื่นทุกใบจะพังทั้งระบบ รวมถึงกรณีกองเดียว
    // ที่ใช้งานได้อยู่แล้วทุกวันนี้ แยกทางไว้แบบนี้ ความเสี่ยงจำกัดอยู่แค่กรณีข้ามกองซึ่งเป็นของใหม่
    // ผลพลอยได้: คำขอกองเดียวได้ batch_id = NULL ตรงกับความหมายในคอมเมนต์ของคอลัมน์
    const { error } = groups.length === 1
      ? await supabase.rpc('create_asset_borrow_request', {
        p_request_id: groups[0].requestId,
        p_payload: payload,
        p_items: itemsOf(groups[0]),
      })
      : await supabase.rpc('create_asset_borrow_batch', {
        p_batch_id: batchId,
        p_payload: payload,
        p_groups: groups.map(group => ({ request_id: group.requestId, items: itemsOf(group) })),
      })

    setSaving(false)
    if (error) {
      // ข้อความจาก RAISE EXCEPTION ในฟังก์ชันเป็นภาษาไทยอยู่แล้ว แสดงตรงๆ ได้
      alert(`ยื่นคำขอไม่สำเร็จ: ${error.message}`)
      return
    }
    // แจ้งเตือนทุกใบ — แต่ละใบวิ่งไปคนละกอง เจ้าหน้าที่กองที่ไม่ได้รับแจ้งจะไม่รู้ว่ามีคำขอเข้า
    for (const group of groups) notifyTelegram('document_request_created', group.requestId)
    setDone({
      ref: requestId.slice(0, 8).toUpperCase(),
      lines: cartLines,
      snapshot,
      // ใบทั้งหมดในชุด ใช้แสดงเลขอ้างอิงให้ครบ ผู้ยื่นจะได้ตามสถานะถูกใบ
      tickets: groups.map(group => ({
        ref: group.requestId.slice(0, 8).toUpperCase(),
        departmentName: group.departmentName,
        count: group.lines.length,
      })),
    })
  }

  // ต้องล็อกอิน — คำขอนี้ผูกความรับผิดกรณีของชำรุด/สูญหายไว้กับตัวผู้ยืม ถ้ายื่นได้โดยไม่
  // ยืนยันตัวตน อปท. จะไม่รู้ว่าจะไปเรียกให้ใครชดใช้ และผู้ยื่นก็ตามสถานะเองไม่ได้ (RLS)
  if (!session && !staffId) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4" style={{ backgroundColor: '#eef2f7' }}>
        <div className="w-full max-w-sm rounded-3xl border border-gray-100 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-50">
            <PackageOpen size={30} className="text-teal-700" />
          </div>
          <h2 className="mb-2 text-lg font-bold text-gray-800">เข้าสู่ระบบก่อนยื่นคำขอ</h2>
          <p className="mb-6 text-sm leading-relaxed text-gray-500">
            การยืมพัสดุผูกความรับผิดกรณีของชำรุด สูญหาย หรือใช้การไม่ได้ ไว้กับตัวผู้ยืม
            จึงต้องเข้าสู่ระบบเพื่อยืนยันตัวตน และให้ท่านติดตามสถานะได้
          </p>
          <button type="button"
            onClick={() => navigate('/auth', { state: { from: '/doc-request?type=asset_borrow_request' } })}
            className="w-full rounded-2xl bg-teal-700 py-3.5 text-sm font-bold text-white">
            เข้าสู่ระบบ / สมัครสมาชิก
          </button>
          <button type="button" onClick={onBack}
            className="mt-2 w-full rounded-2xl py-3 text-sm font-semibold text-gray-500">
            ย้อนกลับ
          </button>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-8" style={{ backgroundColor: '#eef2f7' }}>
        <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 size={32} className="text-emerald-600" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-gray-800">ยื่นคำขอยืมสำเร็จ</h2>

          {/* ⚠️ ต้องบอกให้ชัดที่สุดว่ายังนำของออกไม่ได้ — ใบต้นฉบับต้องผ่านความเห็นปลัดฯ
              และอนุมัติโดยนายกฯ ก่อน คนที่เข้าใจผิดแล้วขับรถมารับของจะเสียเที่ยวฟรี */}
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-xs leading-relaxed text-amber-900">
                <span className="font-bold">นี่คือการยื่นคำขอ ยังไม่ใช่การอนุญาต</span> —
                ต้องผ่านความเห็นปลัดฯ และอนุมัติโดยนายกฯ ก่อน
                กรุณารอเจ้าหน้าที่แจ้งผลก่อนเดินทางมารับของ
              </p>
            </div>
          </div>

          <div className="mb-5 rounded-2xl bg-gray-50 p-4 text-left">
            <p className="mb-2 text-xs text-gray-400">รายการที่ขอยืม</p>
            <ul className="space-y-1">
              {done.lines.map(line => (
                <li key={line.asset.id} className="flex justify-between gap-3 text-sm text-gray-700">
                  <span className="min-w-0 truncate">{line.asset.name}</span>
                  <span className="shrink-0 font-semibold">{line.qty} {line.asset.unit}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-gray-200 pt-2 text-xs text-gray-500">
              ใช้ตั้งแต่ {thaiDateFromDateInput(done.snapshot.borrow_start_date)}
              {' · '}กำหนดคืน {thaiDateFromDateInput(done.snapshot.return_due_date)}
            </p>
          </div>

          {/* ⚠️ ของจากหลายกองได้เลขอ้างอิงหลายเลข ต้องโชว์ให้ครบ ไม่ใช่โชว์ใบแรกใบเดียว
              ผู้ยื่นที่ถือเลขเดียวไปถามเจ้าหน้าที่กองอื่นจะกลายเป็น "ไม่พบคำขอ" */}
          {done.tickets && done.tickets.length > 1 ? (
            <div className="mb-5 space-y-2">
              <p className="text-xs text-gray-400">
                แยกเป็น {done.tickets.length} ใบตามกองเจ้าของพัสดุ — แต่ละใบมีเลขอ้างอิงของตัวเอง
              </p>
              {done.tickets.map(ticket => (
                <div key={ticket.ref} className="rounded-2xl bg-gray-50 p-3 text-left">
                  <p className="text-[11px] text-gray-400">{ticket.departmentName} · {ticket.count} รายการ</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-lg font-bold tracking-widest text-gray-800">{ticket.ref}</p>
                    <button type="button"
                      onClick={() => { navigator.clipboard.writeText(ticket.ref); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                      className="flex items-center gap-1.5 text-xs text-blue-600">
                      <Copy size={13} /> คัดลอก
                    </button>
                  </div>
                </div>
              ))}
              {copied && <p className="text-xs text-emerald-600">คัดลอกแล้ว</p>}
            </div>
          ) : (
            <div className="mb-5 rounded-2xl bg-gray-50 p-4">
              <p className="mb-1.5 text-xs text-gray-400">หมายเลขอ้างอิง</p>
              <p className="text-2xl font-bold tracking-widest text-gray-800">{done.ref}</p>
              <button type="button"
                onClick={() => { navigator.clipboard.writeText(done.ref); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                className="mx-auto mt-2.5 flex items-center gap-1.5 text-xs text-blue-600">
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
              </button>
            </div>
          )}

          <button type="button" onClick={() => (onDone ? onDone() : navigate('/my-doc-requests'))}
            className="min-h-[44px] w-full rounded-2xl bg-teal-700 text-sm font-bold text-white">
            {onDone ? 'เสร็จสิ้น' : 'ดูสถานะคำขอของฉัน'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-8" style={{ backgroundColor: '#eef2f7' }}>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3 shadow-sm">
        <button onClick={() => (step === 1 ? onBack() : setStep(step - 1))}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100">
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold text-gray-800">ขอยืมพัสดุ/ครุภัณฑ์</h1>
          <p className="truncate text-[11px] text-gray-400">
            {step === 1 ? 'ข้อมูลผู้ยืมและวัตถุประสงค์' : step === 2 ? 'เลือกพัสดุที่ต้องการยืม' : 'ตรวจสอบและยืนยัน'}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-5">
        <StepDots step={step} />

        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-100 bg-white p-4">
              <Field label="ท่านยืมในฐานะใด" required>
                <div className="grid gap-2 sm:grid-cols-3">
                  {BORROWER_TYPES.map(type => (
                    <button key={type.value} type="button"
                      onClick={() => setForm(c => ({ ...c, borrower_type: type.value }))}
                      className={`min-h-[44px] rounded-xl border px-3 py-2 text-left ${
                        form.borrower_type === type.value
                          ? 'border-teal-500 bg-teal-50' : 'border-gray-200 bg-white'
                      }`}>
                      <span className="block text-sm font-semibold text-gray-800">{type.label}</span>
                      <span className="block text-[11px] text-gray-400">{type.hint}</span>
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4">
              <h2 className="text-sm font-bold text-gray-800">ข้อมูลผู้ยืม</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="คำนำหน้า">
                  <select className={inputCls} value={form.title} onChange={set('title')}>
                    <option value="">—</option>
                    {NAME_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="ชื่อ" required>
                  <input className={inputCls} value={form.first} onChange={set('first')} />
                </Field>
                <Field label="นามสกุล" required>
                  <input className={inputCls} value={form.last} onChange={set('last')} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="ตำแหน่ง">
                  <input className={inputCls} value={form.position} onChange={set('position')}
                    placeholder="เว้นว่างได้ถ้ายืมในนามส่วนตัว" />
                </Field>
                <Field label="สังกัด/หน่วยงาน">
                  <input className={inputCls} value={form.org} onChange={set('org')}
                    placeholder="เว้นว่างได้ถ้ายืมในนามส่วนตัว" />
                </Field>
              </div>
              <Field label="เบอร์โทรศัพท์" required>
                <input className={inputCls} type="tel" inputMode="tel"
                  value={form.phone} onChange={set('phone')} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="บ้านเลขที่">
                  <input className={inputCls} value={form.addr_no} onChange={set('addr_no')} />
                </Field>
                <Field label="หมู่ที่">
                  <input className={inputCls} value={form.addr_moo} onChange={set('addr_moo')} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="ตำบล">
                  <input className={inputCls} value={form.addr_subdistrict} onChange={set('addr_subdistrict')} />
                </Field>
                <Field label="อำเภอ">
                  <input className={inputCls} value={form.addr_district} onChange={set('addr_district')} />
                </Field>
                <Field label="จังหวัด">
                  <input className={inputCls} value={form.addr_province} onChange={set('addr_province')} />
                </Field>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4">
              <h2 className="text-sm font-bold text-gray-800">วัตถุประสงค์และกำหนดเวลา</h2>
              <Field label="ยืมไปเพื่อ" required>
                <input className={inputCls} value={form.purpose} onChange={set('purpose')}
                  maxLength={500} placeholder="เช่น ใช้ในงานบุญประจำปีของหมู่บ้าน" />
              </Field>
              <Field label="สถานที่ที่นำไปใช้">
                <input className={inputCls} value={form.place_of_use} onChange={set('place_of_use')}
                  placeholder="เช่น ศาลาประชาคม หมู่ 3" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="ตั้งแต่วันที่" required>
                  <input className={inputCls} type="date" value={form.borrow_start_date}
                    min={todayInput()}
                    onChange={event => {
                      const start = event.target.value
                      setForm(c => ({
                        ...c,
                        borrow_start_date: start,
                        return_due_date: c.return_due_date < start ? start : c.return_due_date,
                      }))
                    }} />
                </Field>
                <Field label="กำหนดส่งคืนวันที่" required>
                  <input className={inputCls} type="date" value={form.return_due_date}
                    min={form.borrow_start_date} onChange={set('return_due_date')} />
                </Field>
              </div>
              <p className="text-[11px] leading-relaxed text-gray-400">
                จำนวนของที่ว่างคำนวณจากช่วงวันที่นี้ — ของที่คนอื่นจองไว้คนละช่วงเวลายังยืมได้
              </p>
            </div>

            <button type="button" disabled={!step1Valid()} onClick={() => setStep(2)}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-teal-700 text-sm font-bold text-white disabled:bg-gray-300">
              เลือกพัสดุที่ต้องการยืม <ChevronRight size={16} />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className={`${inputCls} pl-9`} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อของ รหัส หรือกอง" />
            </div>

            {/* บอกล่วงหน้าตั้งแต่ตอนเลือกว่าจะได้ใบกี่ใบ ไม่ใช่ไปเซอร์ไพรส์ตอนกดส่งเสร็จ
                ผู้ยื่นจะได้รู้ว่าต้องตามสถานะหลายใบ และไม่คิดว่าระบบยื่นซ้ำให้เอง */}
            {cartGroups.length > 1 && (
              <div className="rounded-2xl border border-teal-200 bg-teal-50 p-3 text-xs leading-relaxed text-teal-900">
                ท่านเลือกของจาก <span className="font-bold">{cartGroups.length} กอง</span> —
                ระบบจะแยกเป็นใบยืม {cartGroups.length} ใบให้อัตโนมัติ เพราะแต่ละกองออกใบยืมและ
                จ่ายของเอง ยื่นครั้งเดียวจบ แต่จะได้เลขอ้างอิง {cartGroups.length} เลขไว้ตามสถานะ
              </div>
            )}

            {assetsState === 'loading' && (
              <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-gray-400" /></div>
            )}

            {/* ⚠️ "โหลดไม่สำเร็จ" ต้องไม่หน้าตาเหมือน "ไม่มีของ" — ผู้ยื่นที่เจอจอว่างเพราะเน็ตหลุด
                จะเข้าใจว่า อปท. ไม่มีของให้ยืมแล้วเลิกยื่นไปเลย */}
            {assetsState === 'error' && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
                <AlertTriangle size={26} className="mx-auto text-rose-500" />
                <p className="mt-2 text-sm font-semibold text-rose-900">โหลดรายการพัสดุไม่สำเร็จ</p>
                <p className="mt-1 text-xs text-rose-700">{assetsError}</p>
                <button type="button" onClick={loadAssets}
                  className="mt-3 min-h-[44px] rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-700">
                  ลองใหม่
                </button>
              </div>
            )}

            {assetsState === 'ready' && visibleAssets.length === 0 && (
              <div className="rounded-2xl border border-dashed border-gray-200 py-10 text-center">
                <PackageOpen size={30} className="mx-auto text-gray-300" />
                <p className="mt-2 text-sm font-semibold text-gray-500">
                  {search ? 'ไม่พบพัสดุที่ค้นหา' : 'ยังไม่มีพัสดุที่เปิดให้ยืม'}
                </p>
              </div>
            )}

            {assetsState === 'ready' && visibleAssets.map(asset => {
              const inCart = cart[asset.id] ?? 0
              const soldOut = asset.available_qty < 1
              const disabled = soldOut && inCart === 0
              return (
                <div key={asset.id}
                  className={`rounded-2xl border bg-white p-4 ${disabled ? 'border-gray-100 opacity-50' : 'border-gray-100'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">{asset.name}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {asset.department_name || 'ไม่ระบุกอง'}
                        {asset.asset_code && ` · ${asset.asset_code}`}
                      </p>
                      <p className={`mt-1 text-xs font-semibold ${soldOut ? 'text-rose-600' : 'text-emerald-700'}`}>
                        {soldOut ? 'ช่วงวันที่นี้ถูกจองเต็มแล้ว' : `ว่าง ${asset.available_qty} ${asset.unit}`}
                      </p>
                      {asset.notes && <p className="mt-1 text-[11px] text-gray-400">{asset.notes}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button type="button" disabled={inCart === 0} onClick={() => changeQty(asset, -1)}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-gray-200 text-gray-600 disabled:opacity-30">
                        <Minus size={16} />
                      </button>
                      <span className="w-8 text-center text-sm font-bold text-gray-800">{inCart}</span>
                      <button type="button" disabled={disabled || inCart >= asset.available_qty}
                        onClick={() => changeQty(asset, 1)}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-teal-700 text-white disabled:bg-gray-300">
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

            <button type="button" disabled={cartLines.length === 0} onClick={() => setStep(3)}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-teal-700 text-sm font-bold text-white disabled:bg-gray-300">
              ตรวจสอบคำขอ ({cartLines.length} รายการ) <ChevronRight size={16} />
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-100 bg-white p-4">
              <h2 className="mb-3 text-sm font-bold text-gray-800">สรุปคำขอ</h2>
              <dl className="space-y-1.5 text-sm">
                <div className="flex gap-3"><dt className="w-28 shrink-0 text-gray-400">ผู้ยืม</dt><dd className="min-w-0 text-gray-800">{applicantName}</dd></div>
                {form.position.trim() && (
                  <div className="flex gap-3"><dt className="w-28 shrink-0 text-gray-400">ตำแหน่ง</dt><dd className="min-w-0 text-gray-800">{form.position}</dd></div>
                )}
                <div className="flex gap-3">
                  <dt className="w-28 shrink-0 text-gray-400">ยืมจาก</dt>
                  <dd className="min-w-0 text-gray-800">
                    {cartGroups.map(group => group.departmentName).join(' · ')}
                  </dd>
                </div>
                <div className="flex gap-3"><dt className="w-28 shrink-0 text-gray-400">เพื่อ</dt><dd className="min-w-0 text-gray-800">{form.purpose}</dd></div>
                <div className="flex gap-3"><dt className="w-28 shrink-0 text-gray-400">ตั้งแต่วันที่</dt><dd className="min-w-0 text-gray-800">{thaiDateFromDateInput(form.borrow_start_date)}</dd></div>
                <div className="flex gap-3"><dt className="w-28 shrink-0 text-gray-400">กำหนดคืน</dt><dd className="min-w-0 text-gray-800">{thaiDateFromDateInput(form.return_due_date)}</dd></div>
              </dl>
            </div>

            {/* แยกหัวข้อตามกอง = แยกตามใบที่จะได้จริง ผู้ยื่นจะได้เห็นว่าของชิ้นไหนอยู่ใบไหน
                ก่อนกดส่ง ไม่ใช่มารู้ทีหลังตอนกองหนึ่งอนุมัติอีกกองไม่อนุมัติ */}
            <div className="rounded-2xl border border-gray-100 bg-white p-4">
              <h2 className="mb-3 text-sm font-bold text-gray-800">
                รายการที่ขอยืม
                {cartGroups.length > 1 && (
                  <span className="ml-2 font-normal text-gray-400">แยกเป็น {cartGroups.length} ใบ</span>
                )}
              </h2>
              <div className="space-y-3">
                {cartGroups.map((group, index) => (
                  <div key={group.key}>
                    {cartGroups.length > 1 && (
                      <p className="mb-1 text-[11px] font-bold text-teal-700">
                        ใบที่ {index + 1} · {group.departmentName}
                      </p>
                    )}
                    <ul className="divide-y divide-gray-100">
                      {group.lines.map(line => (
                        <li key={line.asset.id} className="flex justify-between gap-3 py-2 text-sm">
                          <span className="min-w-0 text-gray-800">
                            {line.asset.name}
                            {line.asset.asset_code && <span className="text-gray-400"> · {line.asset.asset_code}</span>}
                          </span>
                          <span className="shrink-0 font-semibold text-gray-800">{line.qty} {line.asset.unit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            {/* ข้อความนี้คัดจากใบ บย. ต้นฉบับตรงตัว ไม่ได้แต่งเพิ่ม */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="text-xs leading-relaxed text-gray-600">
                หากสิ่งของที่นำมาส่งคืนชำรุดเสียหาย หรือใช้การไม่ได้ หรือสูญหายไป
                ข้าพเจ้ายินดีจัดการแก้ไขซ่อมแซมให้คงสภาพเดิมโดยเสียค่าใช้จ่ายของตนเอง
                หรือชดใช้เป็นพัสดุประเภท ชนิด ขนาด ลักษณะ และคุณภาพอย่างเดียวกัน
                หรือชดใช้เป็นเงินตามราคาที่เป็นอยู่ในขณะที่ยืม ตามหลักเกณฑ์ที่กระทรวงการคลังกำหนด
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                <p className="text-xs leading-relaxed text-amber-900">
                  การกดยืนยันคือการ<span className="font-bold">ยื่นคำขอ</span> ยังไม่ใช่การได้รับอนุญาต
                  ต้องผ่านความเห็นปลัดฯ และอนุมัติโดยนายกฯ ก่อน จึงจะรับของได้
                </p>
              </div>
            </div>

            <button type="button" disabled={saving} onClick={handleSubmit}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-teal-700 text-sm font-bold text-white disabled:bg-gray-300">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              ยืนยันและยื่นคำขอ
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
