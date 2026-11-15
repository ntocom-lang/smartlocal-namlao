import { AlertTriangle, CheckCircle2, CloudRainWind, Droplets, HelpCircle } from 'lucide-react'
import WaterAlertShareButton from './WaterAlertShareButton'
import { STATUS_RULE_TEXT, selectStatus, statusVerdict } from '../../lib/waterAlertPoster'
import { TMD_SOURCE_NAME, nextHeavyRainDay, rainText } from '../../lib/tmdForecast'

// สีของป้ายตามสถานะ — ความหมายอยู่ที่คำ (ปกติ/เฝ้าระวัง/...) เสมอ ไม่พึ่งสีอย่างเดียว
const TONES = {
  normal: { Icon: CheckCircle2, box: 'border-emerald-200 bg-emerald-50', badge: 'bg-emerald-600 text-white', text: 'text-emerald-800' },
  watch: { Icon: AlertTriangle, box: 'border-amber-300 bg-amber-50', badge: 'bg-amber-500 text-white', text: 'text-amber-800' },
  low: { Icon: Droplets, box: 'border-orange-200 bg-orange-50', badge: 'bg-orange-500 text-white', text: 'text-orange-800' },
  nodata: { Icon: HelpCircle, box: 'border-slate-200 bg-slate-50', badge: 'bg-slate-500 text-white', text: 'text-slate-700' },
}

/**
 * ป้ายสรุปสถานการณ์ใต้หัวหน้า /water-situation (เจ้าของระบบอนุมัติ 2569-11-15)
 *
 * 1) คำสรุป ปกติ / เฝ้าระวัง / น้ำน้อย / ข้อมูลไม่ครบ — ใช้ selectStatus + statusVerdict ตัวเดียวกับภาพสถานะที่แชร์
 *    หน้าเว็บกับภาพจึงพูดตรงกันเสมอ · ปุ่มแชร์ภาพอยู่ในป้ายนี้ (ปุ่มเดียวของหน้า ชุดภาพเดิมท้ายหน้าเลิกใช้แล้ว)
 *    ไม่ขึ้นคำสรุปเมื่อมีแถบแจ้งเตือน (alerts.any — แถบทำหน้าที่สรุปอยู่แล้ว เกณฑ์เดียวกับปุ่มแชร์เดิม) หรือมีประกาศ อปท. ที่ยืนยันแล้ว (announced — ประกาศชนะเสมอ)
 * 2) พยากรณ์ล่วงหน้า 1 บรรทัด: ฝนหนักวันแรกในวันนี้ + 2 วันจากแบบจำลองกรมอุตุฯ — ขึ้นได้ทุกกรณี (แม้มีแถบเตือน/ประกาศ)
 *    ⚠️ พยากรณ์ไม่ดันคำสรุปเป็นเฝ้าระวัง: แบบจำลองคลาดเคลื่อนได้มาก ถ้าดันสถานะจะเตือนผิดบ่อยจนคนเลิกเชื่อ
 *
 * ไม่มีทั้งสองอย่าง = ไม่แสดงอะไร
 */
export default function WaterVerdictCard({ rain, ews, levels, dams, warnings, tenant, now, forecast, announced = false }) {
  const st = selectStatus({ rain, ews, levels, dams, warnings, now })
  const verdict = !announced && !st.alerts.any ? statusVerdict(st, now) : null
  const outlook = nextHeavyRainDay(forecast, now)
  if (!verdict && !outlook) return null
  if (!verdict) return <OutlookLine outlook={outlook} />

  const tone = TONES[verdict.state] ?? TONES.nodata
  return (
    <section data-water-verdict={verdict.state} aria-label="สรุปสถานการณ์น้ำ–ฝนตอนนี้" className={`rounded-2xl border-2 p-4 shadow-sm ${tone.box}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-[1_1_16rem] items-start gap-3">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${tone.badge}`} aria-hidden="true"><tone.Icon size={26} /></span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-600">สรุปสถานการณ์ตอนนี้</p>
            <p data-verdict-label className={`text-2xl font-extrabold leading-tight ${tone.text}`}>{verdict.label}</p>
            <p data-verdict-detail className="mt-1 text-sm leading-relaxed text-slate-700">{verdict.detail}</p>
          </div>
        </div>
        <WaterAlertShareButton rain={rain} ews={ews} levels={levels} dams={dams} warnings={warnings} tenant={tenant} now={now} allStates />
      </div>
      {outlook && <OutlookLine outlook={outlook} nested />}
      {/* ที่มาของคำสรุปต้องตรวจย้อนได้ (สตง./ประชาชน) และต้องไม่ถูกอ่านเป็นประกาศของหน่วยงาน */}
      <details className="mt-2 text-xs text-slate-600">
        <summary className="inline-flex min-h-[44px] cursor-pointer items-center font-semibold">ระบบสรุปจากค่าตรวจวัดตามเกณฑ์ ไม่ใช่ประกาศทางการ · ดูเกณฑ์</summary>
        <p data-verdict-rule className="pb-1 leading-relaxed">{STATUS_RULE_TEXT.replace(/^เกณฑ์ภาพ:\s*/, 'เกณฑ์: ')}</p>
      </details>
    </section>
  )
}

function OutlookLine({ outlook, nested = false }) {
  return (
    <a href="#water-forecast" data-water-outlook={outlook.level.key}
      className={`flex items-start gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm hover:bg-sky-50 ${nested ? 'mt-3' : ''}`}>
      <CloudRainWind size={20} className="mt-0.5 shrink-0 text-blue-700" aria-hidden="true" />
      <span className="min-w-0">
        <b className="font-bold text-blue-900">พยากรณ์: คาดว่าจะมี{outlook.level.label} {outlook.when}</b> ราว {rainText(outlook.mm)} มม.
        <span className="block text-xs text-slate-600">แบบจำลองของ{TMD_SOURCE_NAME} อาจคลาดเคลื่อน ไม่ใช่ประกาศเตือนภัย · <span className="font-semibold text-sky-700 underline">ดูพยากรณ์ 7 วัน</span></span>
      </span>
    </a>
  )
}
