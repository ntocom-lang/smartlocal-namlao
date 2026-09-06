import { useMemo } from 'react'
import { Wind, AlertTriangle, MapPin, Clock, HeartPulse, TrendingUp, Lightbulb } from 'lucide-react'
import { buildOdorSummary } from '../../lib/odorAnalytics'
import OdorHotspotMap from './OdorHotspotMap'

// แผงสรุป+วิเคราะห์คำร้องกลิ่นเหม็นรบกวน — ใช้ร่วม 2 หน้า
//   - ผู้รับผิดชอบ: staff/OdorReportPanel.jsx (บทบาทใหม่คือ "ดูรายงาน" ไม่ต้องกดรับทราบแล้ว)
//   - แอดมิน     : admin/ComplaintsManager.jsx แท็ป "กลิ่นเหม็นรบกวน (เฉพาะกิจ)"
// การคำนวณอยู่ใน src/lib/odorAnalytics.js ทั้งหมด ไฟล์นี้เรนเดอร์อย่างเดียว (ใบพิมพ์ A4 ใช้ก้อน
// คำนวณเดียวกันแต่ประกอบ HTML เอง จึงต้องไม่มี logic ตกค้างในนี้ ไม่งั้นตัวเลขบนจอกับบนกระดาษจะต่างกัน)
//
// ไม่มีชื่อ/เบอร์/รายละเอียดที่ผู้แจ้งพิมพ์เองในแผงนี้เลยแม้แต่ช่องเดียว — เป็นสถิติรวมล้วน
// ใครเห็นแผงนี้จึงไม่ได้เห็นข้อความที่ประชาชนเขียนเพิ่มจากที่ role ตัวเองเห็นอยู่แล้ว
//
// ⚠️ ข้อยกเว้นเดียวคือแผนที่ (OdorHotspotMap) ซึ่งกาง "ตำแหน่ง" ของทุกเรื่องพร้อมกัน
//   ตำแหน่งเป็นข้อมูลส่วนบุคคลด้วย เพราะพิกัดที่ผู้แจ้งปักมักเป็นบ้านตัวเอง จึงปัดลงกริด ~100 ม.
//   ก่อนแสดงเสมอ และ popup มีแต่คำตอบ structured (ดูเหตุผลเต็มในหัวไฟล์ OdorHotspotMap.jsx)
//   ⚠️ ก่อนขยายแผงนี้ไปให้ role ที่กว้างขึ้น ต้องกลับมาคิดเรื่องแผนที่ก่อนทุกครั้ง — การเปิดดู
//     รายเรื่องมี audit log ว่าใครดูของใคร แต่แผนที่ไม่มี

// แถบสัดส่วนแนวนอน — ใช้จำนวนดิบเป็นความยาวเสมอ ส่วน % แสดงต่อท้ายเฉพาะตอนข้อมูลมากพอ
// (summary คืน pct เป็น null เองเมื่อกลุ่มตัวอย่างเล็ก ที่นี่แค่เคารพค่านั้น ไม่ตัดสินซ้ำ)
function Bar({ label, count, pct, max, tone = 'lime' }) {
  const width = max > 0 ? Math.round((count / max) * 100) : 0
  const tones = {
    lime: 'bg-lime-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  }
  return (
    <div className="flex items-center gap-2">
      <span className="w-40 shrink-0 text-[11px] text-gray-600 truncate" title={label}>{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden min-w-[40px]">
        <div className={`h-full rounded-full ${tones[tone]}`} style={{ width: `${width}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-[11px] font-semibold text-gray-700 tabular-nums">
        {count}{pct != null && <span className="font-normal text-gray-400"> · {pct}%</span>}
      </span>
    </div>
  )
}

function Card({ icon: Icon, title, children, note }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4">
      <p className="text-xs font-bold text-gray-700 mb-2.5 flex items-center gap-1.5">
        <Icon size={13} className="text-lime-600" /> {title}
      </p>
      {children}
      {note && <p className="mt-2 text-[10px] leading-relaxed text-gray-400">{note}</p>}
    </div>
  )
}

function Stat({ value, unit, label, tone = 'gray' }) {
  const tones = {
    gray: 'text-gray-900',
    rose: 'text-rose-600',
    amber: 'text-amber-600',
  }
  return (
    <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3">
      <p className={`text-2xl font-bold tabular-nums ${tones[tone]}`}>
        {value}{unit && <span className="text-sm font-semibold text-gray-400 ml-0.5">{unit}</span>}
      </p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

const fmtDate = (d) => (d ? d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '-')

export default function OdorReportSummary({ complaints, filterSummary }) {
  const s = useMemo(() => buildOdorSummary(complaints), [complaints])

  if (!s.total) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center">
        <Wind size={22} className="mx-auto text-gray-300 mb-1.5" />
        <p className="text-sm text-gray-400">ยังไม่มีข้อมูลมากพอสำหรับสรุปรายงาน</p>
      </div>
    )
  }

  const maxTime = Math.max(...s.timeRanges.map((r) => r.count), 1)
  const maxIntensity = Math.max(...s.intensity.dist.map((d) => d.count), 1)
  const topLocations = s.locations.slice(0, 5)
  const maxLocation = Math.max(...topLocations.map((l) => l.count), 1)
  const months = s.months.slice(-12)
  const maxMonth = Math.max(...months.map((m) => m.count), 1)

  return (
    <div className="space-y-3">
      {/* หัวรายงาน: ขอบเขตข้อมูลที่กำลังดูอยู่ ต้องขึ้นก่อนตัวเลขเสมอ ไม่งั้นคนอ่านไม่รู้ว่ากรองอะไรไว้ */}
      <div className="rounded-2xl bg-lime-50 border border-lime-200 px-4 py-3">
        <p className="text-sm font-bold text-lime-900 flex items-center gap-1.5">
          <Wind size={15} /> สรุปและวิเคราะห์คำร้องกลิ่นเหม็นรบกวน
        </p>
        <p className="text-[11px] text-lime-800 mt-0.5">
          ข้อมูล {s.total} เรื่อง · ช่วง {fmtDate(s.firstAt)} ถึง {fmtDate(s.lastAt)}
          {filterSummary && ` · ตัวกรอง: ${filterSummary}`}
        </p>
      </div>

      {/* ตัวเลขหลัก 4 ตัว */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Stat value={s.total} unit="เรื่อง" label="คำร้องทั้งหมด" />
        <Stat value={s.intensity.avg ?? '-'} unit="/ 5" label="ความรุนแรงเฉลี่ย" />
        <Stat value={s.intensity.severeCount} unit="เรื่อง" tone="rose"
          label={`ระดับ ${s.intensity.severeFrom} ขึ้นไป`} />
        <Stat value={s.health.count} unit="ราย" tone="amber" label="ผู้แจ้งที่มีอาการทางกาย" />
      </div>

      {/* เตือนเรื่องกลุ่มตัวอย่างเล็ก — วางไว้เหนือกราฟทุกตัว ไม่ใช่เชิงอรรถท้ายหน้าที่ไม่มีใครอ่าน */}
      {s.smallSample && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed text-amber-900">
            ข้อมูลมี {s.total} เรื่อง ยังต่ำกว่า {s.smallSampleThreshold} เรื่อง
            จึงแสดงเป็นจำนวนดิบทั้งหมดไม่มีเปอร์เซ็นต์ — เพิ่มอีกเรื่องเดียวสัดส่วนก็พลิกได้
            ใช้ดูทิศทางคร่าวๆ ได้ แต่ยังอ้างเป็นสถิติของพื้นที่ไม่ได้
          </p>
        </div>
      )}

      {/* แผนที่มาก่อนการ์ดอื่น — การ์ด "พื้นที่ที่ถูกแจ้งมากที่สุด" ด้านล่างนับตามชื่อหมู่บ้าน
          ซึ่งบอกไม่ได้ว่าจุดกระจุกอยู่ตรงไหนของหมู่บ้าน และคนละหมู่บ้านที่ติดกันก็ถูกแยกแถวกัน
          ทั้งที่อาจเป็นกลุ่มเดียวกัน แผนที่จึงเป็นตัวที่ตอบคำถาม "ไปตรวจตรงไหน" ได้จริง */}
      <OdorHotspotMap complaints={complaints} />

      <div className="grid lg:grid-cols-2 gap-2">
        <Card icon={Clock} title="ช่วงเวลาที่ได้กลิ่น"
          note="ใช้จัดเวรลงพื้นที่ให้ตรงกับเวลาที่กลิ่นเกิดจริง ไม่ใช่เวลาที่ประชาชนกดแจ้ง">
          <div className="space-y-1.5">
            {s.timeRanges.map((r) => (
              <Bar key={r.value} label={r.label} count={r.count} pct={r.pct} max={maxTime} />
            ))}
          </div>
        </Card>

        <Card icon={AlertTriangle} title="ระดับความรุนแรงที่ผู้แจ้งประเมิน"
          note="เป็นความรู้สึกของผู้แจ้ง ไม่ใช่ค่าที่วัดด้วยเครื่องมือ">
          <div className="space-y-1.5">
            {s.intensity.dist.map((d) => (
              <Bar key={d.level} label={`${d.level} — ${d.label}`} count={d.count} pct={d.pct}
                max={maxIntensity} tone={d.level >= s.intensity.severeFrom ? 'rose' : 'lime'} />
            ))}
          </div>
        </Card>

        <Card icon={MapPin} title="พื้นที่ที่ถูกแจ้งมากที่สุด"
          note="พื้นที่ที่ไม่ปรากฏในรายการไม่ได้แปลว่าไม่มีกลิ่น อาจเป็นพื้นที่ที่ยังไม่มีคนใช้ระบบแจ้ง">
          {topLocations.length === 0 ? (
            <p className="text-[11px] text-gray-400">ไม่มีข้อมูลสถานที่</p>
          ) : (
            <div className="space-y-2">
              {topLocations.map((l) => (
                <div key={l.name}>
                  <Bar label={l.name} count={l.count} pct={l.pct} max={maxLocation}
                    tone={l.severeCount > 0 ? 'amber' : 'lime'} />
                  <p className="ml-40 pl-2 text-[10px] text-gray-400">
                    {l.avgIntensity != null && `ความรุนแรงเฉลี่ย ${l.avgIntensity}/5`}
                    {l.topTimeRangeLabel && ` · มักได้กลิ่น${l.topTimeRangeLabel}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card icon={TrendingUp} title="แนวโน้มรายเดือน"
          note={months.length < 3 ? 'ข้อมูลยังไม่ถึง 3 เดือน ยังดูแนวโน้มไม่ได้' : null}>
          {months.length === 0 ? (
            <p className="text-[11px] text-gray-400">ไม่มีข้อมูล</p>
          ) : (
            <div className="flex items-end gap-1 h-24">
              {months.map((m) => (
                <div key={m.key} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
                  <span className="text-[10px] font-semibold text-gray-600 tabular-nums">{m.count}</span>
                  <div className="w-full rounded-t bg-lime-400"
                    style={{ height: `${Math.max((m.count / maxMonth) * 100, m.count > 0 ? 6 : 2)}%` }} />
                  <span className="text-[9px] text-gray-400 truncate w-full text-center">{m.label}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {(s.health.byOption.length > 0 || s.wind.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-2">
          {s.health.byOption.length > 0 && (
            <Card icon={HeartPulse} title="อาการทางสุขภาพที่ผู้แจ้งระบุ"
              note="เป็นการรายงานตนเอง ไม่ใช่การวินิจฉัยทางการแพทย์ ใช้จัดลำดับความเร่งด่วนเท่านั้น">
              <div className="flex flex-wrap gap-1.5">
                {s.health.byOption.map((o) => (
                  <span key={o.label}
                    className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                    {o.label} <b className="tabular-nums">{o.count}</b>
                  </span>
                ))}
              </div>
            </Card>
          )}

          {s.wind.length > 0 && (
            <Card icon={Wind} title={`ทิศทางลมในกลุ่มที่รุนแรง (ระดับ ${s.intensity.severeFrom} ขึ้นไป)`}
              note="⚠️ คำถามในฟอร์มไม่ได้ระบุว่าลมพัดมาจากทิศนั้นหรือพัดไปทางนั้น ผู้แจ้งแต่ละคนอาจตอบคนละความหมาย ห้ามใช้ค่านี้ชี้แหล่งกำเนิดกลิ่นโดยลำพัง">
              <div className="flex flex-wrap gap-1.5">
                {s.wind.map((w) => (
                  <span key={w.label}
                    className="px-2 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-[11px] text-sky-800">
                    {w.label} <b className="tabular-nums">{w.count}</b>
                  </span>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ข้อสังเกตอัตโนมัติ — ประโยคชุดเดียวกับที่ลงในใบพิมพ์เสนอผู้บังคับบัญชา */}
      {s.observations.length > 0 && (
        <div className="rounded-2xl border border-lime-200 bg-lime-50/60 p-4">
          <p className="text-xs font-bold text-lime-900 mb-2 flex items-center gap-1.5">
            <Lightbulb size={13} /> ข้อสังเกตจากข้อมูล
          </p>
          <ul className="space-y-1.5">
            {s.observations.map((line, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-lime-900 flex gap-1.5">
                <span className="text-lime-500 shrink-0">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
