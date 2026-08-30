// บัตรเข้าใช้งานระบบ — พิมพ์ให้ประชาชนถือกลับบ้าน หลังเจ้าหน้าที่ตั้งรหัสผ่านชั่วคราวให้ที่สำนักงาน
//
// ทำไมต้องเป็นกระดาษ ไม่ใช่แค่แสดงบนจอ: ผู้ใช้กลุ่มใหญ่ของระบบคือผู้สูงอายุที่จำอีเมลและรหัสผ่าน
// ตัวเองไม่ได้ ซึ่งเป็นเหตุผลที่เขามาที่สำนักงานตั้งแต่แรก การอ่านรหัส 10 ตัวให้ฟังที่เคาน์เตอร์แล้ว
// ให้เดินกลับบ้านไปพิมพ์เองจึงไม่จบงาน — เดินออกจากประตูก็ลืมแล้ว วนกลับมาใหม่รอบหน้า
//
// บัตรจงใจใส่ "ชื่อผู้ใช้" ไว้ด้วยเสมอ ไม่ใช่แค่รหัสผ่าน เพราะของที่เขาจำไม่ได้คือทั้งคู่ และช่องว่าง
// ให้เขียนรหัสใหม่ด้วยลายมือตัวเองมีไว้ตั้งใจ — คนกลุ่มนี้จดใส่กระดาษอยู่แล้วในชีวิตจริง
// สู้ให้จดในที่ที่มีคำเตือนกำกับ ดีกว่าปล่อยให้ไปจดแปะไว้หลังมือถือ
//
// ⚠️ PDPA: แผ่นนี้ = เข้าบัญชีได้ทันที ต้องส่งให้เจ้าตัวเท่านั้นและห้ามสำนักงานเก็บสำเนาไว้
// คำเตือนจึงพิมพ์ลงบนตัวแผ่นเอง ไม่ใช่ขึ้นแค่บนหน้าจอที่ปิดแล้วหายไปพร้อมกัน

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// เว้นวรรคเบอร์เป็น 3-3-4 ให้อ่านออกเสียงตามได้ทีละกลุ่ม ไม่ใช่พรวดเดียว 10 ตัว
function prettyPhone(digits) {
  const d = String(digits ?? '')
  return /^0\d{9}$/.test(d) ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d
}

/**
 * @param {object}  args
 * @param {string}  args.fullName    ชื่อผู้ถือบัตร
 * @param {string}  args.loginValue  ชื่อผู้ใช้ที่ต้องพิมพ์ตอนล็อกอิน (เบอร์ หรืออีเมลจริง)
 * @param {'phone'|'email'|'none'} args.loginKind
 * @param {string}  args.password    รหัสผ่านชั่วคราวที่เพิ่งตั้ง
 * @param {object}  args.tenant      อปท. เจ้าของระบบ (name/phone/address)
 * @param {string}  args.appOrigin   URL ที่ให้ผู้ใช้เปิด
 */
export function buildAccountCardHtml({ fullName, loginValue, loginKind, password, tenant, appOrigin }) {
  const issuedAt = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
  const shownLogin = loginKind === 'phone' ? prettyPhone(loginValue) : loginValue
  const loginTitle = loginKind === 'phone' ? 'ชื่อผู้ใช้ (เบอร์โทรศัพท์ของท่าน)' : 'ชื่อผู้ใช้ (อีเมลของท่าน)'

  // บัญชีที่ไม่มีอีเมลใน auth.users เลย (สมัครด้วย LINE ที่ channel ยังไม่ได้สิทธิ์ขอ email)
  // ตั้งรหัสผ่านให้ไปก็ล็อกอินไม่ได้ เพราะไม่มีชื่อผู้ใช้ให้พิมพ์คู่กับรหัส — บัตรต้องบอกความจริง
  // ข้อนี้ให้เจ้าหน้าที่รู้ตรงนั้นเลย ดีกว่าปล่อยให้ประชาชนถือกระดาษที่ใช้ไม่ได้กลับบ้านไป
  const loginBlock = loginKind === 'none'
    ? `<div class="warn-block">
         <div class="warn-title">บัญชีนี้ยังใช้รหัสผ่านล็อกอินไม่ได้</div>
         <div>บัญชีนี้ผูกกับ LINE อย่างเดียว ยังไม่มีชื่อผู้ใช้สำหรับพิมพ์คู่กับรหัสผ่าน</div>
         <div>เจ้าหน้าที่ต้องตั้ง &ldquo;อีเมลสำหรับเข้าสู่ระบบ&rdquo; ให้บัญชีนี้ก่อนที่หน้าจัดการผู้ใช้ แล้วจึงพิมพ์บัตรใหม่</div>
       </div>`
    : `<div class="field">
         <div class="label">${esc(loginTitle)}</div>
         <div class="value">${esc(shownLogin)}</div>
       </div>`

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<title>บัตรเข้าใช้งานระบบ</title>
<style>
  @page { size: A5 portrait; margin: 1.2cm; }
  body { font-family: 'Sarabun', sans-serif; font-size: 14px; color: #111; line-height: 1.55; margin: 0; }
  .card { border: 2px solid #111; border-radius: 10px; padding: 16px 18px; }
  .org { text-align: center; font-size: 15px; font-weight: 700; }
  .head { text-align: center; font-size: 19px; font-weight: 700; margin-top: 2px; }
  .sub { text-align: center; font-size: 12px; color: #444; margin-top: 2px; }
  .rule { border-top: 1px solid #999; margin: 12px 0; }
  .field { margin-bottom: 12px; }
  .label { font-size: 12px; color: #444; }
  /* ตัวใหญ่และไม่ใช่ฟอนต์ประดิษฐ์ ตั้งใจให้สายตาผู้สูงอายุอ่านออกโดยไม่ต้องใส่แว่นอ่านหนังสือ */
  .value { font-family: 'Courier New', monospace; font-size: 26px; font-weight: 700; letter-spacing: 2px; }
  .write-in { border: 1px dashed #666; border-radius: 8px; padding: 8px 10px; margin-top: 4px; }
  .write-line { border-bottom: 1px solid #333; height: 30px; margin-top: 4px; }
  .steps { font-size: 13px; padding-left: 18px; margin: 0; }
  .steps li { margin-bottom: 3px; }
  .warn-block { border: 1.5px solid #b45309; background: #fffbeb; border-radius: 8px; padding: 8px 10px; font-size: 12.5px; margin-bottom: 12px; }
  .warn-title { font-weight: 700; margin-bottom: 2px; }
  .foot { font-size: 11.5px; color: #444; margin-top: 12px; }
  .pdpa { font-size: 11.5px; border-top: 1px dashed #999; margin-top: 10px; padding-top: 6px; }
  @media print { button { display: none; } }
</style></head><body>
<div class="card">
  <div class="org">${esc(tenant?.name ?? '')}</div>
  <div class="head">บัตรเข้าใช้งานระบบ</div>
  <div class="sub">กรุณาเก็บไว้กับตัว อย่าให้ผู้อื่นเห็น</div>

  <div class="rule"></div>

  <div class="field">
    <div class="label">ชื่อผู้ถือบัตร</div>
    <div style="font-size:17px;font-weight:700;">${esc(fullName || '—')}</div>
  </div>

  ${loginBlock}

  <div class="field">
    <div class="label">รหัสผ่านชั่วคราว (พิมพ์ตัวเล็กทั้งหมด)</div>
    <div class="value">${esc(password)}</div>
  </div>

  <div class="field">
    <div class="label">เมื่อเปลี่ยนรหัสผ่านเองแล้ว ให้เขียนรหัสใหม่ไว้ตรงนี้</div>
    <div class="write-in">
      <div class="write-line"></div>
    </div>
  </div>

  <div class="rule"></div>

  <div class="label" style="margin-bottom:4px;">วิธีเข้าใช้งาน</div>
  <ol class="steps">
    <li>เปิดเว็บไซต์ <strong>${esc(appOrigin ?? '')}</strong></li>
    <li>กด &ldquo;เข้าสู่ระบบ&rdquo; แล้วกรอกชื่อผู้ใช้กับรหัสผ่านชั่วคราวข้างบน</li>
    <li>ไปที่หน้า &ldquo;โปรไฟล์&rdquo; แล้วเปลี่ยนรหัสผ่านเป็นรหัสที่ท่านจำได้ทันที</li>
    <li>ติ๊ก &ldquo;จำการเข้าสู่ระบบไว้บนเครื่องนี้&rdquo; ไว้ จะได้ไม่ต้องกรอกรหัสอีกทุกครั้ง</li>
  </ol>

  <div class="foot">
    ออกให้เมื่อ ${esc(issuedAt)}
    ${tenant?.phone ? `&nbsp;·&nbsp; สอบถาม โทร. ${esc(tenant.phone)}` : ''}
    ${tenant?.address ? `<div>${esc(String(tenant.address).replace(/\s*\n\s*/g, ' '))}</div>` : ''}
  </div>

  <div class="pdpa">
    <strong>ข้อควรระวัง</strong> รหัสผ่านชั่วคราวนี้ใช้เข้าบัญชีของท่านได้ทันทีจนกว่าจะเปลี่ยนเอง
    เจ้าหน้าที่ต้องมอบแผ่นนี้ให้เจ้าของบัญชีเท่านั้น และไม่เก็บสำเนาไว้ที่สำนักงาน
  </div>
</div>
</body></html>`
}
