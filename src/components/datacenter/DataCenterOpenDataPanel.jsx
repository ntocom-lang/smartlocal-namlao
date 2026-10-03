import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Globe, Copy, Check, ShieldCheck, Info, EyeOff } from 'lucide-react'
import OpenDataDownload from './OpenDataDownload'
import { OPEN_DATA_FIELDS, OPEN_DATA_EXCLUDED } from '../../lib/dataCenterExport'
import { panelCls, insetCls, mutedCls, accentCls, ghostBtnCls, toneBadgeCls } from './dcTheme'

// สิ่งที่ประชาชนเห็นและดาวน์โหลดได้ — โปร่งใสต่อเจ้าหน้าที่ว่าอะไรถูกเผยแพร่ ไม่ต้องมีขั้นตอนอนุมัติเพิ่ม
// (ข้อมูลชุดนี้เปิดอ่านสาธารณะอยู่แล้วโดยนโยบาย RLS "dce public read active" ปุ่มนี้แค่ทำให้นำไปใช้ต่อได้ง่าย)
export default function DataCenterOpenDataPanel({ isLight, tenant, summary }) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const totals = summary?.totals ?? {}
  const published = totals.active ?? 0
  const hidden = Math.max(0, (totals.total ?? 0) - published)
  const publicUrl = new URL('/data-center/public', window.location.origin).href

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('คัดลอกลิงก์นี้', publicUrl)
    }
  }

  return (
    <div className="space-y-5">
      <section className={`rounded-2xl border p-5 backdrop-blur-xl shadow-xl space-y-4 ${panelCls(isLight)}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-60 flex-1">
            <h2 className="text-base font-black tracking-wide flex items-center gap-2">
              <Download size={17} className={accentCls(isLight)} /> ข้อมูลเปิดของ {tenant?.name ?? 'หน่วยงาน'}
            </h2>
            <p className={`text-xs mt-1 leading-relaxed ${mutedCls(isLight)}`}>
              ประชาชน นักวิชาการ และหน่วยงานอื่น ดาวน์โหลดจุดพิกัดและเส้นทางของท้องถิ่นไปใช้ต่อได้เองที่หน้าแผนที่สาธารณะ
              ไม่ต้องขอเป็นหนังสือ ไม่เพิ่มงานเจ้าหน้าที่
            </p>
          </div>
          <div className={`rounded-xl border px-4 py-2.5 text-center ${toneBadgeCls('good', isLight)}`}>
            <p className="text-2xl font-black font-mono leading-none">{published}</p>
            <p className="text-[10px] font-bold mt-1">รายการที่เผยแพร่</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <OpenDataDownload tenant={tenant} variant="panel" isLight={isLight} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => navigate('/data-center/public')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border ${ghostBtnCls(isLight)}`}>
            <Globe size={13} /> เปิดหน้าแผนที่สาธารณะ
          </button>
          <button type="button" onClick={copyLink}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border ${ghostBtnCls(isLight)}`}>
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />} {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์ให้ประชาชน'}
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`rounded-2xl border p-5 ${panelCls(isLight)}`}>
          <h3 className="text-sm font-extrabold tracking-wide flex items-center gap-2 mb-3">
            <ShieldCheck size={15} className={accentCls(isLight)} /> ฟิลด์ที่เผยแพร่
          </h3>
          <ul className="space-y-1.5 text-xs">
            {OPEN_DATA_FIELDS.map((f) => (
              <li key={f.keys.join(',')} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600">{f.keys.join(' · ')}</span>
                <span className={mutedCls(isLight)}>{f.label}</span>
              </li>
            ))}
            <li className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600">geometry</span>
              <span className={mutedCls(isLight)}>ตำแหน่ง: จุด (Point) หรือเส้น (LineString) พิกัด WGS84</span>
            </li>
          </ul>
        </div>

        <div className={`rounded-2xl border p-5 ${panelCls(isLight)}`}>
          <h3 className="text-sm font-extrabold tracking-wide flex items-center gap-2 mb-3">
            <EyeOff size={15} className={accentCls(isLight)} /> ไม่เผยแพร่
          </h3>
          <ul className={`space-y-1.5 text-xs list-disc pl-4 ${mutedCls(isLight)}`}>
            {OPEN_DATA_EXCLUDED.map((x) => <li key={x}>{x}</li>)}
            {hidden > 0 && <li>ขณะนี้มี <b className="font-mono">{hidden}</b> รายการที่ปิดใช้งานอยู่</li>}
          </ul>
        </div>
      </section>

      <div className={`rounded-2xl border p-4 text-[11px] leading-relaxed space-y-1 ${insetCls(isLight)} ${mutedCls(isLight)}`}>
        <p className="flex items-start gap-2"><Info size={13} className={`shrink-0 mt-0.5 ${accentCls(isLight)}`} />
          <span>"ชื่อ" และ "รายละเอียด" เป็นข้อความที่เจ้าหน้าที่พิมพ์เอง ระบบเฝ้าให้ที่แท็บ <b>สุขภาพข้อมูล</b> ว่ามีเลข 13 หลักที่หน้าตาเหมือนเลขบัตรประชาชนหลุดอยู่หรือไม่ — แก้ให้เป็นศูนย์ก่อนแจ้งประชาชนให้ใช้ไฟล์นี้</span>
        </p>
        <p className="pl-5">
          ไฟล์ยังไม่ระบุสัญญาอนุญาตการนำข้อมูลไปใช้ (license) เพราะเป็นการตัดสินใจของผู้บริหารหน่วยงาน — แนวปฏิบัติข้อมูลเปิดภาครัฐต้องตรวจจากฉบับปัจจุบันของหน่วยงานที่กำกับ (เช่น สำนักงานพัฒนารัฐบาลดิจิทัล) ก่อนกำหนด
        </p>
      </div>
    </div>
  )
}
