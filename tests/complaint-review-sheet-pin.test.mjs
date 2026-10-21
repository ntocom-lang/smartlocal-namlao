// หน้าทวนก่อนส่งคำร้อง (ComplaintReviewSheet) — เตือนเบาๆ เมื่อยังไม่ได้ปักหมุด + ปุ่มกลับไปปัก
//
// ที่มา 2569-10-21: ใบคำร้องที่พิมพ์ออกมาต้องมีพิกัด แต่ฟอร์มประชาชนให้ปักหมุดเป็นตัวเลือก (91% ปักอยู่แล้ว อีก ~9% ไม่ปัก)
// จึงเตือนที่ต้นทางก่อนกดส่ง · ⚠️ ต้องไม่บังคับ: ปุ่มส่งต้องกดได้เสมอ (คนไม่มี GPS / เรื่องที่ไม่ผูกกับจุดใดจุดหนึ่งจะเลิกแจ้ง)
//
// เรนเดอร์จริงด้วย react-dom/server ผ่านตัวโหลด SSR ของ vite (ไม่ต้องเปิดเบราว์เซอร์ ไม่ต้องมีไฟล์ entry เพิ่ม)
// รันด้วย: node tests/complaint-review-sheet-pin.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, watch: null },
})

let cases = 0
const test = (label, run) => { run(); cases++; console.log('PASS ' + label) }

try {
  const { default: ComplaintReviewSheet } = await server.ssrLoadModule('/src/components/complaints/ComplaintReviewSheet.jsx')
  const base = {
    summary: [
      { label: 'ประเภท', value: 'ไฟฟ้าสาธารณะ' },
      { label: 'พิกัด', value: 'ไม่ได้ปักหมุด' },
    ],
    detail: 'ไฟดับหน้าบ้านเลขที่ 12',
    orgName: 'เทศบาลตำบลทดสอบ',
    submitLabel: 'ยืนยันและส่ง',
  }
  const html = props => renderToStaticMarkup(createElement(ComplaintReviewSheet, { ...base, ...props }))

  test('ยังไม่ปักหมุด (มี onAddPin): ขึ้นกล่องเตือน + ปุ่ม "ปักหมุดตอนนี้" และปุ่มส่งยังกดได้', () => {
    const markup = html({ onAddPin: () => {} })
    assert.match(markup, /data-testid="pin-hint"/)
    assert.match(markup, /ยังไม่ได้ปักหมุด/)
    assert.match(markup, /ปักหมุดตอนนี้/)
    // ไม่บังคับ: ไม่มีปุ่มไหนถูก disabled (ปุ่มส่งต้องกดได้ทันที)
    assert.doesNotMatch(markup, /disabled=""/, 'มีปุ่มถูกปิดใช้งาน — การเตือนต้องไม่ขวางการส่ง')
    assert.match(markup, /ยืนยันและส่ง/)
  })

  test('ปักหมุดแล้ว (ไม่มี onAddPin): ไม่ขึ้นกล่องเตือน', () => {
    const markup = html({})
    assert.doesNotMatch(markup, /pin-hint|ปักหมุดตอนนี้/)
  })

  test('กำลังส่ง: ปุ่มปักหมุดถูกปิด กันกดย้อนกลับกลางทางส่ง', () => {
    const markup = html({ onAddPin: () => {}, submitting: true })
    const pinButton = /<button[^>]*>(?:(?!<\/button>).)*ปักหมุดตอนนี้(?:(?!<\/button>).)*<\/button>/s.exec(markup)?.[0] ?? ''
    assert.match(pinButton, /disabled=""/)
  })

  test('หน้าฟอร์มส่ง onAddPin เฉพาะตอนยังไม่มีพิกัด และกดแล้วปิดหน้าทวนเปิดแผนที่', () => {
    const form = readFileSync(new URL('../src/pages/CitizenForm.jsx', import.meta.url), 'utf8')
    assert.match(
      form,
      /onAddPin=\{geo\.lat == null \? \(\) => \{ setShowConsent\(false\); setShowMap\(true\) \} : undefined\}/,
      'CitizenForm ต้องส่ง onAddPin เมื่อ geo.lat == null เท่านั้น',
    )
  })
} finally {
  await server.close()
}
console.log(`complaint review sheet pin hint: ${cases} cases passed`)
