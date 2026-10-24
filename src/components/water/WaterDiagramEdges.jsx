import { useState } from 'react'
import { ArrowDownFromLine, ArrowDownToLine } from 'lucide-react'
import { NO_LIVE_TEXT, UPSTREAM_DEPTH_NOTE, liveState } from '../../lib/waterSystem/model'

// "ก่อนถึงตำบล" + "ไหลต่อไปที่" ใต้ภาพผังน้ำตำบล (แท็บ "ผังน้ำตำบล" ของ /water-situation) — อ่านอย่างเดียว ไม่มีช่องกรอก
// เดิมเป็นส่วน "ระบบน้ำของตำบล" ท้ายแท็บสถานการณ์ (3 ขั้น: ก่อนถึงตำบล → ในตำบล → ไหลต่อไปที่) เล่าเรื่องเดียวกับภาพผังน้ำตำบลสองรอบ
//   เจ้าของระบบสั่งจัดระเบียบ 2569-10-24: รวมไว้ที่แท็บผังน้ำตำบล — เหลือเฉพาะสิ่งที่ภาพไม่มี (ต้นน้ำนอกตำบล · ปลายน้ำนอกตำบล)
//   ขั้น "ในตำบล" ตัดออก (ซ้ำกับภาพและ "รายการจุด") · คำกำกับ/อายุผัง/ที่มาไปรวมกับของแท็บผังน้ำตำบล (WaterDiagram.jsx) ให้เหลือชุดเดียว
// ค่าสดมาจาก stations ที่หน้าโหลดอยู่แล้ว (ไม่มีคำขอเพิ่ม) · ไม่พยากรณ์ ไม่บอกเวลาน้ำถึง
// ป้ายความสัมพันธ์ (ต้นน้ำของตำบล · อยู่ในตำบล · สายข้างเคียง) ยังอยู่ที่การ์ดอ่าง/ระดับน้ำในแท็บสถานการณ์ — ไม่เกี่ยวกับไฟล์นี้

const KIND_ICON = { stream: '≋', reservoir: '▲', weir: '┃', canal: '≋', pond: '◯', pump: 'Ⓟ', supply: '⊠', gauge: '◉', rain: '◉', gate: '◆', other: '□' }
const COLLAPSED_COUNT = 3

function Tag({ tone, children }) {
  const tones = {
    live: 'border-emerald-400 bg-emerald-50 text-emerald-800',
    none: 'border-gray-300 bg-gray-100 text-gray-600',
    plan: 'border-red-300 bg-red-50 text-red-700',
    unk: 'border-amber-300 bg-amber-50 text-amber-900',
  }
  return <span className={`ml-1.5 inline-block whitespace-nowrap rounded-full border px-2 py-0 align-middle text-[11px] font-bold ${tones[tone]}`}>{children}</span>
}

function NodeItem({ node, stations }) {
  const live = liveState(node, stations)
  const dashed = node.status === 'planned' ? 'border-dashed border-red-300 text-red-800'
    : node.status === 'unconfirmed' ? 'border-dashed border-amber-400 bg-amber-50'
      : 'border-gray-200'
  return (
    <li data-node={node.id} data-status={node.status} className={`flex items-start gap-2 rounded-xl border bg-white px-2.5 py-1.5 text-sm ${dashed}`}>
      <span aria-hidden="true" className="mt-0.5 w-5 shrink-0 text-center font-bold text-sky-700">{KIND_ICON[node.kind] ?? '•'}</span>
      <span className="min-w-0">
        <span className="font-semibold text-gray-900">{node.name}</span>
        {node.status === 'planned' && <Tag tone="plan">แผนก่อสร้าง</Tag>}
        {node.status === 'repair' && <Tag tone="plan">ชำรุด/ซ่อมแซม</Tag>}
        {node.status === 'unconfirmed' && <Tag tone="unk">ผังไม่ระบุ</Tag>}
        {live === 'live' && <Tag tone="live">ค่าสด</Tag>}
        {live === 'none' && <Tag tone="none">{NO_LIVE_TEXT}</Tag>}
        {node.note && <span className="block text-xs leading-snug text-gray-500">{node.note}</span>}
      </span>
    </li>
  )
}

function Edge({ edge, title, Icon, nodes, stations, footnote }) {
  const [open, setOpen] = useState(false)
  const shown = open ? nodes : nodes.slice(0, COLLAPSED_COUNT)
  return (
    <div data-edge={edge} className="rounded-2xl border border-gray-200 bg-white p-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-sky-800">
        <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-700 text-white"><Icon size={14} /></span>
        {title}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {shown.map(node => <NodeItem key={node.id} node={node} stations={stations} />)}
      </ul>
      {nodes.length > COLLAPSED_COUNT && (
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
          className="mt-1 inline-flex min-h-[44px] items-center text-sm font-bold text-sky-700">
          {open ? 'ย่อรายการ' : `ดูทั้งหมด ${nodes.length} รายการ`}
        </button>
      )}
      {footnote && <p className="mt-1 text-xs text-gray-500">{footnote}</p>}
    </div>
  )
}

export default function WaterDiagramEdges({ system, stations }) {
  if (!system) return null
  const upstream = system.upstream ?? []
  const downstream = system.downstream ?? []
  if (upstream.length === 0 && downstream.length === 0) return null
  return (
    <section data-water-edges={system.id} aria-label="ก่อนถึงตำบลและไหลต่อไปที่" className="space-y-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
      {upstream.length > 0 && <Edge edge="upstream" title="ก่อนถึงตำบล" Icon={ArrowDownToLine} nodes={upstream} stations={stations} footnote={UPSTREAM_DEPTH_NOTE} />}
      {downstream.length > 0 && <Edge edge="downstream" title="ไหลต่อไปที่" Icon={ArrowDownFromLine} nodes={downstream} stations={stations} />}
    </section>
  )
}
