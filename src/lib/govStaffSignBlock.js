// ช่องลงนามเจ้าหน้าที่ท้ายใบคำขอ — ใช้ร่วมทุกใบในหน้า "งานบริการประชาชน" (E-Service)
//
// ที่มา: เจ้าของระบบส่งแบบฟอร์มกระดาษที่ใช้จริงมาเมื่อ 2569-10-05 แล้วสั่งว่าคำขอทุกประเภท
// ต้องมีช่องลงนามชุดนี้เหมือนกัน และคำขอประเภทใหม่ที่สร้างต่อจากนี้ก็ต้องใช้ชุดเดียวกัน
// จึงยกมาเป็นไฟล์กลาง ใบใหม่เรียก govStaffSignBlockHtml() + govStaffSignBlockCss() พอ
// ห้ามคัดลอกเลย์เอาต์ไปเขียนซ้ำในไฟล์ใบ (เหตุผลเดียวกับ govSignBlock.js)
//
// ผังตามต้นฉบับ: แถวบนสองคอลัมน์ (หัวหน้าส่วนราชการที่ถือเรื่อง / ปลัด) แถวล่างนายกชิดขวา
//
// ⚠️ ใบที่ "ไม่" ใช้ไฟล์นี้ พร้อมเหตุผล (เจ้าของระบบตัดสิน 2569-10-05 — อย่าไปไล่ใส่เพิ่ม):
//   - assetBorrowPrint.js (ใบ บย. ยืมพัสดุ) — ต้นฉบับมีช่องผู้ยืม/ผู้ให้ยืม/ผู้อนุมัติครบแล้ว
//   - buildingPermitPrint.js (ขออนุญาตก่อสร้าง) — แบบพิมพ์ตามกฎหมาย ลอกเลย์เอาต์ต้นฉบับทั้งใบ
//
// ⚠️ ไม่มีการลงลายมือชื่ออิเล็กทรอนิกส์ในบล็อกนี้ ถึงทะเบียนจะมีชื่อผู้ลงนามอยู่ก็ตาม —
// ใบพวกนี้เวียนเซ็นด้วยปากกาในสำนักงาน ชื่อที่พิมพ์คือชื่อในวงเล็บใต้เส้นเท่านั้น
// (ต่างจากช่องผู้ยื่นด้านบนของใบ ซึ่งผู้ยื่นยืนยันตัวตนผ่านระบบมาแล้วจริง)

import { GOV_SIGN_LINE_W, govNameBlank, govSignRow } from './govSignBlock.js'
import { orgClerkTitle, orgHeadTitle } from './orgTerms.js'

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

// คำที่บอกว่าเป็นการรักษาราชการแทน — ตำแหน่งแบบ "ผู้อำนวยการกองช่าง รักษาราชการแทน ปลัด…" ยาวกว่าคอลัมน์
// (48% ของพื้นที่พิมพ์) และ .sign-below ห้ามตัดบรรทัดเอง จึงล้นขอบขวากระดาษ
// เจ้าของระบบสั่ง 2569-10-06: ให้ตัดหลังคำนี้ — บรรทัดแรก "ตำแหน่งเดิม + รักษาราชการแทน"
// บรรทัดที่สอง "ตำแหน่งที่รักษาราชการแทน" (ตำแหน่งที่ไม่ใช่การรักษาราชการแทนไม่แตะ)
const ACTING_WORDS = ['รักษาราชการแทน', 'รักษาการแทน', 'ปฏิบัติราชการแทน', 'ทำการแทน']

/**
 * แบ่งชื่อตำแหน่งเป็นบรรทัดสำหรับพิมพ์ใต้เส้นลงนาม (ยังไม่ escape)
 * มีข้อความทั้งก่อนและหลังคำว่ารักษาราชการแทน = 2 บรรทัด นอกนั้นคืนบรรทัดเดียวตามเดิม
 */
export function govSplitActingTitle(title) {
  const text = String(title ?? '').replace(/\s+/g, ' ').trim()
  for (const word of ACTING_WORDS) {
    const at = text.indexOf(word)
    if (at <= 0) continue
    const first = text.slice(0, at + word.length).trim()
    const second = text.slice(at + word.length).trim()
    if (second) return [first, second]
  }
  return text ? [text] : []
}

/**
 * ชื่อตำแหน่งสำรองของหัวหน้าส่วนราชการที่ถือเรื่อง ใช้เมื่อยังไม่ได้ตั้งผู้ลงนามของกองนั้น
 * กติกาเดียวกับใบคำร้อง (councilFormPrint.js) เพื่อให้เอกสารคนละใบของ อปท. เดียวกัน
 * เรียกตำแหน่งเหมือนกัน
 */
export function govDepartmentHeadTitle(departmentName) {
  if (departmentName === 'สำนักปลัด') return 'หัวหน้าสำนักปลัด'
  if (departmentName?.startsWith('กอง')) return `ผู้อำนวยการ${departmentName}`
  return departmentName
    ? `หัวหน้าส่วนราชการผู้รับผิดชอบ (${departmentName})`
    : 'หัวหน้าส่วนราชการผู้รับผิดชอบ'
}

/**
 * บล็อกลงนามเจ้าหน้าที่ 3 ตำแหน่ง
 *
 * @param {object} args
 * @param {{department_head?: object, clerk?: object, mayor?: object}|null} args.signatories
 *   แต่ละช่องเป็น { name, title, authority_reference } หรือ null (= พิมพ์เส้นประให้เขียนมือ)
 *   ส่ง null ทั้งก้อน = ไม่พิมพ์บล็อกนี้เลย (ใบที่ประชาชนพิมพ์เองจากเมนูคำขอของฉัน)
 * @param {object} args.tenant       ใช้หาชื่อตำแหน่งปลัด/นายกพร้อมชื่อหน่วยงาน
 * @param {string} [args.departmentName] ชื่อกองที่ถือเรื่อง ใช้เป็นตำแหน่งสำรองของช่องแรก
 */
export function govStaffSignBlockHtml({ signatories, tenant, departmentName = '' }) {
  if (!signatories) return ''
  const cell = (person, fallbackTitle) => `
      <div class="center-row staff-sign-cell">
        ${govSignRow({
    width: GOV_SIGN_LINE_W,
    below: [
      person?.name ? `(${esc(person.name)})` : govNameBlank(GOV_SIGN_LINE_W),
      ...govSplitActingTitle(person?.title || fallbackTitle).map(esc),
      // 11pt — เลขที่คำสั่งรักษาราชการแทน เป็นข้อความประกอบใต้ตำแหน่ง ไม่ใช่เนื้อความ
      // ผู้ลงนามที่ไม่ใช่เจ้าของตำแหน่งต้องแสดงฐานอำนาจ ไม่งั้นเอกสารถูกทักท้วงได้
      person?.authority_reference
        ? `<span style="font-size:11pt">(${esc(person.authority_reference)})</span>`
        : '',
    ].filter(Boolean),
  })}
      </div>`
  return `
    <section class="staff-sign">
      <div class="staff-sign-row">
        ${cell(signatories.department_head, govDepartmentHeadTitle(departmentName))}
        ${cell(signatories.clerk, orgClerkTitle(tenant))}
      </div>
      <div class="staff-sign-row staff-sign-row--last">
        ${cell(signatories.mayor, orgHeadTitle(tenant))}
      </div>
    </section>`
}

/**
 * CSS ของบล็อก — ต้องใส่คู่กับ govSignBlockCss() ของ govSignBlock.js เสมอ
 * (บล็อกนี้ใช้ .sign-* และ .center-row จากไฟล์นั้น)
 */
export function govStaffSignBlockCss() {
  return `
  /* ── ช่องลงนามเจ้าหน้าที่ (govStaffSignBlock.js) ── */
  .staff-sign { margin-top: 8mm; break-inside: avoid; page-break-inside: avoid; }
  .staff-sign-row { display: flex; justify-content: space-between; }
  .staff-sign-row--last { justify-content: flex-end; margin-top: 8mm; }
  .staff-sign-cell { width: 48%; }
  /* ⚠️ แถวบนแบ่ง 46/54 ไม่ใช่ 48/48 — คอลัมน์ขวาเป็นของปลัด ซึ่งบางครั้งเป็นผู้รักษาราชการแทนที่ตำแหน่งยาวที่สุด
     ("ผู้อำนวยการกองช่าง รักษาราชการแทน" วัดแล้วล้นขอบขวา 4px เมื่อคอลัมน์ 48%) คอลัมน์ซ้ายตำแหน่งสั้นเหลือที่เหลือเฟือ */
  .staff-sign-row:not(.staff-sign-row--last) .staff-sign-cell:first-child { width: 46%; }
  .staff-sign-row:not(.staff-sign-row--last) .staff-sign-cell:last-child { width: 54%; }
  /* ⚠️ คอลัมน์แถวล่างกว้าง 54% ไม่ใช่ 48% เท่าแถวบน — ชื่อตำแหน่งนายกยาวกว่าปลัด
     เหตุผลเดียวกับใบคำร้อง (councilFormPrint.js) ซึ่งวัดแล้วล้นขอบขวา 4px ถ้าใช้ 48% */
  .staff-sign-row--last .staff-sign-cell { width: 54%; }`
}
