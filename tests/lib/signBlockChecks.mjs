// ── ตัวตรวจ "ช่องลงนามมาตรฐาน" ที่ใช้ร่วมกับเทสต์เลย์เอาต์ของทุกแบบพิมพ์ ────────────────
//
// ทำไมต้องรวมไว้ที่เดียว: มาตรฐานช่องลงนาม (src/lib/govSignBlock.js) ใช้กับทุกใบ ถ้าปล่อยให้
// แต่ละเทสต์เขียนวิธีวัดเอง จะมีใบที่วัดถูกและใบที่วัดผิดปนกัน — ซึ่งเกิดขึ้นจริงมาแล้ว
//
// ⚠️ บทเรียนที่ทำให้ไฟล์นี้เกิด (2569-09-12): เทสต์เดิมของใบยืมพัสดุวัดจุดกึ่งกลางจาก
// getBoundingClientRect() ของ <span> ที่ครอบข้อความ พอโค้ดตั้ง width: 0 ให้ span นั้น
// กล่องที่ได้จึงกว้าง 0 และอยู่กลางแกนพอดี "เสมอ" ไม่ว่าตัวอักษรข้างในจะไปกองอยู่ข้างไหน
// เทสต์ผ่านฉลุยทั้งที่ของจริงเยื้องขวา 16-25mm จนเจ้าของระบบจับได้จากใบที่พิมพ์ออกกระดาษ
// ทุกฟังก์ชันในไฟล์นี้จึงวัด "กล่องของตัวอักษรจริง" ด้วย Range + getClientRects() เท่านั้น
// ห้ามเปลี่ยนกลับไปวัดกล่องของ element เด็ดขาด

import assert from 'node:assert/strict'

/** 1mm ที่ 96dpi — หน่วยกลางของไฟล์นี้ ทุกค่าที่รายงานออกไปเป็นมิลลิเมตรหมด */
export const PX_PER_MM = 3.779527

/** เกินกว่านี้เริ่มเห็นว่าเบี้ยวด้วยตาเปล่าบนกระดาษ */
const CENTER_TOLERANCE_MM = 1

/** วงเล็บเว้นชื่อปัดจำนวนจุดเป็นจำนวนเต็ม จึงคลาดจากความกว้างเส้นได้ราวจุดเดียว */
const BLANK_TOLERANCE_MM = 1.5

/**
 * อ่านค่าช่องลงนามทุกจุดในหน้า — ใช้ต่อเองได้เวลาต้องวัดอะไรเฉพาะใบ
 * คืน: [{ index, role, axisMm, lineMm, lineCenterMm, below: [{ text, centerMm, widthMm }] }]
 */
export function measureSignRows(page) {
  return page.evaluate(mm => {
    // กล่องของ "ตัวอักษรจริง" ไม่ใช่กล่องของ element (ดูเหตุผลหัวไฟล์)
    const textBox = el => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const rects = [...range.getClientRects()]
      if (!rects.length) return null
      return {
        left: Math.min(...rects.map(rect => rect.left)),
        right: Math.max(...rects.map(rect => rect.right)),
      }
    }
    return [...document.querySelectorAll('.sign-row')].map((row, index) => {
      const axis = row.querySelector('.sign-axis')
      const line = row.querySelector('.sign-line, .sign-signed')
      const lineBox = line?.getBoundingClientRect()
      return {
        index,
        role: row.querySelector('.sign-role')?.textContent?.trim() ?? '',
        axisMm: axis ? axis.getBoundingClientRect().width / mm : null,
        lineMm: lineBox ? lineBox.width / mm : null,
        lineCenterMm: lineBox ? (lineBox.left + lineBox.width / 2) / mm : null,
        below: [...row.querySelectorAll('.sign-below')].map(el => {
          const box = textBox(el)
          return {
            text: el.textContent.trim(),
            centerMm: box ? (box.left + box.right) / 2 / mm : null,
            widthMm: box ? (box.right - box.left) / mm : null,
          }
        }),
      }
    })
  }, PX_PER_MM)
}

/**
 * ตรวจ 3 ข้อที่ทุกใบต้องผ่านเหมือนกัน
 *   1. มีช่องลงนามอย่างน้อยตามที่คาด (กันเคสเปลี่ยนโครงสร้างแล้วไม่มีอะไรให้วัด = ผ่านลวง)
 *   2. บรรทัดใต้เส้น (วงเล็บชื่อ/ชื่อตำแหน่ง) อยู่กึ่งกลางบนแกนของเส้น
 *   3. วงเล็บเว้นชื่อ "(.....)" กว้างเท่าเส้นที่อยู่เหนือมัน
 *
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {number} [options.minRows] จำนวนช่องลงนามอย่างน้อยที่ใบนี้ต้องมี
 * @param {number} [options.minBelow] จำนวนบรรทัดใต้เส้นอย่างน้อยที่ใบนี้ต้องมี
 */
export async function assertSignBlockStandard(page, { minRows = 1, minBelow = 1 } = {}) {
  const rows = await measureSignRows(page)
  assert.ok(rows.length >= minRows,
    `เจอช่องลงนาม ${rows.length} จุด แต่ใบนี้ต้องมีอย่างน้อย ${minRows} จุด`
    + ' — โครงสร้างเปลี่ยนไปจนไม่มีอะไรให้วัด ไม่ใช่ว่าผ่าน')

  const below = rows.flatMap(row => row.below.map(item => ({ ...item, row })))
  assert.ok(below.length >= minBelow,
    `เจอบรรทัดใต้เส้นลงนาม ${below.length} บรรทัด แต่ใบนี้ต้องมีอย่างน้อย ${minBelow} บรรทัด`)

  const crooked = below
    .filter(item => item.centerMm !== null && item.row.lineCenterMm !== null)
    .map(item => ({ ...item, diff: Math.abs(item.centerMm - item.row.lineCenterMm) }))
    .filter(item => item.diff > CENTER_TOLERANCE_MM)
  assert.equal(crooked.length, 0,
    `บรรทัดใต้เส้นลงนามไม่อยู่กึ่งกลางบนแกนของเส้น: ${crooked
      .map(item => `ช่อง ${item.row.index} "${item.text.slice(0, 24)}" เยื้อง ${item.diff.toFixed(1)}mm`)
      .join(' · ')}`)

  const narrow = below
    .filter(item => /^\(\.+\)$/.test(item.text) && item.row.lineMm !== null)
    .map(item => ({ ...item, diff: Math.abs(item.widthMm - item.row.lineMm) }))
    .filter(item => item.diff > BLANK_TOLERANCE_MM)
  assert.equal(narrow.length, 0,
    `วงเล็บเว้นชื่อกว้างไม่เท่าเส้นลงนาม (เขียนชื่อ-สกุลลงไม่พอ): ${narrow
      .map(item => `ช่อง ${item.row.index} เส้น ${item.row.lineMm.toFixed(1)}mm วงเล็บ ${item.widthMm.toFixed(1)}mm`)
      .join(' · ')}`)
}

/**
 * ตรวจว่าเส้นลงนามในบล็อกเดียวกันกว้างเท่ากันทุกจุด และคำต่อท้ายเรียงตรงแนว
 * ใช้เฉพาะใบที่มีบล็อกลงนามสองคอลัมน์ (ใบที่มีช่องเดียวไม่ต้องเรียก)
 *
 * @param {import('playwright').Page} page
 * @param {string} [selector] ตัวเลือกของแถวที่ต้องกว้างเท่ากัน เช่น '.sign-indent .sign-row'
 */
export async function assertSignLinesAligned(page, selector = '.sign-row') {
  const rows = await page.evaluate(sel => [...document.querySelectorAll(sel)].map(row => ({
    width: Math.round(row.querySelector('.sign-line, .sign-signed')?.getBoundingClientRect().width ?? -1),
    roleLeft: row.querySelector('.sign-role')
      ? Math.round(row.querySelector('.sign-role').getBoundingClientRect().left) : null,
    rowLeft: Math.round(row.getBoundingClientRect().left),
  })), selector)

  const widths = [...new Set(rows.map(row => row.width))]
  assert.equal(widths.length, 1,
    `เส้นลงนามกว้างไม่เท่ากัน (${widths.join(', ')}px) — ห้ามไล่ความกว้างรายจุด`
    + ' ใช้ GOV_SIGN_LINE_W ค่าเดียวทั้งบล็อก')

  // จัดกลุ่มตามคอลัมน์ด้วยขอบซ้ายของแถว แล้วเทียบตำแหน่งคำต่อท้ายในคอลัมน์เดียวกัน
  const byColumn = new Map()
  for (const row of rows.filter(item => item.roleLeft !== null)) {
    if (!byColumn.has(row.rowLeft)) byColumn.set(row.rowLeft, [])
    byColumn.get(row.rowLeft).push(row.roleLeft)
  }
  for (const [column, lefts] of byColumn) {
    assert.ok(Math.max(...lefts) - Math.min(...lefts) <= 1,
      `คำต่อท้ายในคอลัมน์ที่ x=${column} เริ่มไม่ตรงแนวกัน: ${lefts.join(', ')}px`)
  }
}
