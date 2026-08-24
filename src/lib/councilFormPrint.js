function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// คำนำหน้าชื่อองค์กรตาม org_type (เทศบาลนคร/เทศบาลเมือง/เทศบาลตำบล/อบต.) —
// ใช้ตัดออกจาก tenant.name เพื่อประกอบเป็น "นายกเทศมนตรีตำบลน้ำเลา" แทนที่จะซ้ำคำว่า
// เทศบาล/อบต. สองรอบ เช่น "นายกเทศมนตรีเทศบาลตำบลน้ำเลา"
const ORG_STRIP = {
  'เทศบาลนคร': 'เทศบาล',
  'เทศบาลเมือง': 'เทศบาล',
  'เทศบาลตำบล': 'เทศบาล',
  'เทศบาล': 'เทศบาล',
  'อบต.': 'องค์การบริหารส่วนตำบล',
}

function locationName(tenant) {
  const strip = ORG_STRIP[tenant?.org_type]
  if (!strip || !tenant?.name) return tenant?.name ?? ''
  return tenant.name.replace(strip, '').trim()
}

// ชื่อพื้นที่ล้วนๆ ไม่มีคำนำหน้าติดมา (ต่างจาก locationName ที่ตั้งใจเหลือ "ตำบล/เมือง/นคร"
// ติดไว้สำหรับประกอบตำแหน่งนายก) ใช้ได้เฉพาะ เทศบาลตำบล/อบต. เพราะสองแบบนี้เท่านั้นที่ปกครอง
// พื้นที่ตรงกับชื่อตำบลเดียวกันเป๊ะ — เทศบาลเมือง/นครมักคาบเกี่ยวหลายตำบล เดาไม่ได้ ปล่อยว่างไว้ดีกว่า
const SUBDISTRICT_STRIP = {
  'เทศบาลตำบล': 'เทศบาลตำบล',
  'อบต.': 'องค์การบริหารส่วนตำบล',
}
function bareSubdistrictName(tenant) {
  const strip = SUBDISTRICT_STRIP[tenant?.org_type]
  if (!strip || !tenant?.name) return ''
  return tenant.name.replace(strip, '').trim()
}

const REPAIR_CATEGORIES = new Set([
  'light', 'road', 'road_concrete', 'road_asphalt', 'road_slurry', 'road_gravel',
  'drain', 'manhole', 'pipe_water',
])

const INSPECTION_CATEGORIES = new Set([
  'trash', 'flood', 'noise', 'waste_water', 'pollution', 'animals', 'building',
])

function buildRequestCopy(category, categoryLabel, tenantName) {
  const label = categoryLabel || 'เรื่องที่แจ้ง'
  const org = tenantName || 'หน่วยงาน'

  if (category === 'mosquito') {
    return {
      subject: 'ขอความอนุเคราะห์ดำเนินการควบคุมและกำจัดยุง',
      body: `มีความประสงค์ขอความอนุเคราะห์${org}ตรวจสอบพื้นที่และดำเนินการควบคุมและกำจัดยุงบริเวณที่ระบุด้านล่าง เพื่อป้องกันและลดความเสี่ยงจากโรคที่มียุงเป็นพาหะ`,
    }
  }

  if (category === 'disease') {
    return {
      subject: 'ขอความอนุเคราะห์ดำเนินการควบคุมโรคติดต่อ',
      body: `มีความประสงค์ขอความอนุเคราะห์${org}ตรวจสอบและดำเนินการควบคุมโรคติดต่อบริเวณที่ระบุด้านล่างตามความเหมาะสม`,
    }
  }

  if (category === 'water_supply') {
    return {
      subject: 'ขอรับการสนับสนุนน้ำอุปโภค-บริโภค',
      body: `มีความประสงค์ขอรับการสนับสนุนน้ำอุปโภค-บริโภคจาก${org} ณ สถานที่และตามรายละเอียดที่ระบุด้านล่าง`,
    }
  }

  if (category === 'borrow_equipment') {
    return {
      subject: 'ขอยืมใช้พัสดุหรืออุปกรณ์ของทางราชการ',
      body: `มีความประสงค์ขอยืมใช้พัสดุหรืออุปกรณ์ของ${org} ตามรายการ วัตถุประสงค์ และสถานที่ที่ระบุด้านล่าง`,
    }
  }

  if (category === 'suction') {
    return {
      subject: 'ขอรับบริการดูดสิ่งปฏิกูล',
      body: `มีความประสงค์ขอรับบริการดูดสิ่งปฏิกูลจาก${org} ณ สถานที่และตามรายละเอียดที่ระบุด้านล่าง`,
    }
  }

  if (category === 'tree' || category === 'canal') {
    return {
      subject: `ขอความอนุเคราะห์ดำเนินการเกี่ยวกับ${label}`,
      body: `มีความประสงค์ขอความอนุเคราะห์${org}ตรวจสอบและพิจารณาดำเนินการเกี่ยวกับ${label} ณ สถานที่และตามรายละเอียดที่ระบุด้านล่าง`,
    }
  }

  if (category === 'grievance') {
    return {
      subject: 'ขอให้ตรวจสอบและแก้ไขความเดือดร้อน',
      body: `มีความประสงค์ยื่นเรื่องร้องทุกข์ต่อ${org} เพื่อขอให้ตรวจสอบข้อเท็จจริงและพิจารณาดำเนินการแก้ไขความเดือดร้อนตามรายละเอียดที่ระบุด้านล่าง`,
    }
  }

  if (category === 'corruption') {
    return {
      subject: 'แจ้งเบาะแสหรือข้อร้องเรียนเกี่ยวกับการทุจริต',
      body: `มีความประสงค์แจ้งเบาะแสหรือข้อร้องเรียนเกี่ยวกับการทุจริตต่อ${org} เพื่อขอให้ตรวจสอบข้อเท็จจริงและดำเนินการตามอำนาจหน้าที่`,
    }
  }

  if (REPAIR_CATEGORIES.has(category)) {
    return {
      subject: `แจ้ง${label}ชำรุด`,
      body: `มีความประสงค์แจ้ง${label}ชำรุด และขอความอนุเคราะห์${org}ตรวจสอบและดำเนินการซ่อมแซม ณ สถานที่และตามรายละเอียดที่ระบุด้านล่าง`,
    }
  }

  if (INSPECTION_CATEGORIES.has(category)) {
    return {
      subject: `แจ้งปัญหา${label}`,
      body: `มีความประสงค์แจ้งปัญหา${label} และขอให้${org}ตรวจสอบข้อเท็จจริงและพิจารณาดำเนินการแก้ไขตามอำนาจหน้าที่`,
    }
  }

  return {
    subject: `ขอให้พิจารณาดำเนินการเกี่ยวกับ${label}`,
    body: `มีความประสงค์ขอให้${org}ตรวจสอบและพิจารณาดำเนินการเกี่ยวกับ${label} ตามสถานที่และรายละเอียดที่ระบุด้านล่าง`,
  }
}

function departmentHeadFallback(department) {
  if (department === 'สำนักปลัด') return 'หัวหน้าสำนักปลัด'
  if (department?.startsWith('กอง')) return `ผู้อำนวยการ${department}`
  return department
    ? `หัวหน้าส่วนราชการผู้รับผิดชอบ (${department})`
    : 'หัวหน้าส่วนราชการผู้รับผิดชอบ'
}

// ใบคำร้องทางการ — ใช้กับคำร้องทุกประเภท ไม่ว่าผู้แจ้งจะเป็นประชาชนทั่วไปหรือสมาชิกสภา
// อ้างอิงจากแบบฟอร์มกระดาษจริงที่เทศบาลตำบลน้ำเลาใช้งานอยู่
// terminology มาจาก useTenant() — ให้คำเรียกตำแหน่งถูกต้องตาม org_type ของแต่ละหน่วยงาน
//
// includeStaffSignatures: false สำหรับ Draft PDF ที่จะเอาไปยื่นลงนามจริงที่ GDCC e-Office —
// ต้องไม่มีบล็อกลงชื่อ (กองช่าง/ปลัด/นายก) ในไฟล์ draft เลย เพราะผู้มีอำนาจจะลงนามที่ GDCC
// โดยตรง ถ้าใส่บล็อกลงชื่อเปล่าไปด้วยจะสับสนว่าต้องเซ็นในไฟล์นี้หรือเซ็นที่ GDCC — ปุ่ม
// "พิมพ์" ยังคงบล็อกลงชื่อไว้ตามเดิม (ใช้เป็นแบบฟอร์มกระดาษเวียนเซ็นในสำนักงานได้)
export function buildCouncilComplaintHtml({ c, tenant, terminology, num, thDate, cat, phone, staffList, includeStaffSignatures = true }) {
  const loc = locationName(tenant)
  const reporter = c.reporter_name || c.profiles?.full_name || '.................................................'

  const mayorTitle = (terminology?.mayor ?? 'นายก') + loc
  const clerkTitle = (terminology?.clerk ?? 'ปลัด') + loc
  const councilTitle = (terminology?.council ?? 'สมาชิกสภา') + loc

  // ตำแหน่ง/ที่อยู่ผู้ร้อง — ใช้ข้อมูลบัญชีของผู้ยื่นก่อนเสมอ
  // รองรับทั้งที่อยู่แบบแยกช่องใน "ข้อมูลบัญชีของฉัน" และช่อง address เดิมของระบบ
  // เมื่อบัญชีไม่มีที่อยู่จึงใช้พื้นที่ของหน่วยงาน (tenant) แล้วค่อยเว้นจุดไข่ปลา
  // เป็นทางเลือกสุดท้าย — แต่ "เขตที่ ..." เฉพาะสมาชิกสภาเท่านั้น (ประชาชนทั่วไปไม่มีเขตเลือกตั้ง ใส่ให้ผิดความหมาย)
  const p = c.profiles
  const positionLine = p?.job_title
    || (c.profiles?.role === 'council' ? `${councilTitle} เขตที่ .................` : '')
  const hasStructuredProfileAddress = [
    p?.address_detail,
    p?.address_moo,
    p?.address_subdistrict,
    p?.address_district,
    p?.address_province,
  ].some(Boolean)
  const addrParts = hasStructuredProfileAddress
    ? [
        p?.address_detail,
        p?.address_moo ? `หมู่ที่ ${p.address_moo}` : null,
        `ตำบล${p?.address_subdistrict || bareSubdistrictName(tenant) || '.................'}`,
        `อำเภอ${p?.address_district || tenant?.district || '.................'}`,
        `จังหวัด${p?.address_province || tenant?.province || '.................'}`,
      ].filter(Boolean)
    : p?.address
      ? [p.address]
      : [
          `ตำบล${bareSubdistrictName(tenant) || '.................'}`,
          `อำเภอ${tenant?.district || '.................'}`,
          `จังหวัด${tenant?.province || '.................'}`,
        ]

  const mayor = staffList?.find((s) => s.role === 'mayor')
  const clerk = staffList?.find((s) => s.role === 'clerk')
  const departmentHead = staffList?.find((s) => s.role === 'dept_head' && c.department && s.title?.includes(c.department))
    || staffList?.find((s) => c.department
      && /หัวหน้า|ผู้อำนวยการ/.test(s.title ?? '')
      && s.title.includes(c.department))
    || (c.department === 'กองช่าง' && tenant?.slug === 'namlao'
      ? { name: 'นายชัยศักดิ์ ชัยธรรม', title: 'ผู้อำนวยการกองช่าง' }
      : null)
  const requestCopy = buildRequestCopy(c.category, cat, tenant?.name)

  const location1 = [c.location_name, c.village].filter(Boolean).join(', ')
  const point1 = [location1, c.detail].filter(Boolean).join(' — ') || '.................................................................................................'

  // อ้างอิงตำแหน่งจากแบบฟอร์มกระดาษจริง: แถวบน กองช่าง+ปลัด สองคอลัมน์ / แถวล่าง นายก อยู่กึ่งกลาง-ขวา
  const signBlock = (person, fallbackTitle, width = '45%') => `
    <div style="width:${width};text-align:center;">
      <div>ลงชื่อ.................................................</div>
      <div style="margin-top:26px;">(${esc(person?.name) || '.........................................................'})</div>
      <div>${esc(person?.title) || esc(fallbackTitle)}</div>
    </div>`

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<title>คำร้อง ${num}</title>
<style>
  @page { size: A4 portrait; margin: 1.6cm 2.5cm; }
  body { font-family: 'Sarabun', sans-serif; font-size: 15px; color: #111; line-height: 1.5; }
  p { margin: 0; }
  .center { text-align: center; }
  .request-refs { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 0; font-size: 12px; line-height: 1.4; }
  .e-service-ref { text-align: left; }
  .official-ref { min-width: 220px; text-align: right; white-space: nowrap; }
  .indent { text-indent: 2em; }
  .points div { margin: 4px 0; }
  @media print { button { display: none; } }
</style></head><body>
<div class="request-refs">
  <div class="e-service-ref">
    <div>คำร้องผ่าน E-Service ${esc(num)}</div>
    <div>ลงวันที่ ${esc(thDate)}</div>
  </div>
  <div class="official-ref">คำร้องเลขที่........................................</div>
</div>

<p class="center" style="font-size:18px;font-weight:700;margin-top:10px;">คำร้อง</p>
<p class="center" style="margin-top:2px;">ผ่านระบบ E-Service ${esc(tenant?.name ?? '')}</p>

<p style="margin-top:16px;">เรื่อง &nbsp;&nbsp;${esc(requestCopy.subject)}</p>
<p style="margin-top:4px;">เรียน &nbsp;&nbsp;${esc(mayorTitle)}</p>

<p class="indent" style="margin-top:8px;">ข้าพเจ้า ${esc(reporter)} ${esc(positionLine)} ${esc(addrParts.join(' '))} <span style="white-space:nowrap;">โทรศัพท์ ${esc(phone)}</span></p>

<p class="indent" style="margin-top:10px;">
  ${esc(requestCopy.body)}
</p>

<div class="points indent" style="margin-top:10px;">
  ${c.issue_type ? `<div>ลักษณะปัญหา &nbsp;${esc(c.issue_type)}</div>` : ''}
  <div>สถานที่ &nbsp;${esc(point1)}</div>
</div>

<p class="indent" style="margin-top:12px;">จึงเรียนมาเพื่อโปรดพิจารณาดำเนินการ</p>

<div style="page-break-inside:avoid;margin-top:16px;">
  <p class="center">ขอแสดงความนับถือ</p>
  <p class="center" style="margin-top:26px;">${esc(reporter)}</p>
  <p class="center" style="margin-top:2px;">(${esc(reporter)})</p>

  ${includeStaffSignatures ? `
  <div style="display:flex;justify-content:space-between;margin-top:24px;">
    ${signBlock(departmentHead, departmentHeadFallback(c.department))}
    ${signBlock(clerk, clerkTitle)}
  </div>

  <div style="display:flex;justify-content:flex-end;margin-top:28px;">
    ${signBlock(mayor, mayorTitle, '45%')}
  </div>` : ''}
</div>

</body></html>`
}
