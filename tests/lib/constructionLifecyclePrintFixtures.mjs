// ข้อมูลตัวอย่างของใบพิมพ์วงจรโครงการก่อสร้าง P8–P12 (ใช้ร่วมเทสต์ unit + เลย์เอาต์ + ถ่ายภาพ)
// กรรมการ 3 คน · cause/detail ยาว ~300 ตัวอักษร (ข้อมูลยาวสุดที่ใบต้องยังจบ 1 แผ่น)
// ⚠️ ค่า inspection_result / decision / result ตั้งไว้ "เต็ม" โดยตั้งใจ — เทสต์ยืนยันว่าใบไม่เอาไปติ๊กช่องผลให้ (ระบบไม่ตัดสินแทนคน)

export const TENANT = {
  name: 'องค์การบริหารส่วนตำบลทดสอบ',
  org_type: 'อบต.',
  address: '99 หมู่ที่ 1 ตำบลทดสอบ\nอำเภอตัวอย่าง จังหวัดแพร่ 54000',
}

export const EVIL = '<img src=x onerror=alert(1)>'

const LONG_CAUSE = 'ฝนตกหนักต่อเนื่องหลายวันทำให้น้ำท่วมขังพื้นที่ก่อสร้างช่วงกิโลเมตรที่ 0+200 ถึง 0+650 ไม่สามารถเทคอนกรีตผิวทางได้ตามแผน '
  + 'ผู้รับจ้างได้แจ้งผู้ควบคุมงานทราบเป็นลายลักษณ์อักษรแล้วและรอให้น้ำลดลงจึงเข้าดำเนินการต่อได้ จึงขอขยายระยะเวลาทำการตามสัญญาเพื่อชดเชยวันที่ไม่สามารถทำงานได้ดังกล่าว'

export function fixture({ long = true, evil = '', committee = 3, guaranteeType = 'bank_guarantee', withSignatories = true } = {}) {
  const e = text => `${text}${evil}`
  const project = {
    id: 'p1', title: e('ก่อสร้างถนน คสล. สายบ้านหนองทดสอบ หมู่ที่ 5'), contract_no: e('25/2569'), contractor_name: e('หจก.ทดสอบก่อสร้าง'),
    contract_amount: 1250000, end_date: '2026-11-28', department_id: 'd1', municipality_id: 'm1',
  }
  const contract = {
    project_id: 'p1', contract_date: '2026-09-01', extended_until: '2026-12-13', fine_per_day: 1250, installments_total: 3,
    guarantee_type: guaranteeType, guarantee_ref: e('BG-2569/0042'), guarantee_amount: 62500,
    warranty_months: 24, warranty_starts_on: '2026-12-14', warranty_ends_on: '2028-12-13',
  }
  const names = ['นายสมชาย ใจดีมาก', 'นางสาวสมหญิง รักงานดี', 'นายสมศักดิ์ ตรวจรับเก่ง', 'นางสุดา พัสดุดี', 'นายประเสริฐ ช่างเก่ง']
  const duties = ['ประธานกรรมการ', 'กรรมการ', 'กรรมการ', 'กรรมการ', 'กรรมการและเลขานุการ']
  const people = Array.from({ length: committee }, (_, i) => ({
    id: `c${i}`, project_id: 'p1', grp: 'committee', sort_order: i + 1, name: e(names[i % names.length]), position_title: 'วิศวกรโยธา', duty: duties[i % duties.length],
  }))
  // คนนอกกลุ่มกรรมการตรวจรับ ต้องไม่ถูกพิมพ์เป็นกรรมการ
  people.push({ id: 's1', project_id: 'p1', grp: 'supervisor', sort_order: 1, name: 'นายผู้ควบคุมงาน ห้ามออกใบกรรมการ', position_title: '', duty: 'หัวหน้าผู้ควบคุมงาน' })
  const installment = {
    id: 'i2', project_id: 'p1', installment_no: 2, amount: 625000, work_pct: 50, due_on: '2026-11-10', delivered_on: '2026-11-12',
    delivery_ref_no: e('รับ 88/2569'), inspected_on: '2026-11-15', inspection_result: 'accepted', inspection_reason: 'MARK-INSPECTION-REASON', inspection_dissent: 'MARK-DISSENT', fine_reserved: true,
  }
  const changeBase = {
    id: 'ch1', project_id: 'p1', cause: e(long ? LONG_CAUSE : 'ฝนตกหนัก'), cause_ended_on: '2026-10-20', request_received_on: '2026-10-30',
    requested_days: 15, ref_no: e('ผจ 12/2569'), ref_date: '2026-10-29', decision: 'approved', approved_on: '2026-11-05', approved_days: 77,
  }
  const extend = { ...changeBase, kind: 'extend_time', new_end_date: '2026-12-13' }
  const amend = { ...changeBase, kind: 'amend_contract', amount_change: -50000, new_end_date: '2026-12-13', note: e('ปรับลดงานคันทางส่วนที่ไม่จำเป็น'), egp_published_on: '2026-11-07' }
  const defect = {
    id: 'df1', project_id: 'p1', inspected_on: '2028-11-20', kind: 'final_before_expiry', result: 'defect',
    detail: e(long
      ? 'พบรอยแตกร้าวตามยาวของแผ่นพื้นคอนกรีตช่วงกิโลเมตรที่ 0+300 ถึง 0+420 ความยาวรวมประมาณ 85 เมตร\nพบการทรุดตัวของไหล่ทางด้านซ้ายลึกประมาณ 12 เซนติเมตร และรางระบายน้ำตลอดแนวมีตะกอนดินอุดตันเนื่องจากความลาดเอียงไม่เป็นไปตามแบบ\nรอยต่อระหว่างแผ่นพื้นหลายจุดยาแนวหลุดร่อนจนน้ำซึมลงชั้นรองพื้นทาง'
      : 'พบรอยแตกร้าว'),
    fix_due_on: '2028-12-05',
  }
  const signatories = withSignatories ? {
    department_head: { name: 'นายสมบัติ ผู้อำนวยการ', title: 'ผู้อำนวยการกองช่าง' },
    clerk: { name: 'นางสมศรี ปลัดดี', title: 'ปลัดองค์การบริหารส่วนตำบลทดสอบ' },
    mayor: { name: 'นายสมพงษ์ นายกดี', title: 'นายกองค์การบริหารส่วนตำบลทดสอบ' },
  } : null
  return {
    tenant: TENANT, project, contract, people, installment, extend, amend, defect, signatories,
    warranty: { start: contract.warranty_starts_on, end: contract.warranty_ends_on, months: 24 },
    departmentName: 'กองช่าง', printedAt: new Date(2026, 10, 8, 9, 30),
  }
}
