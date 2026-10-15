import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquareWarning, Phone, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { measuredAtText } from '../../lib/waterSituation'
import {
  VILLAGE_STATUSES, hasAreaAlert, loadChosenMoo, saveChosenMoo, villageFacts, villageStatus, villageTitle,
} from '../../lib/waterVillage'

// รายการหมู่กับสถานีที่ผูกเป็นค่าตั้งต้นที่แทบไม่เปลี่ยน — ถามซ้ำช้าๆ พอ (ค่าวัดมาจากหน้าหลักที่รีเฟรชของตัวเองอยู่แล้ว)
const REFRESH_MS = 30 * 60 * 1000
const TYPE_LABEL = { rain: 'ฝน', waterlevel: 'ระดับน้ำ', dam: 'อ่างเก็บน้ำ' }
const WARNING_MAX_AGE_MS = 24 * 60 * 60 * 1000

function useWaterVillages(tenantId) {
  const [state, setState] = useState({ tenantId: null, villages: [] })
  useEffect(() => {
    if (!tenantId) return
    let alive = true
    // ล้มเหลวเงียบๆ และคงรายการเดิมไว้ — ส่วนนี้เป็นส่วนเสริม หน้าเดิมต้องทำงานต่อโดยไม่ขึ้นข้อความทำให้ตกใจ
    const load = () => supabase.rpc('get_public_water_villages', { _municipality_id: tenantId })
      .then(({ data, error }) => {
        if (!alive || error) return
        setState({ tenantId, villages: Array.isArray(data?.villages) ? data.villages : [] })
      })
      .catch(() => {})
    load()
    const timer = setInterval(() => { if (!document.hidden) load() }, REFRESH_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [tenantId])
  // ค่าของ อปท. เก่าต้องไม่โผล่ตอนสลับ tenant
  return state.tenantId === tenantId ? state.villages : []
}

// localStorage ใช้ไม่ได้ (โหมดส่วนตัว/ปิดคุกกี้) ต้องไม่ทำหน้าพัง — แค่จำหมู่ไม่ได้
function getStorage() {
  try { return window.localStorage } catch { return undefined }
}

function StatusPill({ status, large = false }) {
  const info = VILLAGE_STATUSES[status.status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-bold ${large ? 'px-3.5 py-1.5 text-base' : 'px-2.5 py-1 text-xs'} ${info.chip}`}>
      <span aria-hidden="true">{info.glyph}</span>{info.label}
    </span>
  )
}

function distanceText({ distanceKm, distanceFrom }) {
  if (distanceKm === null) return ''
  const n = distanceKm.toLocaleString('th-TH', { maximumFractionDigits: 1 })
  return distanceFrom === 'village' ? `ห่างจากหมู่ ${n} กม.` : `ห่างจากสำนักงาน ${n} กม.`
}

/**
 * "หมู่ของฉัน" — ประชาชนเลือกหมู่ครั้งเดียว แล้วเห็นสถานะจากสถานีที่เจ้าหน้าที่ผูกไว้ให้หมู่นั้น
 *
 * แสดงเฉพาะ อปท. ที่เจ้าหน้าที่ตั้งค่าแล้ว (get_public_water_villages คืนรายการว่างถ้ายังไม่ผูกสถานีเลย) — อปท. อื่นไม่เห็นอะไรเปลี่ยน
 * ตั้งใจเขียนกำกับทุกจุดว่านี่คือ "ค่าที่วัดได้จากสถานีใกล้หมู่" ไม่ใช่การวัดในหมู่บ้านและไม่ใช่ประกาศเตือนภัยของ อบต.
 * เกณฑ์ทั้งหมดอยู่ที่ src/lib/waterVillage.js (ใช้ buildAlerts() เดิม) — ที่นี่แค่วาด ไม่ตัดสินเอง
 * จำหมู่ที่เลือกไว้ในเครื่องเท่านั้น ไม่ส่งอะไรขึ้นเซิร์ฟเวอร์
 */
export default function MyVillageCard({ stations, warnings, now }) {
  const { tenant, isModuleEnabled } = useTenant()
  const slug = tenant?.slug
  const villages = useWaterVillages(tenant?.id)
  const [picked, setPicked] = useState(undefined) // undefined = ยังไม่ได้เลือกในรอบนี้ ใช้ค่าที่จำไว้
  const stored = useMemo(() => loadChosenMoo(getStorage(), slug, villages), [slug, villages])
  const chosenMoo = picked === undefined ? stored : picked

  const rows = useMemo(() => villages.map(village => ({
    village, status: villageStatus({ village, stations, warnings, now }),
  })), [villages, stations, warnings, now])

  const areaAlert = useMemo(() => hasAreaAlert({ stations, warnings, now }), [stations, warnings, now])

  if (villages.length === 0) return null

  const chosen = rows.find(r => Number(r.village.moo_no) === chosenMoo) ?? null
  function choose(moo) {
    saveChosenMoo(getStorage(), slug, moo)
    setPicked(moo)
  }

  if (!chosen) {
    return (
      <section id="water-my-village" aria-labelledby="water-my-village-title" className="space-y-3 rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
        <div>
          <h2 id="water-my-village-title" className="text-lg font-bold text-gray-900">หมู่ของฉัน</h2>
          <p className="text-sm text-gray-500">เลือกหมู่ของคุณ เพื่อดูค่าที่วัดได้จากสถานีใกล้หมู่ ระบบจำไว้ในเครื่องนี้</p>
        </div>
        {areaAlert && (
          <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">มีเรื่องเตือนจากสถานีในพื้นที่ ดูที่แถบเตือนด้านบนของหน้านี้ แม้ป้ายของหมู่จะเป็น "ปกติ"</p>
        )}
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ village, status }) => (
            <li key={village.moo_no}>
              <button type="button" onClick={() => choose(Number(village.moo_no))}
                className="flex min-h-[48px] w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left hover:bg-sky-50">
                <span className="text-sm font-semibold text-gray-900">{villageTitle(village)}</span>
                <StatusPill status={status} />
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">ค่าจากสถานีใกล้หมู่ ไม่ใช่ประกาศเตือนภัยของ อบต. · "ค่าที่วัดได้ปกติ" ไม่ได้รับรองว่าปลอดภัย · "ข้อมูลไม่พอ" ไม่ได้หมายความว่าปกติ</p>
      </section>
    )
  }

  const { village, status } = chosen
  const facts = villageFacts({ village, stations, homeAmphoe: tenant?.district, now })
  // ข้อความหน่วยงานอื่น (ชั้น 2) แสดงตามต้นฉบับ ไม่เรียบเรียงใหม่ · เกิน 24 ชม. ไม่แสดง (เกณฑ์เดียวกับแถบหน้าแรก)
  const activeWarnings = (Array.isArray(warnings) ? warnings : []).filter(w => {
    const age = now - new Date(w?.issued_at).getTime()
    return typeof w?.message === 'string' && w.message.trim() && Number.isFinite(age) && age >= 0 && age < WARNING_MAX_AGE_MS
  }).slice(0, 2)

  return (
    <section id="water-my-village" aria-labelledby="water-my-village-title" className="space-y-4 rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-sky-700">หมู่ของฉัน</p>
          <h2 id="water-my-village-title" className="text-lg font-bold text-gray-900">{villageTitle(village)}</h2>
        </div>
        <button type="button" onClick={() => choose(null)}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
          <RefreshCw size={15} /> เปลี่ยนหมู่
        </button>
      </div>

      <div className="space-y-2" role="status">
        <StatusPill status={status} large />
        {status.reasons.slice(0, 3).map(reason => <p key={reason} className="text-sm text-gray-700">{reason}</p>)}
        {status.stale.length > 0 && status.status !== 'nodata' && (
          <p className="text-xs text-amber-700">สถานี{status.stale.map(s => s.station_name).join(', ')} ไม่มีค่าใหม่</p>
        )}
        {areaAlert && status.status !== 'high' && (
          <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">มีเรื่องเตือนจากสถานีอื่นในพื้นที่ ดูที่แถบเตือนด้านบนของหน้านี้</p>
        )}
      </div>

      {activeWarnings.map(w => (
        <blockquote key={`${w.issued_at}-${w.station_name ?? ''}`} className="rounded-xl border-l-4 border-sky-400 bg-sky-50 p-3 text-sm text-sky-950">
          <p className="mb-1 text-xs font-semibold text-sky-700">ข้อความจาก สสน. (ตามต้นฉบับ) · {measuredAtText(w.issued_at, now)}</p>
          {w.message}
        </blockquote>
      ))}

      {facts.length > 0 && (
        <ul className="space-y-2">
          {facts.map(f => (
            <li key={f.key} className={`rounded-xl border border-gray-100 p-3 ${f.fresh ? 'bg-white' : 'bg-gray-50 text-gray-500'}`}>
              {f.missing ? (
                <p className="text-sm text-amber-800">{TYPE_LABEL[f.type]} · สถานีนี้ถูกถอดออกจากระบบ</p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold">{f.label}</span>
                    <span className={`text-right text-sm font-bold ${f.fresh ? 'text-gray-900' : ''}`}>{f.fresh ? f.value : 'ไม่มีค่าใหม่'}</span>
                  </div>
                  {f.fresh && f.note && <p className="text-sm text-gray-600">{f.note}</p>}
                  <p className="mt-1 text-xs text-gray-500">
                    {TYPE_LABEL[f.type]} · {f.name}{f.river ? ` · ลำน้ำ ${f.river}` : ''}{f.place ? ` · ${f.place}` : ''}
                    {distanceText(f) ? ` · ${distanceText(f)}` : ''}{f.measuredAt ? ` · วัดเมื่อ ${f.measuredAt}` : ''}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1 text-xs text-gray-500">
        <p>ค่าจากสถานีใกล้หมู่ ไม่ใช่การวัดในหมู่บ้าน และไม่ใช่ประกาศเตือนภัยของ อบต.</p>
        {status.status === 'ok' && <p className="font-semibold text-gray-600">ค่าที่วัดได้ปกติ ไม่ได้รับรองว่าปลอดภัย โดยเฉพาะน้ำป่าจากห้วยเล็กที่ไม่มีเครื่องวัด</p>}
        {status.status === 'nodata' && <p className="font-semibold text-gray-600">ไม่มีข้อมูล ไม่ได้หมายความว่าสถานการณ์ปกติ</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/directory" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50">
          <Phone size={16} /> เบอร์โทรสำคัญ / ฉุกเฉิน
        </Link>
        {isModuleEnabled('complaints') && (
          <Link to="/request?category=flood" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700">
            <MessageSquareWarning size={16} /> แจ้งน้ำท่วม / ระบายน้ำ
          </Link>
        )}
      </div>
    </section>
  )
}
