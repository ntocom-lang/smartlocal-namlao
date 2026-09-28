import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../contexts/TenantContext'
import { useVisibleRefresh } from '../../hooks/useVisibleRefresh'
import { alertSummary, buildAlerts } from '../../lib/waterSituation'

// เท่ากับหน้า /water-situation — ต้นทางเปลี่ยนชั่วโมงละครั้ง ถามถี่กว่านี้ก็ไม่ได้ของใหม่
const REFRESH_MS = 5 * 60 * 1000
const MODULE_KEY = 'water-situation'

/**
 * แถบแจ้งเตือนสถานการณ์น้ำ-ฝนบนหน้าแรก (ทุกธีม)
 *
 * ทำขึ้นเพราะคำเตือนเดิมอยู่บนหน้า /water-situation กับกลุ่ม Telegram ของเจ้าหน้าที่เท่านั้น
 * ประชาชนต้องเปิดหน้านั้นเองถึงจะเห็น แถบนี้จึงเอาคำเตือนชุดเดียวกันมาไว้บนหน้าที่คนเปิดอยู่แล้ว
 * โดยไม่ต้องล็อกอิน ไม่ต้องขอสิทธิ์แจ้งเตือน ไม่ต้องติดตั้งแอป
 *
 * ใช้ buildAlerts() ตัวเดียวกับหน้า /water-situation และ Telegram — เกณฑ์อยู่ที่เดียว
 * ห้ามตัดสินเองว่าอะไรน่าเตือน วันปกติคืน null หน้าแรกจึงไม่มีอะไรเพิ่ม
 */
export default function WaterAlertBanner({ className = '' }) {
  const { tenant, isModuleEnabled } = useTenant()
  const tenantId = tenant?.id
  // อปท. ที่ไม่ได้เปิดโมดูลต้องไม่ยิง RPC เลย — หน้าแรกโหลดทุกครั้งที่มีคนเข้าเว็บ
  const enabled = Boolean(tenantId) && (!isModuleEnabled || isModuleEnabled(MODULE_KEY))
  const [data, setData] = useState(null)
  const [now, setNow] = useState(Date.now)

  // อายุข้อมูลต้องเดินต่อแม้ request ค้าง/ออฟไลน์ ไม่งั้นค่าที่หมดอายุแล้วยังค้างเป็นคำเตือน
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const load = useCallback(() => {
    if (!enabled) return
    supabase.rpc('get_public_water_situation', { _municipality_id: tenantId })
      .then(({ data: result, error }) => { if (!error) { setData(result); setNow(Date.now()) } })
      .catch(() => {})   // โหลดไม่ได้ = ไม่แสดงอะไร ไม่ต้องรบกวนหน้าแรกด้วยข้อความ error
  }, [enabled, tenantId])

  // ยิงรอบแรกครั้งเดียวต่อ อปท. — TenantContext เปลี่ยนสถานะหลายจังหวะระหว่างโหลด และ StrictMode
  // เรียก effect ซ้ำตอน dev ถ้าไม่กันไว้ หน้าแรกจะยิง RPC 2–4 ครั้งทุกคนที่เข้าเว็บ
  const loadedFor = useRef(null)
  useEffect(() => {
    if (!enabled || loadedFor.current === tenantId) return
    loadedFor.current = tenantId
    load()
  }, [enabled, tenantId, load])
  useVisibleRefresh(load, { intervalMs: REFRESH_MS, enabled })

  if (!enabled || !data) return null
  const stations = data.stations ?? []
  const alerts = buildAlerts({
    rain: stations.filter(s => s.station_type === 'rain'),
    ews: stations.filter(s => s.station_type === 'ews'),
    warnings: data.warnings,
    now,
  })
  const summary = alertSummary(alerts, { homeAmphoe: tenant?.district, now })
  if (!summary) return null

  return (
    <Link to="/water-situation" role="alert"
      className={`block rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 sm:p-4 transition-colors hover:bg-amber-100 ${className}`}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug text-gray-900">แจ้งเตือนสถานการณ์น้ำ-ฝนใกล้พื้นที่</p>
          <p className="mt-1 text-sm leading-snug text-gray-800">
            <span className="font-semibold">{summary.label}</span> — {summary.text}
          </p>
          {summary.meta && <p className="mt-0.5 text-xs text-gray-600">{summary.meta}</p>}
          {summary.total > 1 && (
            <p className="mt-0.5 text-xs font-semibold text-gray-700">และอีก {summary.total - 1} เรื่อง</p>
          )}
          {/* คำกำกับเดียวกับหน้า /water-situation — ห้ามให้ประชาชนเข้าใจว่าเป็นประกาศของ อปท. เอง */}
          <p className="mt-1.5 text-xs leading-relaxed text-gray-700">
            ข้อมูลจากคลังข้อมูลน้ำแห่งชาติ (ThaiWater) ไม่ใช่ประกาศของ{tenant?.name || 'หน่วยงาน'}
          </p>
          <span className="mt-1 inline-flex min-h-[44px] items-center gap-0.5 text-xs font-bold text-amber-800 underline">
            ดูรายละเอียดสถานการณ์น้ำ-ฝน <ChevronRight size={14} />
          </span>
        </div>
      </div>
    </Link>
  )
}
