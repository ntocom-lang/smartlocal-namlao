import { GOV_FONT_LINK, GOV_ESERVICE_ORIGIN_CSS, govDocFontCss, govPageCss, govPagePadding, govEServiceOriginText } from './govDocStyle.js'
import { govSignBlockCss, govSignRow, govNameBlank, GOV_SIGN_LINE_W } from './govSignBlock.js'
import { orgHeadTitle, orgOfficeName } from './orgTerms.js'
import { bookingLetter, dateTime, RETURN_MODES, isCommunity } from './patientBooking.js'
import { thaiDateFromDateInput } from './thaiDate.js'

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const draftNote = 'ร่างเอกสารบริการชุมชน — ต้องให้สารบรรณและกองทุนตรวจถ้อยคำและอำนาจใช้รถก่อนออกหนังสือจริง'
function check(booking) { if (!isCommunity(booking)) throw new Error('เอกสารชุมชนใช้เฉพาะคำขอชุมชน') }
function page(title, tenant, body) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title>${GOV_FONT_LINK}<style>
    ${govPageCss({ hideBrowserHeader: true })}
    * { box-sizing: border-box; }
    body { ${govDocFontCss()} margin: 0; color: #000; background: #eee; }
    ${govSignBlockCss()}
    .origin { ${GOV_ESERVICE_ORIGIN_CSS} }
    .sheet { width: 210mm; min-height: 297mm; padding: ${govPagePadding()}; margin: 8mm auto; background: white; }
    .draft { text-align: center; font-weight: bold; border: 1px solid #777; padding: 2mm; margin-bottom: 5mm; }
    .title { text-align: center; font-size: 1em; font-weight: bold; margin: 0 0 5mm; }
    p { margin: 0 0 3mm; overflow-wrap: anywhere; }
    .prose { text-indent: 2.5em; text-align: justify; }
    .sign-block { margin: 8mm 0 5mm 60mm; }
    .regards { width: ${GOV_SIGN_LINE_W}; text-align: center; }
    .letter-top { display: flex; justify-content: space-between; gap: 8mm; margin-bottom: 5mm; }
    .tools { padding: 3mm; text-align: right; }
    .tools button { min-height: 44px; padding: 8px 16px; }
    @media print { body { background: white; } .sheet { margin: 0; break-after: page; } .sheet:last-child { break-after: auto; } .tools { display: none; } }
  </style></head><body><div class="tools"><button type="button" onclick="window.close()">ปิดหน้าต่าง</button></div><main class="sheet">
    <div class="draft">${draftNote}</div>${body}<div class="origin">${esc(govEServiceOriginText(tenant?.name || 'หน่วยงาน'))}</div>
  </main></body></html>`
}
function journey(booking) {
  return `เดินทางไปยัง ${esc(booking.route_label)} ต้องถึงปลายทาง ${esc(dateTime(booking.appointment_at))} `
    + `รูปแบบการเดินทาง ${esc(RETURN_MODES[booking.return_mode])}`
    + (booking.return_mode !== 'one_way' ? ` เวลาที่พร้อมให้รับกลับ ${esc(dateTime(booking.return_at))}` : '')
}
export function buildCommunityRequestFormHtml({ tenant, booking }) {
  check(booking)
  return page('ร่างใบคำขอรถรับ–ส่งชุมชน', tenant, `
    <h1 class="title">ใบคำขอรถรับ–ส่งชุมชน (ร่าง)</h1>
    <p>เลขที่คำขอ ${esc(String(booking.id).slice(0, 8).toUpperCase())}</p>
    <p>เรียน ${esc(orgHeadTitle(tenant))}</p>
    <p class="prose">ข้าพเจ้า ${esc(booking.requester_name)} เบอร์ติดต่อ ${esc(booking.phone)} ขอรับบริการรถรับ–ส่งชุมชนสำหรับกลุ่ม ${esc(booking.group_label)} จำนวนผู้เดินทางทั้งหมด ${esc(booking.party_size)} คน เพื่อกิจกรรม ${esc(booking.purpose_label || booking.purpose_code)} โดย${journey(booking)}</p>
    <p class="prose">จุดรับ ${esc(booking.pickup)} ผู้เดินทางเดินขึ้นลงรถได้เอง ไม่ร่วมเที่ยวกับงานบริการอื่น การรับคำขอยังไม่ใช่การยืนยันรถ เจ้าหน้าที่ตรวจคิวและยืนยันการให้บริการตามกฎที่หน่วยงานกำหนด</p>
    <p>ช่องทางรับคำขอ: ${booking.entry_channel === 'online' ? 'ผู้จองส่งผ่านระบบด้วยตนเอง' : booking.entry_channel === 'staff' ? 'เจ้าหน้าที่รับจองแทนทางโทรศัพท์/หน้าเคาน์เตอร์' : 'ไม่ปรากฏข้อมูลช่องทาง'}</p>
    <div class="sign-block">${govSignRow({ role: 'ผู้ยื่นคำขอ', below: [govNameBlank()] })}</div>
  `)
}
export function buildCommunityForwardLetterHtml({ tenant, booking, trip, partner, mayor }) {
  check(booking)
  if (!trip || booking.trip_id !== trip.id || !['confirmed', 'completed'].includes(booking.status) || trip.state === 'cancelled') {
    throw new Error('หนังสือแจ้งกองทุนชุมชนพิมพ์ได้หลังยืนยันรถในเที่ยวที่ยังไม่ยกเลิก')
  }
  const letter = bookingLetter(booking, trip)
  // The authority signs with a pen. The registry name appears only below the blank signing line.
  const sign = govSignRow({ label: '', below: [mayor?.name ? `(${esc(mayor.name)})` : govNameBlank(), esc(mayor?.title || orgHeadTitle(tenant))] })
  return page('ร่างหนังสือแจ้งการรับ–ส่งชุมชนถึงกองทุน', tenant, `
    <h1 class="title">หนังสือแจ้งการรับ–ส่งชุมชน (ร่าง)</h1>
    <div class="letter-top"><p>ที่ ${esc(letter.no) || '................................'}</p><p>${esc(orgOfficeName(tenant))}<br>${esc(tenant?.address || '')}</p></div>
    <p class="title">${esc(letter.date ? thaiDateFromDateInput(letter.date) : 'วันที่ ................................')}</p>
    <p>เรื่อง แจ้งการจัดรถรับ–ส่งชุมชน</p>
    <p>เรียน ${esc(partner?.recipient_title || `ประธาน${partner?.name || 'กองทุนเจ้าของรถ'}`)}</p>
    <p>สิ่งที่ส่งมาด้วย ใบคำขอรถรับ–ส่งชุมชน จำนวน 1 ฉบับ</p>
    <p class="prose">ด้วย ${esc(tenant?.name)} ได้รับคำขอจาก ${esc(booking.requester_name)} สำหรับกลุ่ม ${esc(booking.group_label)} จำนวน ${esc(booking.party_size)} คน เพื่อกิจกรรม ${esc(booking.purpose_label || booking.purpose_code)} โดย${journey(booking)} และได้จัดคิวรถในเที่ยวเลขที่ ${esc(String(trip.id).slice(0, 8).toUpperCase())} แล้ว</p>
    <p class="prose">จึงเรียนมาเพื่อโปรดทราบ รายละเอียดปรากฏตามใบคำขอที่แนบ การใช้รถและการมอบหมายผู้ปฏิบัติงานให้เป็นไปตามข้อบังคับและคำสั่งของผู้มีอำนาจ</p>
    <div class="sign-block"><p class="regards">ขอแสดงความนับถือ</p>${sign}</div>
    <p>ติดต่อประสาน: ${esc(booking.phone)}</p>
  `)
}
