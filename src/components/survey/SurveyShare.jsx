import { useState } from 'react'
import { Copy, Share2 } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { appUrl } from '../../lib/basename'
import { copyText, shareTrackLink } from '../../lib/complaintTrack'
import { surveyPath, surveyShareText } from '../../lib/survey'

// ปุ่มส่งต่อลิงก์แบบสำรวจ (LINE ฯลฯ) — ใช้ตัวแชร์/คัดลอกชุดเดียวกับลิงก์ติดตามเรื่อง
// ลิงก์ไม่มีข้อมูลส่วนตัวของใคร (เป็น id ของแบบสำรวจ) ใครก็เปิดดูคำถามได้ แต่ต้องล็อกอินจึงตอบได้
export default function SurveyShare({ surveyId, className = '' }) {
  const { tenant } = useTenant()
  const [notice, setNotice] = useState('')
  const url = appUrl(surveyPath(surveyId))
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function share() {
    const result = await shareTrackLink({ url, title: 'แบบสำรวจความเห็น', text: surveyShareText({ orgName: tenant?.name }) })
    if (result === 'copied') setNotice('คัดลอกลิงก์แล้ว วางส่งต่อได้เลย')
    else if (result === 'failed') setNotice('ส่งต่ออัตโนมัติไม่ได้ กดค้างที่ลิงก์เพื่อคัดลอก')
    else setNotice('')
  }

  async function copy() {
    setNotice((await copyText(url)) ? 'คัดลอกลิงก์แล้ว วางส่งต่อได้เลย' : 'คัดลอกไม่ได้ กดค้างที่ลิงก์เพื่อคัดลอก')
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className={`grid gap-2 ${canShare ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {canShare && (
          <button type="button" onClick={share}
            className="min-h-[44px] rounded-xl text-sm font-bold text-white inline-flex items-center justify-center gap-1.5"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Share2 size={16} aria-hidden="true" /> ส่งต่อลิงก์
          </button>
        )}
        <button type="button" onClick={copy}
          className="min-h-[44px] rounded-xl text-sm font-bold border-2 inline-flex items-center justify-center gap-1.5 bg-white"
          style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>
          <Copy size={16} aria-hidden="true" /> คัดลอกลิงก์
        </button>
      </div>
      <p className="font-mono text-[11px] text-gray-500 bg-gray-50 rounded-lg px-2 py-1.5 break-all select-all">{url}</p>
      {notice && <p role="status" className="text-xs font-semibold text-green-700">{notice}</p>}
    </div>
  )
}
