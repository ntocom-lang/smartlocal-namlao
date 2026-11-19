import assert from 'node:assert/strict'
import { buildCivilApprovalHtml } from '../src/lib/civilApprovalPrint.js'

const TENANT = { name: 'องค์การบริหารส่วนตำบลน้ำเลา', phone: '054-123456' }
const PROJECT = {
  id: 'test-proj-01',
  title: 'โครงการก่อสร้างถนน คสล. สายทางเข้าหมู่บ้าน หมู่ที่ 2',
  fiscal_year: '2568',
  budget_amount: 1250000,
  location_desc: 'หมู่ที่ 2 บ้านน้ำเลา',
}
const DATA = {
  docNo: 'พล 72303/10',
  docDate: '2026-10-15',
  proposerName: 'สมศักดิ์ ช่างใหญ่',
  proposerPosition: 'ผู้อำนวยการกองช่าง',
  committee: [
    { name: 'สมชาย รักงาน', position_title: 'ผู้อำนวยการกองช่าง', duty: 'ประธานกรรมการ' },
    { name: 'ประสิทธิ์ วิศวกรรม', position_title: 'นายช่างโยธาชำนาญงาน', duty: 'กรรมการ' },
    { name: 'บุญมี มีสุข', position_title: 'นายช่างสำรวจปฏิบัติงาน', duty: 'กรรมการ' },
  ],
}

const html = buildCivilApprovalHtml({
  tenant: TENANT,
  project: PROJECT,
  data: DATA,
  emblemUrl: 'http://localhost/images/garuda.svg',
})

assert.ok(html.includes('<!DOCTYPE html>'))
assert.ok(html.includes('บันทึกข้อความ'))
assert.ok(html.includes('ขออนุมัติจัดทำแบบรูปรายการละเอียดงานก่อสร้าง'))
assert.ok(html.includes('โครงการก่อสร้างถนน คสล. สายทางเข้าหมู่บ้าน หมู่ที่ 2'))
assert.ok(html.includes('1,250,000.00 บาท (หนึ่งล้านสองแสนห้าหมื่นบาทถ้วน)'))
assert.ok(html.includes('สมศักดิ์ ช่างใหญ่'))
assert.ok(html.includes('สมชาย รักงาน'))
assert.ok(html.includes('ประสิทธิ์ วิศวกรรม'))
assert.ok(html.includes('บุญมี มีสุข'))

console.log('✓ civilApprovalPrint test passed successfully')
