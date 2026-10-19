import { useState } from 'react'
import { ExternalLink, Waves } from 'lucide-react'
import {
  NO_LIVE_TEXT, STALE_DIAGRAM_MONTHS, SYSTEM_DISCLAIMER_LINE, UPSTREAM_DEPTH_NOTE, diagramAge, liveState,
  resolveSystem, systemById, systemCountsText, thaiDate,
} from '../../lib/waterSystem/model'

// ส่วน "ระบบน้ำของตำบล" บน /water-situation (ดีไซน์ฉบับปิด docs/water-system.md) — อ่านอย่างเดียว ไม่มีช่องกรอก
//   ก่อนถึงตำบล → ในตำบล → ไหลต่อไปที่ + ที่มา/อายุผัง
// ไม่มีการ์ดแนวโน้มอ่าง และไม่มีกล่อง "ผังมีแต่เราไม่ได้ใส่" (เจ้าของระบบสั่งตัดออก 2026-10-19: ซ้ำกับการ์ดอ่างเดิมของหน้า / ภาษาเทคนิคเกินไปสำหรับชาวบ้าน)
//   ป้าย "ต้นน้ำของตำบล" + ปริมาตรอ่างอยู่ที่การ์ดอ่างเดิมของหน้าอยู่แล้ว · รายการที่ผังมีแต่ไม่ได้ใส่ยังเก็บไว้ในข้อมูลผัง (omitted) ให้ อบต. ยืนยัน แต่ไม่ขึ้นหน้าเว็บ
// ค่าสดมาจาก stations ที่หน้าโหลดอยู่แล้ว (ไม่มีคำขอเพิ่ม) · ไม่พยากรณ์ ไม่บอกเวลาน้ำถึง

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

function Step({ index, title, nodes, stations, footnote, lead }) {
  const [open, setOpen] = useState(false)
  const shown = open ? nodes : nodes.slice(0, COLLAPSED_COUNT)
  return (
    <div data-step={index} className="rounded-2xl border border-gray-200 bg-white p-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-sky-800">
        <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-700 text-xs text-white">{index}</span>
        {title}
      </h3>
      {lead && <p className="mt-1 text-xs leading-snug text-gray-600">{lead}</p>}
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

export default function WaterSystem({ slug, stations, now, previewId }) {
  const selection = resolveSystem(slug, previewId)
  const system = selection ? systemById(selection.system) : null
  if (!system) return null

  const age = diagramAge(system, now)

  return (
    <section id="water-system" data-water-system={system.id} className="space-y-3" aria-labelledby="water-system-title">
      <div className="water-section-heading flex items-start gap-2.5 px-1">
        <Waves size={19} className="mt-0.5 shrink-0 text-sky-700" />
        <div>
          <h2 id="water-system-title" className="text-sm font-bold text-gray-800">ระบบน้ำของตำบล{system.tambon}</h2>
          <p className="text-xs text-gray-500">น้ำไหลมาจากไหน ผ่านอะไรในตำบล และไหลต่อไปที่ไหน — ตามผังของศูนย์บริหารจัดการน้ำจังหวัดแพร่</p>
          {selection?.scope && <p className="mt-0.5 text-xs font-semibold text-amber-700">{selection.scope}</p>}
        </div>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900" data-system-disclaimer>
        <b>{SYSTEM_DISCLAIMER_LINE}</b>
        <span className="block text-[11px] text-amber-800">
          ผังตำบลอายุ {age?.text} ({age?.dateText}) · ผังจังหวัด (ไฟล์ {thaiDate(system.sources.find(s => s.id === 'province')?.date)})
        </span>
        {age?.stale && <span data-stale-band className="mt-1 block font-bold">ผังต้นฉบับอายุเกิน {STALE_DIAGRAM_MONTHS / 12} ปี — โครงสร้างอาจเปลี่ยนไปแล้ว</span>}
      </div>

      <p className="px-1 text-xs leading-relaxed text-gray-600">{system.summary}</p>

      <div className="space-y-2 lg:grid lg:grid-cols-3 lg:items-start lg:gap-3 lg:space-y-0">
        <Step index={1} title="ก่อนถึงตำบล" nodes={system.upstream} stations={stations} footnote={UPSTREAM_DEPTH_NOTE} />
        <Step index={2} title="ในตำบล" nodes={system.inside} stations={stations}
          lead={systemCountsText(system.counts)} />
        <Step index={3} title="ไหลต่อไปที่" nodes={system.downstream} stations={stations} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs leading-relaxed text-gray-600" data-system-source>
        <p className="font-bold text-gray-800">ที่มาของข้อมูล</p>
        <p className="mt-1">
          ถอดจากผังของศูนย์บริหารจัดการน้ำจังหวัดแพร่ โดยระบบ SmartLocal: {system.sources.map(s => `${s.name} (${s.fileDateOnly ? `ไฟล์ลงวันที่ ${thaiDate(s.date)} ภาพไม่ระบุวันที่` : thaiDate(s.date)})`).join(' · ')}
          {' '}· ยังไม่ผ่านการยืนยันโดย อบต. · ไม่ใช่เอกสารทางราชการ
        </p>
        <a href={system.originalUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-[44px] items-center gap-1 font-bold text-sky-700">
          ดูผังต้นฉบับ <ExternalLink size={12} />
        </a>
      </div>
    </section>
  )
}
