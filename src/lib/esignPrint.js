// ใบพิมพ์ที่ลงนามออนไลน์ (แบบ ๓ ใบขออนุญาตใช้รถ + แบบ สก. ๑) — ตัวช่วยล้วน ไม่แตะ DOM/supabase เทสต์รันด้วย node
//
// หลักคิด:
//   - อ่านจากฐานข้อมูลสองก้อน: สถานะรายช่อง (esign_trip_status: ชื่อ/ตำแหน่ง/เวลา/ลายเซ็นตรงกับเนื้อหาไหม) + ภาพลายเซ็นที่แนบ (esign_trip_stamps)
//   - ช่องที่ลงนามออนไลน์ครบเงื่อนไข (ลงนามแล้ว ไม่ถูกถอน เนื้อหาตรงกับที่ลงนาม) ได้ภาพ+ชื่อ+วันที่ ส่วนช่องที่เซ็นสดคงเส้นว่างเหมือนเดิม
//   - ช่องที่ "เนื้อหาไม่ตรงกับที่ลงนาม" (แก้ข้อมูลหลังลงนามโดยไม่ผ่านระบบ) ไม่แสดงภาพ/ไม่ติ๊กอนุมัติ และใบต้องเตือนชัด
//   - ใบที่ไม่ใช่โหมดออนไลน์ → esignPrintData คืน null → ตัวสร้างใบต้องได้ HTML เหมือนเดิมทุกไบต์ (tests/esign-print.test.mjs เทียบค่า hash)
//   - ภาพลายเซ็นไม่ถูกส่งออกนอกใบพิมพ์: ฝัง data URL ในใบที่เจ้าหน้าที่สั่งพิมพ์เองเท่านั้น (หน้าตรวจสอบสาธารณะไม่มีภาพ)
import { ESIGN_FLEET_SLOTS } from './esign.js'
import { QUIET_MODULES, qrLayout } from './qrSvg.js'

const CODE_RE = /^[0-9a-f]{32}$/
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/
const SLOT_ORDER = ESIGN_FLEET_SLOTS.map(slot => slot.key)

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])

/** ลิงก์หน้าตรวจสอบสาธารณะ — origin = เว็บของ อปท. ที่เปิดอยู่ตอนสั่งพิมพ์ */
export function esignVerifyUrl(origin, code) {
  if (!CODE_RE.test(String(code ?? ''))) return ''
  return `${String(origin ?? '').replace(/\/+$/, '')}/v/${code}`
}

/**
 * รวมสถานะ + ภาพลายเซ็นของทริปเป็นข้อมูลสำหรับใบพิมพ์
 * @returns {null | { code: string, url: string, slots: Record<string, object>, modified: boolean, complete: boolean }}
 *   null = ไม่ใช่โหมดออนไลน์/อ่านสถานะไม่ได้ (ผู้เรียกต้องแยกแยะเอง: ทริปที่มี esign_slots แต่ได้ null = พิมพ์ไม่ได้)
 */
export function esignPrintData({ status, stamps, verifyCode, origin }) {
  if (!status?.found || status.mode !== 'online') return null
  const code = String(verifyCode ?? status.verify_code ?? '')
  const images = new Map()
  for (const item of stamps?.ok ? (stamps.items ?? []) : []) {
    // base64 เท่านั้น: ค่านี้ถูกฝังใน src="data:image/png;base64,…" ของ HTML ที่เขียนลงหน้าต่างพิมพ์
    if (item?.slot && typeof item.png_base64 === 'string' && BASE64_RE.test(item.png_base64)) {
      images.set(item.slot, { png: item.png_base64, width: Number(item.width) || 0, height: Number(item.height) || 0 })
    }
  }
  const slots = {}
  let modified = false
  for (const slot of status.slots ?? []) {
    if (slot.mode !== 'online' || !slot.applicable) continue
    const signature = slot.signed ? slot.signature : null
    const matches = signature ? signature.content_matches !== false : true
    if (signature && !matches) modified = true
    slots[slot.slot] = {
      slot: slot.slot,
      label: slot.label,
      signed: Boolean(signature),
      matches,
      signerName: signature?.signer_name ?? '',
      signerPosition: signature?.signer_position ?? '',
      signedAs: signature?.signed_as ?? '',
      decision: signature?.decision ?? '',
      signedAt: signature?.signed_at ?? null,
      image: signature && matches ? (images.get(slot.slot) ?? null) : null,
    }
  }
  return { code, url: esignVerifyUrl(origin, code), slots, modified, complete: Boolean(status.complete) }
}

/** ข้อมูลช่องที่ใช้แสดงลายเซ็นบนใบได้ (ลงนามแล้วและเนื้อหาตรงกับที่ลงนาม) — ไม่ใช่ = null */
export function esignValidSlot(esign, slot) {
  const data = esign?.slots?.[slot]
  return data?.signed && data.matches ? data : null
}

/**
 * "ติ๊ก อนุมัติ" ของช่องผู้มีอำนาจ: ลงนามออนไลน์แล้วด้วยการ "อนุมัติ" และเนื้อหาตรง
 * คืน null = ช่องผู้มีอำนาจไม่ได้เป็นออนไลน์ → ใช้เกณฑ์เดิมของใบ (approved_by + สถานะทริป) · true/false = ตัดสินจากลายเซ็น
 * ไม่ใช้ approved_by: ทริปโหมดออนไลน์ถูกอนุมัติคิวอัตโนมัติ (approved_by ว่างโดยเจตนา) การอนุมัติของ "ผู้มีอำนาจ" คือการลงนามช่องนี้
 */
export function esignApprovedMark(esign) {
  if (!esign?.slots?.authority) return null
  const valid = esignValidSlot(esign, 'authority')
  return Boolean(valid && valid.decision === 'approve')
}

/** รูปลายเซ็นบนเส้น — ภาพโปร่งใส พื้นหลังไม่ขาวทับเส้นประ · alt เว้นให้อ่านออกเสียงได้ว่าเป็นลายเซ็นของใคร */
export function esignSignatureImg(slot, { className = 'esign-img' } = {}) {
  const image = slot?.image
  if (!image?.png) return ''
  return `<img class="${className}" alt="ลายมือชื่อของ ${escapeHtml(slot.signerName)}" src="data:image/png;base64,${image.png}">`
}

// ชื่อสั้นของช่องในบรรทัดหลักฐาน (ชื่อเต็มของช่องยาว "ผู้อำนวยการสำนัก/กอง หรือผู้แทน" กินที่ท้ายใบ)
const SHORT_LABEL = { requester: 'ผู้ขออนุญาต', dept_head: 'ผอ.กอง', authority: 'ผู้มีอำนาจ', sk1: 'ผู้บริหารท้องถิ่น' }
const shortLabel = key => SHORT_LABEL[key] ?? key

/**
 * เส้นหลักฐานท้ายใบ: เวลาลงนามรายช่อง + ลิงก์/QR ตรวจสอบ (+ คำเตือนเมื่อเนื้อหาไม่ตรง)
 * @param {object} esign ผลของ esignPrintData
 * @param {(iso: string) => string} formatDateTime รูปแบบวันเวลาไทยของใบนั้น (ใบแต่ละแบบมีตัวจัดรูปแบบวันที่ของตัวเอง)
 * @param {object} [options]
 * @param {string[]} [options.only] ช่องที่ใบนี้เกี่ยวข้อง (แบบ ๓ = ผู้ขอ/ผอ.กอง/ผู้มีอำนาจ · สก.๑ = ผู้บริหาร) ไม่ใส่ = ทุกช่อง
 */
export function esignEvidenceHtml(esign, formatDateTime, { only = SLOT_ORDER } = {}) {
  if (!esign) return ''
  const slots = only.map(key => esign.slots[key]).filter(Boolean)
  if (!slots.length) return ''
  const signed = slots.filter(slot => slot.signed)
  const missing = slots.filter(slot => !slot.signed)
  const modified = signed.some(slot => !slot.matches)
  const lines = []
  if (modified) lines.push('<strong>⚠ เนื้อหาของใบนี้ไม่ตรงกับที่ลงนามไว้ — ห้ามใช้ใบนี้ แจ้งผู้ดูแลระบบให้ตรวจสอบ</strong>')
  if (signed.length) lines.push(`ลงนามออนไลน์ผ่านระบบ: ${signed.map(slot => `${escapeHtml(shortLabel(slot.slot))} ${escapeHtml(formatDateTime(slot.signedAt))}`).join(' · ')}`)
  if (missing.length) lines.push(`ยังไม่ลงนามออนไลน์: ${missing.map(slot => escapeHtml(shortLabel(slot.slot))).join(' · ')} (เซ็นสดต่อบนใบนี้ได้)`)
  const qr = esign.url ? qrLayout(esign.url, 1000) : null
  if (esign.url) lines.push(`ตรวจสอบความถูกต้อง: สแกน QR หรือเปิด ${escapeHtml(esign.url.replace(/^https?:\/\//, ''))}`)
  const box = qr ? qr.size + QUIET_MODULES * 2 : 0
  const svg = qr
    ? `<svg class="esign-evidence__qr" viewBox="0 0 ${box} ${box}" role="img" aria-label="QR code ตรวจสอบเอกสารลงนามออนไลน์"><rect width="${box}" height="${box}" fill="#fff"/><path transform="translate(${QUIET_MODULES} ${QUIET_MODULES})" d="${qr.d}" fill="#000"/></svg>`
    : ''
  return `<div class="esign-evidence">
    <div class="esign-evidence__text">${lines.map(line => `<p>${line}</p>`).join('')}</div>
    ${svg}
  </div>`
}

/**
 * CSS ของภาพลายเซ็น + เส้นหลักฐาน — ใส่ในบล็อก <style> ของใบที่ใช้ esignSignatureImg/esignEvidenceHtml
 * ภาพวางลอยเหนือเส้น (absolute) จึงไม่เพิ่มความสูงของบล็อก: ใบต้องจบ 1 หน้า A4 เท่าเดิม ความสูงภาพจำกัดตามที่ว่างเหนือเส้นของแต่ละใบ
 *
 * เส้นหลักฐานท้ายใบกินความสูงจริง (QR 13mm ข้างข้อความ 8.5pt) — วัดที่ความกว้างพื้นที่พิมพ์จริง 160mm (605px) แล้ว:
 * แบบ ๓ เดิมสูง 952px ตำแหน่งรักษาราชการแทนสูง 996px (พื้นที่พิมพ์ 1043px) ต้องบีบระยะห่างอื่นของใบเองในโหมดออนไลน์ (ดู fleetTripPrint.js)
 * ⚠️ ห้ามขยาย QR/ข้อความโดยไม่วัดใหม่: tests/esign-print-layout.test.mjs ล้มเมื่อใบตกหน้า 2
 */
export function esignPrintCss({ imageMaxHeight = '10mm', imageMaxWidth = '40mm' } = {}) {
  return `
    /* ── ลงนามออนไลน์ (esignPrint.js) ── */
    .esign-img {
      position: absolute; left: 50%; bottom: 1px; transform: translateX(-50%);
      max-height: ${imageMaxHeight}; max-width: ${imageMaxWidth}; width: auto; height: auto;
      pointer-events: none;
    }
    /* 8.5pt เท่าคำกำกับ QR ของใบอื่น (govMapQr.js) — เล็กกว่าบรรทัด "ผ่านระบบ E-Service" 11pt เพราะเป็นรายละเอียดอ้างอิง ไม่ใช่เนื้อหาของหนังสือ */
    .esign-evidence { display: flex; align-items: center; gap: 2.5mm; margin-top: 2mm; break-inside: avoid; page-break-inside: avoid; }
    .esign-evidence__text { flex: 1 1 auto; min-width: 0; font-size: 8.5pt; color: #333; line-height: 1.15; }
    .esign-evidence__text p { margin: 0; }
    .esign-evidence__text strong { color: #000; }
    .esign-evidence__qr { flex: 0 0 auto; width: 13mm; height: 13mm; }`
}
