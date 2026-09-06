import { useMemo, useState } from 'react'
import { Map as MapIcon, ChevronDown, ChevronUp, Info } from 'lucide-react'
import LeafletMapCanvas from '../common/LeafletMapCanvas'
import { buildOdorPoints } from '../../lib/odorAnalytics'
import { odorIntensityLabel, ODOR_SEVERE_FROM } from '../../lib/odorOptions'
import { odorTimeRangeLabel } from '../../lib/odorTimeRanges'

// แผนที่จุดกระจุกคำร้องกลิ่นเหม็นรบกวน — ใช้ในแผงรายงาน (OdorReportSummary) ทั้งฝั่งผู้รับผิดชอบ
// และแท็ปเฉพาะกิจของแอดมิน
//
// ⚠️ ข้อมูลที่แสดงบนหมุด "ต้องเป็นคำตอบ structured เท่านั้น" (ความรุนแรง 1-5, ช่วงเวลา, ทิศทางลม,
//   วันที่) ห้ามใส่ชื่อผู้แจ้ง เบอร์โทร หรือ detail ที่ประชาชนพิมพ์เอง — การเปิดดูข้อมูลรายเรื่อง
//   มีบ็อปอัพของตัวเองที่บันทึก audit log ไว้แล้วว่าใครดูของใคร แผนที่นี้ไม่มี log และไม่ควรมี
//   เพราะมันกางทุกจุดพร้อมกัน ถ้าเผลอเติม PII ลงมาที่นี่คือการเปิดข้อมูลโดยไม่มีร่องรอยการเข้าถึง
//
// การรวมจุด/ปัดกริดอยู่ใน buildOdorPoints() (src/lib/odorAnalytics.js) ไฟล์นี้เรนเดอร์อย่างเดียว

// LeafletMapCanvas ส่ง markerData.infoHtml เข้า bindPopup แบบดิบ (ตามสัญญาที่เขียนไว้หัวไฟล์นั้น
// ว่า "ผู้เรียกต้องรับผิดชอบ escape เอง") ค่าอย่าง wind_direction ถูก whitelist ที่ฐานข้อมูลแล้วก็จริง
// แต่แถวเก่าก่อนมีด่านนั้นอาจมีอะไรก็ได้ จึง escape ทุกค่าที่ต่อเข้าสตริง ไม่ยกเว้นค่าที่ "น่าจะปลอดภัย"
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

// สีตามความรุนแรงสูงสุดในเซลล์ ไม่ใช่ค่าเฉลี่ย — เรื่องระดับ 5 เรื่องเดียวในเซลล์ที่มีเรื่องเบาๆ ปนอยู่
// ต้องยังเห็นเป็นสีแดง ถ้าเฉลี่ยแล้วมันจะจมหายไปพอดีในจุดที่ควรไปตรวจที่สุด
// โทนสีชุดเดียวกับแถบใน OdorReportSummary (lime / amber / rose) เพื่อให้อ่านคู่กันแล้วไม่สับสน
function toneOf(maxIntensity) {
  if (maxIntensity == null) return { color: '#94a3b8', label: 'ไม่ระบุความรุนแรง' }
  if (maxIntensity >= ODOR_SEVERE_FROM) return { color: '#e11d48', label: `รุนแรง (${ODOR_SEVERE_FROM}-5)` }
  if (maxIntensity === 3) return { color: '#f59e0b', label: 'ปานกลาง (3)' }
  return { color: '#65a30d', label: 'เบา (1-2)' }
}

const thaiDate = (d) => (d instanceof Date ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—')

function buildPopupHtml(point) {
  const tone = toneOf(point.maxIntensity)
  const intensityText = point.maxIntensity == null
    ? 'ไม่ระบุ'
    : `${point.maxIntensity} — ${odorIntensityLabel(point.maxIntensity) ?? 'ไม่ทราบระดับ'}`
  const topRange = point.timeRanges[0]
  const topWind = point.winds[0]
  const rangeText = topRange ? (odorTimeRangeLabel(topRange.key) ?? topRange.key) : 'ไม่ระบุ'
  const period = point.firstAt && point.latestAt && point.count > 1
    ? `${thaiDate(point.firstAt)} – ${thaiDate(point.latestAt)}`
    : thaiDate(point.latestAt)

  const row = (label, value) =>
    `<div style="display:flex;gap:6px;font-size:11px;line-height:1.5;">
       <span style="color:#64748b;flex-shrink:0;">${escapeHtml(label)}</span>
       <span style="color:#0f172a;font-weight:600;">${escapeHtml(value)}</span>
     </div>`

  return `
    <div style="font-family:inherit;min-width:190px;">
      <div style="font-size:13px;font-weight:800;color:#0f172a;">${escapeHtml(String(point.count))} เรื่องในพื้นที่นี้</div>
      <div style="font-size:10px;color:#94a3b8;margin-bottom:7px;">รวมคำร้องในช่วง ~100 เมตร ไม่ใช่พิกัดที่ผู้แจ้งปักจริง</div>
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:7px;">
        <span style="width:9px;height:9px;border-radius:50%;background:${tone.color};display:inline-block;"></span>
        <span style="font-size:11px;font-weight:700;color:#0f172a;">${escapeHtml(tone.label)}</span>
      </div>
      ${row('ความรุนแรงสูงสุด', intensityText)}
      ${point.severeCount > 0 ? row(`ระดับ ${ODOR_SEVERE_FROM} ขึ้นไป`, `${point.severeCount} เรื่อง`) : ''}
      ${row('ช่วงเวลาที่แจ้งบ่อยสุด', rangeText)}
      ${topWind ? row('ทิศทางลมที่ระบุบ่อยสุด', `${topWind.key} (${topWind.count})`) : ''}
      ${row(point.count > 1 ? 'ช่วงที่แจ้ง' : 'วันที่แจ้ง', period)}
      <div style="margin-top:7px;padding-top:6px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;line-height:1.4;">
        ทิศทางลมเป็นค่าที่ผู้แจ้งกรอกเอง ใช้ประกอบเท่านั้น · แผนที่นี้ไม่แสดงข้อมูลผู้แจ้ง
      </div>
    </div>
  `
}

export default function OdorHotspotMap({ complaints }) {
  const [open, setOpen] = useState(true)
  const data = useMemo(() => buildOdorPoints(complaints), [complaints])

  const markers = useMemo(() => data.points.map((point) => {
    const tone = toneOf(point.maxIntensity)
    // ขนาดวงไล่ตามจำนวนเรื่องในเซลล์ 9→18 (LeafletMapCanvas คูณ 1.8 ต่อ = 16→32 px)
    // ไล่แบบเชิงเส้นตามสัดส่วนของเซลล์ที่มากที่สุด ไม่ใช่ตามจำนวนดิบ — ไม่งั้นพอมีเซลล์ที่ 30 เรื่อง
    // วงอื่นจะเล็กจนมองไม่เห็นทั้งแผนที่
    const scale = 9 + (point.count / data.maxCount) * 9
    return {
      id: point.key,
      position: { lat: point.lat, lng: point.lng },
      shape: 'circle',
      color: tone.color,
      scale,
      label: String(point.count),
      infoHtml: buildPopupHtml(point),
    }
  }), [data])

  // ไม่มีหมุดสักจุด = ไม่ต้องโหลด tile ให้เปลืองเน็ตเจ้าหน้าที่ บอกสาเหตุแทน
  if (data.points.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-4">
        <p className="text-xs font-bold text-gray-700 mb-2 flex items-center gap-1.5">
          <MapIcon size={13} className="text-lime-600" /> แผนที่จุดที่ถูกแจ้ง
        </p>
        <p className="text-[11px] text-gray-500 leading-relaxed">
          ยังไม่มีคำร้องที่ลงแผนที่ได้
          {data.missingCoords > 0 && ` · ไม่มีพิกัด ${data.missingCoords} เรื่อง`}
          {data.outOfRange > 0 && ` · พิกัดผิดปกติ ${data.outOfRange} เรื่อง`}
        </p>
      </div>
    )
  }

  const legend = [
    { color: '#65a30d', label: 'เบา (1-2)' },
    { color: '#f59e0b', label: 'ปานกลาง (3)' },
    { color: '#e11d48', label: `รุนแรง (${ODOR_SEVERE_FROM}-5)` },
  ]

  return (
    // print:hidden — ใบพิมพ์ A4 ประกอบ HTML เองแยกไฟล์ และ canvas ของ Leaflet พิมพ์ออกมาเป็นช่องว่าง
    <div className="rounded-2xl border border-gray-100 bg-white p-4 print:hidden">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <p className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
          <MapIcon size={13} className="text-lime-600" /> แผนที่จุดที่ถูกแจ้ง
          <span className="font-normal text-gray-400">
            {data.points.length} จุด · {data.mapped} เรื่อง
          </span>
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-50"
          aria-expanded={open}
        >
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {open ? 'ย่อ' : 'กางแผนที่'}
        </button>
      </div>

      {open && (
        <>
          <div className="h-[340px] w-full overflow-hidden rounded-xl border border-gray-100">
            <LeafletMapCanvas
              markers={markers}
              fitBounds
              zoom={14}
              mapTypeId="hybrid"
              className="w-full h-full"
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {legend.map((item) => (
              <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
            <span className="text-[11px] text-gray-400">· ขนาดวง = จำนวนเรื่องในจุดนั้น · ตัวเลขในวง = จำนวนเรื่อง</span>
          </div>

          {(data.missingCoords > 0 || data.outOfRange > 0) && (
            <p className="mt-2 text-[11px] font-semibold text-amber-700">
              ไม่ได้อยู่บนแผนที่
              {data.missingCoords > 0 && ` · ไม่มีพิกัด ${data.missingCoords} เรื่อง`}
              {data.outOfRange > 0 && ` · พิกัดผิดปกติ ${data.outOfRange} เรื่อง`}
            </p>
          )}

          <div className="mt-2.5 rounded-xl bg-gray-50 p-2.5 text-[11px] leading-relaxed text-gray-500 flex gap-1.5">
            <Info size={13} className="mt-0.5 shrink-0 text-gray-400" />
            <span>
              หมุดถูกปัดรวมเป็นช่วงละ ~100 เมตร ไม่ใช่พิกัดที่ผู้แจ้งปักจริง และไม่แสดงข้อมูลผู้แจ้ง
              {data.smallSample && (
                <> · ข้อมูลยังมีเพียง {data.total} เรื่อง (ต่ำกว่า {data.smallSampleThreshold}) <b className="text-amber-700">การกระจุกของหมุดยังใช้ชี้แหล่งกำเนิดไม่ได้</b></>
              )}
              {' '}· จุดที่ไม่มีหมุดอาจแปลว่าไม่มีคนแจ้ง ไม่ได้แปลว่าไม่มีกลิ่น
            </span>
          </div>
        </>
      )}
    </div>
  )
}
