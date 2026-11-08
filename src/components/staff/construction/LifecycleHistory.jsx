// ประวัติโครงการ (civil_project_events — เขียนโดย trigger/RPC เท่านั้น) เรียงใหม่→เก่า แสดง 5 รายการแรก
// kind: created · stage_change (ผู้ใช้กดเปลี่ยนขั้น) · auto_stage (ระบบเลื่อนเองตอนล็อกรายงานสัปดาห์แรก) · legacy_status (เมนูเดิมแก้ status) · note
import { useState } from 'react'
import { STAGE_LABELS } from '../../../lib/constructionLifecycle'
import { btnGhost } from './uiStyles'
import { thaiDay } from './lifecycleFormat'

const SHOWN = 5

function describe(e) {
  const from = STAGE_LABELS[e.from_stage] ?? e.from_stage
  const to = STAGE_LABELS[e.to_stage] ?? e.to_stage
  switch (e.kind) {
    case 'created': return `สร้างโครงการที่ขั้น "${to ?? '—'}"`
    case 'stage_change':
    case 'auto_stage': return `เปลี่ยนขั้น "${from ?? '—'}" → "${to ?? '—'}"`
    case 'legacy_status': return `เปลี่ยนขั้นผ่านเมนูเดิม "${from ?? '—'}" → "${to ?? '—'}"`
    case 'note': return 'บันทึกข้อความ'
    default: return `${e.kind}${from || to ? ` (${from ?? '—'} → ${to ?? '—'})` : ''}`
  }
}

export default function LifecycleHistory({ events, staffChoices = [] }) {
  const [all, setAll] = useState(false)
  const sorted = [...(events ?? [])].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
  const shown = all ? sorted : sorted.slice(0, SHOWN)
  const nameOf = id => staffChoices.find(s => s.id === id)?.full_name || 'เจ้าหน้าที่'
  return (
    <section className="rounded-2xl border border-gray-200 p-4" aria-label="ประวัติโครงการ">
      <p className="text-sm font-bold text-gray-900">ประวัติโครงการ</p>
      {sorted.length === 0
        ? <p className="mt-2 text-xs text-gray-500">ยังไม่มีประวัติ</p>
        : (
          <ol className="mt-2 space-y-2 border-l-2 border-gray-200 pl-4 text-sm">
            {shown.map(e => (
              <li key={e.id ?? `${e.kind}-${e.created_at}`}>
                <span className="text-xs text-gray-500">
                  {thaiDay(e.created_at)} ·{' '}
                  {e.kind === 'auto_stage'
                    ? <span className="rounded bg-teal-50 px-1 text-teal-700">ระบบเลื่อนเอง</span>
                    : e.actor ? nameOf(e.actor) : 'ระบบ'}
                </span>
                <br />
                <span className="text-gray-800">{describe(e)}</span>
                {e.reason && <span className="block text-xs text-gray-600">เหตุผล: {e.reason}</span>}
                {e.ref_no && <span className="block text-xs text-gray-600">เลขที่ {e.ref_no}{e.ref_date ? ` ลว. ${thaiDay(e.ref_date)}` : ''}</span>}
              </li>
            ))}
          </ol>
        )}
      {sorted.length > SHOWN && (
        <button type="button" className={`${btnGhost} mt-2`} onClick={() => setAll(!all)}>
          {all ? 'ย่อ' : `ดูทั้งหมด (${sorted.length} รายการ)`}
        </button>
      )}
    </section>
  )
}
