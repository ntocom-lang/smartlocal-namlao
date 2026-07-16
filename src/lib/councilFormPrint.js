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

// แบบฟอร์ม "คำร้อง" ทางการ — ใช้เมื่อผู้แจ้งเป็นสมาชิกสภา (role: council)
// อ้างอิงจากแบบฟอร์มกระดาษจริงที่เทศบาลตำบลน้ำเลาใช้งานอยู่
// terminology มาจาก useTenant() — ให้คำเรียกตำแหน่งถูกต้องตาม org_type ของแต่ละหน่วยงาน
export function buildCouncilComplaintHtml({ c, tenant, terminology, num, thDate, cat, phone, staffList }) {
  const d = new Date(c.created_at)
  const dayNum = d.toLocaleDateString('th-TH', { day: 'numeric' })
  const monthName = d.toLocaleDateString('th-TH', { month: 'long' })
  const yearBE = d.getFullYear() + 543
  const loc = locationName(tenant)
  const reporter = c.reporter_name || c.profiles?.full_name || '.................................................'

  const mayorTitle = (terminology?.mayor ?? 'นายก') + loc
  const clerkTitle = (terminology?.clerk ?? 'ปลัด') + loc
  const councilTitle = (terminology?.council ?? 'สมาชิกสภา') + loc

  const mayor = staffList?.find((s) => s.role === 'mayor')
  const clerk = staffList?.find((s) => s.role === 'clerk')
  const deptHead = staffList?.find((s) => s.role === 'dept_head' && c.department && s.title?.includes(c.department))

  const location1 = [c.location_name, c.village].filter(Boolean).join(', ')
  const point1 = [location1, c.detail].filter(Boolean).join(' — ') || '.................................................................................................'

  const signBlock = (person, fallbackTitle) => `
    <div style="width:45%;text-align:center;">
      <div>ลงชื่อ.................................................</div>
      <div style="margin-top:38px;">(${esc(person?.name) || '.........................................................'})</div>
      <div>${esc(person?.title) || esc(fallbackTitle)}</div>
    </div>`

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
<title>คำร้อง ${num}</title>
<style>
  @page { size: A4 portrait; margin: 2cm 2.5cm; }
  body { font-family: 'Sarabun', sans-serif; font-size: 15px; color: #111; line-height: 1.9; position: relative; }
  .center { text-align: center; }
  .req-no { position: absolute; top: 0; right: 0; border: 1px solid #000; padding: 6px 14px; font-size: 13px; line-height: 1.8; }
  .indent { text-indent: 2em; }
  .points div { margin: 4px 0; }
  @media print { button { display: none; } }
</style></head><body>
<div class="req-no">
  <div>คำร้องเลขที่ ${esc(num)}</div>
  <div>ลงวันที่ ${esc(thDate)}</div>
</div>

<p class="center" style="font-size:19px;font-weight:700;margin-top:8px;">คำร้อง</p>
<p class="center">วันที่ ${esc(dayNum)} เดือน ${esc(monthName)} พ.ศ. ${yearBE}</p>

<p style="margin-top:24px;">เรื่อง &nbsp;&nbsp;แจ้งซ่อมแซม${esc(cat)}</p>
<p>เรียน &nbsp;&nbsp;${esc(mayorTitle)}</p>

<p class="indent">ข้าพเจ้า ${esc(reporter)} ${esc(councilTitle)} เขตที่ .................</p>
<p>${esc(loc)} อำเภอ................. จังหวัด${tenant?.province ? esc(tenant.province) : ' .................'} โทรศัพท์ ${esc(phone)}</p>

<p class="indent" style="margin-top:12px;">
  มีความประสงค์แจ้งซ่อมแซม${esc(cat)} เพื่อความปลอดภัยในชีวิตและทรัพย์สินของราษฎรในพื้นที่
  จึงขอความอนุเคราะห์${esc(tenant?.name ?? '')}ให้ความอนุเคราะห์ในการซ่อมแซม${esc(cat)}ให้ใช้งานได้ตามปกติ
</p>

<div class="points" style="margin-top:16px;">
  <div>จุดที่ 1 &nbsp;${esc(point1)}</div>
  <div>จุดที่ 2 &nbsp;.................................................................................................</div>
  <div>จุดที่ 3 &nbsp;.................................................................................................</div>
  <div>จุดที่ 4 &nbsp;.................................................................................................</div>
</div>

<p style="margin-top:20px;">จึงเรียนมาเพื่อโปรดพิจารณาดำเนินการ</p>

<p class="center" style="margin-top:24px;">ขอแสดงความนับถือ</p>
<p class="center" style="margin-top:44px;">.................................................</p>
<p class="center">(...........................................)</p>

<div style="display:flex;justify-content:space-between;margin-top:40px;">
  ${signBlock(deptHead, 'ผู้อำนวยการกองช่าง')}
  ${signBlock(clerk, clerkTitle)}
</div>

<div style="text-align:center;margin-top:44px;">
  <div>ลงชื่อ.................................................</div>
  <div style="margin-top:38px;">(${esc(mayor?.name) || '.........................................................'})</div>
  <div>${esc(mayor?.title) || esc(mayorTitle)}</div>
</div>

</body></html>`
}
