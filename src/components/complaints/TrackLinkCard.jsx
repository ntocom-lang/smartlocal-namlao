import { useEffect, useState } from 'react'
import { Copy, Share2 } from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { appUrl } from '../../lib/basename'
import { supabase } from '../../lib/supabase'
import { copyText, isTrackToken, shareTrackLink, trackPath, trackShareText } from '../../lib/complaintTrack'

// การ์ด "ส่งลิงก์ติดตามให้ผู้แจ้ง" — ใช้หลังยื่นเรื่องแทนชาวบ้านเสร็จ และในรายละเอียดคำร้องของฉัน
// ผู้ขอลิงก์ต้องเป็นผู้ยื่น หรือผู้มีตำแหน่งใน อปท. เดียวกัน (get_complaint_track_token ตรวจที่ฐานข้อมูล)
// ไม่ได้สิทธิ์ = ไม่แสดงการ์ดเลย ไม่ขึ้นข้อความผิดพลาด (ผู้ยื่นที่ไม่ล็อกอินติดตามด้วยเลขอ้างอิงตามเดิม)
//
// ดึงโทเคนตั้งแต่เปิดการ์ด ไม่รอตอนกด: แผ่นแชร์ของ iOS Safari ต้องถูกเรียกในจังหวะที่ผู้ใช้เพิ่งแตะ
// ถ้ารอเครือข่ายก่อนแล้วค่อยเรียก navigator.share เบราว์เซอร์จะปฏิเสธ
export default function TrackLinkCard({ complaintId, refNo = null, className = '' }) {
  const { tenant } = useTenant()
  // เก็บคู่ id+โทเคนไว้ด้วยกัน — เปลี่ยนไปเปิดคำร้องอื่นแล้วโทเคนของใบเก่าต้องไม่หลงมาแสดง
  const [fetched, setFetched] = useState({ id: null, token: null })
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!complaintId) return undefined
    let alive = true
    supabase.rpc('get_complaint_track_token', { p_complaint_id: complaintId }).then(({ data, error }) => {
      if (alive) setFetched({ id: complaintId, token: !error && isTrackToken(data) ? data : null })
    }, () => {
      if (alive) setFetched({ id: complaintId, token: null })
    })
    return () => { alive = false }
  }, [complaintId])

  const token = fetched.id === complaintId ? fetched.token : null
  if (!token) return null

  const url = appUrl(trackPath(token))
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function share() {
    const result = await shareTrackLink({
      url,
      title: 'ติดตามเรื่องที่แจ้ง',
      text: trackShareText({ orgName: tenant?.name, refNo }),
    })
    if (result === 'copied') setNotice('คัดลอกลิงก์แล้ว วางส่งให้ผู้แจ้งได้เลย')
    else if (result === 'failed') setNotice('ส่งต่ออัตโนมัติไม่ได้ กดค้างที่ลิงก์เพื่อคัดลอกแล้วส่งให้ผู้แจ้ง')
    else setNotice('')
  }

  async function copy() {
    setNotice((await copyText(url)) ? 'คัดลอกลิงก์แล้ว วางส่งให้ผู้แจ้งได้เลย' : 'คัดลอกไม่ได้ กดค้างที่ลิงก์เพื่อคัดลอก')
  }

  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-4 space-y-3 ${className}`} aria-labelledby="track-link-title">
      <div>
        <h2 id="track-link-title" className="text-sm font-bold text-gray-800">ส่งลิงก์ติดตามให้ผู้แจ้ง</h2>
        <p className="text-xs text-gray-500 mt-0.5">ผู้แจ้งเปิดดูความคืบหน้าและให้คะแนนได้เอง ไม่ต้องสมัครสมาชิก</p>
      </div>
      <div className={`grid gap-2 ${canShare ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {canShare && (
          <button type="button" onClick={share}
            className="min-h-[44px] rounded-xl text-sm font-bold text-white inline-flex items-center justify-center gap-1.5"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Share2 size={16} aria-hidden="true" /> ส่งต่อ
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
    </section>
  )
}
