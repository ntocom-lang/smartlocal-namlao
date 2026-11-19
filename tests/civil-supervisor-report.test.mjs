import assert from 'node:assert/strict'
import { buildSupervisorReportHtml } from '../src/lib/constructionLifecyclePrint.js'

const TENANT = { name: 'องค์การบริหารส่วนตำบลน้ำเลา' }
const PROJECT = {
  id: 'test-proj-01',
  title: 'โครงการก่อสร้างถนน คสล. สายทางเข้าหมู่บ้าน หมู่ที่ 2',
  contract_no: '12/2569',
  contractor_name: 'ห้างหุ้นส่วนจำกัด แพร่ก่อสร้าง',
  contract_amount: 1200000,
}
const CONTRACT = {
  contract_date: '2026-10-01',
  installments_total: 2,
}
const INSTALLMENT = {
  installment_no: 1,
  amount: 600000,
  work_pct: 50,
  delivered_on: '2026-11-10',
  delivery_ref_no: 'พก 01/2569',
  description: 'งานเทพื้นคอนกรีตผิวจราจรระยะทาง 250 เมตร',
}
const PEOPLE = [
  { grp: 'supervisor', name: 'สมพงษ์ วิศวกร', position_title: 'นายช่างโยธาชำนาญงาน', duty: 'หัวหน้าผู้ควบคุมงาน' },
  { grp: 'supervisor', name: 'มานะ ขยันงาน', position_title: 'นายช่างสำรวจปฏิบัติงาน', duty: 'ผู้ควบคุมงาน' },
]

const html = buildSupervisorReportHtml({
  tenant: TENANT,
  project: PROJECT,
  contract: CONTRACT,
  installment: INSTALLMENT,
  people: PEOPLE,
  departmentName: 'กองช่าง',
  emblemUrl: 'http://localhost/images/garuda.svg',
})

assert.ok(html.includes('<!DOCTYPE html>'))
assert.ok(html.includes('บันทึกข้อความ'))
assert.ok(html.includes('รายงานผลการควบคุมงานจ้างก่อสร้าง งวดที่ 1'))
assert.ok(html.includes('ประธานคณะกรรมการตรวจรับพัสดุ'))
assert.ok(html.includes('ห้างหุ้นส่วนจำกัด แพร่ก่อสร้าง'))
assert.ok(html.includes('สัญญาจ้างเลขที่ <b>12/2569</b>'))
assert.ok(html.includes('600,000.00 บาท'))
assert.ok(html.includes('หกแสนบาทถ้วน'))
assert.ok(html.includes('สมพงษ์ วิศวกร'))
assert.ok(html.includes('มานะ ขยันงาน'))

console.log('✓ civilSupervisorReport test passed successfully')
