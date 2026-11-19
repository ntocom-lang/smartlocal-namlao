import assert from 'node:assert/strict'
import { buildCivilMedianHtml } from '../src/lib/civilMedianPrint.js'

const TENANT = { name: 'องค์การบริหารส่วนตำบลน้ำเลา', phone: '054-123456' }
const PROJECT = {
  id: 'test-proj-01',
  title: 'โครงการก่อสร้างถนน คสล. สายทางเข้าหมู่บ้าน หมู่ที่ 2',
  fiscal_year: '2568',
  budget_amount: 1250000,
  location_desc: 'หมู่ที่ 2 บ้านน้ำเลา',
}
const DATA = {
  docNo: 'พล 72303/125',
  docDate: '2026-11-16',
  orderNo: '45/2568',
  orderDate: '2026-11-01',
  costAmount: 957500,
  factorF: 1.3056,
  calcAmount: 1250112,
  medianAmount: 1250000,
  workScope: 'ก่อสร้างถนน คสล. ผิวจราจรกว้าง 4.00 ม. ยาว 500 ม. หนา 0.15 ม.',
  sourceOfPrice: 'ราคามาตรฐานพาณิชย์จังหวัดและกรมบัญชีกลาง',
  committee: [
    { name: 'สมชาย รักงาน', position_title: 'ผู้อำนวยการกองช่าง', duty: 'ประธานกรรมการ' },
    { name: 'ประสิทธิ์ วิศวกรรม', position_title: 'นายช่างโยธาชำนาญงาน', duty: 'กรรมการ' },
    { name: 'บุญมี มีสุข', position_title: 'นายช่างสำรวจปฏิบัติงาน', duty: 'กรรมการ' },
  ],
}

const html = buildCivilMedianHtml({
  tenant: TENANT,
  project: PROJECT,
  data: DATA,
  emblemUrl: 'http://localhost/images/garuda.svg',
})

// ตรวจสอบโครงสร้างหลัก
assert.ok(html.includes('<!DOCTYPE html>'))
assert.ok(html.includes('บันทึกข้อความ'))
assert.ok(html.includes('ตารางแสดงวงเงินงบประมาณที่ได้รับจัดสรรและราคากลางในงานจ้างก่อสร้าง'))
assert.ok(html.includes('แบบสรุปราคากลางงานก่อสร้าง (แบบ ปร.๖)'))

// ตรวจสอบชื่อโครงการและ อปท.
assert.ok(html.includes('องค์การบริหารส่วนตำบลน้ำเลา'))
assert.ok(html.includes('โครงการก่อสร้างถนน คสล. สายทางเข้าหมู่บ้าน หมู่ที่ 2'))

// ตรวจสอบการแปลงยอดเงินและตัวหนังสือบาทถ้วน
assert.ok(html.includes('1,250,000.00'))
assert.ok(html.includes('หนึ่งล้านสองแสนห้าหมื่นบาทถ้วน'))

// ตรวจสอบรายชื่อกรรมการ
assert.ok(html.includes('สมชาย รักงาน'))
assert.ok(html.includes('ประสิทธิ์ วิศวกรรม'))
assert.ok(html.includes('บุญมี มีสุข'))

// ตรวจสอบเลขที่คำสั่งและวันที่
assert.ok(html.includes('พล 72303/125'))
assert.ok(html.includes('45/2568'))

console.log('✓ civilMedianPrint test passed successfully')
