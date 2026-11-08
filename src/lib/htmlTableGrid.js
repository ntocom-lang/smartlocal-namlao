// อ่านตาราง HTML ที่คัดลอกจาก Excel / Word (clipboard text/html) เป็นกริดแถว×คอลัมน์ที่ "คัดค่าลงทุกช่องที่ถูก merge"
//
// ทำไมต้องมีไฟล์นี้: ข้อความ text/plain ที่ Excel/Word ส่งมาตอนคัดลอกทำให้โครงตารางที่ merge หายไป
//   - หัวตารางแผนการดำเนินงานมักเป็น "ไตรมาส 1" ที่ merge ข้าม 3 เดือน → text/plain เหลือช่องเดียว ที่เหลือว่าง
//     ตัวเดาหัวคอลัมน์จึงไม่รู้ว่าเดือนไหนอยู่ใต้ไตรมาสไหน
//   - ช่อง "ผู้รับผิดชอบ(กอง)" ที่ merge แนวตั้งหลายโครงการ → text/plain มีชื่อกองแค่แถวบนสุด แถวที่เหลือว่าง
//     โครงการเหล่านั้นจึงไม่มีกอง
//   - ช่องลูกศรเดือนที่ merge ข้ามเดือน (ลูกศรเดียวคร่อมหลายช่อง) → text/plain เห็นเดือนเดียว ช่วงเดือนที่ได้ผิด
// ตาราง HTML บอก colspan/rowspan ไว้ครบ จึงคลี่ออกเป็นกริดเต็มแล้วคัดค่าลงทุกช่องที่ merge ครอบคลุม
//
// ⚠️ ความปลอดภัย: ใช้ DOMParser แบบ 'text/html' ซึ่งเป็น inert (ไม่รันสคริปต์ ไม่โหลดรูป/ลิงก์ ไม่ผูก event handler)
//    อ่านได้แค่ข้อความ (textContent) — ห้ามนำ HTML ที่ได้ไปแสดงผล/ใส่ innerHTML ที่ไหนทั้งสิ้น
// ⚠️ ข้อความที่ได้ยังไม่ normalize — ผู้เรียกเรียก normalizeCell (tabularImport.js) เองเหมือนผลของ parseDelimited
import { MAX_ROWS } from './tabularImport.js'

/** colspan ต่อเซลล์สูงสุด (เซลล์ที่ขอเกินถูกลดเหลือเท่านี้ — กันตารางที่ใส่ colspan=99999 ทำกริดบวม) */
export const MAX_COLSPAN = 100
/** ความกว้างรวมสูงสุดของกริด (คอลัมน์) — เกินตัดทิ้ง */
export const MAX_COLUMNS = 200

/** span ที่ไม่ใช่เลข / ≤ 0 → 1 (rowspan=0 ใน HTML แปลว่า "ถึงท้ายกลุ่ม" แต่ที่นี่ถือเป็น 1 ตามที่ตกลง) */
function toSpan(value) {
  const n = parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/**
 * rows : Array<Array<{ text, colspan?, rowspan? }>> เรียงเซลล์ตามลำดับ DOM (แถวละอาร์เรย์)
 * วางเซลล์ตามอัลกอริทึมตาราง HTML : ข้ามช่องที่ถูก rowspan จากแถวบนจองไว้ แล้วคัดข้อความลงทุกช่องที่เซลล์ครอบคลุม
 * คืน { rows: string[][], merged: { rowspan, colspan }, truncated, clippedColumns }
 *   merged.* = มีเซลล์ที่ span > 1 จริงหลังจำกัดแล้วหรือไม่ (ให้หน้าจอเตือนงบที่อาจนับซ้ำเมื่อคัดค่าลงหลายแถว)
 *   truncated = มีมากกว่า MAX_ROWS แถว (ตัดทิ้ง) · clippedColumns = มีเซลล์ล้นเกิน MAX_COLUMNS คอลัมน์ (ตัดทิ้ง)
 *   ทุกแถวกว้างเท่ากัน (เติม '')
 */
export function expandSpans(rows) {
  const source = Array.isArray(rows) ? rows : []
  const limit = Math.min(source.length, MAX_ROWS)
  const grid = []
  const held = [] // held[col] = { text, left } : ช่องที่ rowspan จากแถวบนยังจองอยู่ (left = จำนวนแถวที่เหลือต้องเติม)
  const merged = { rowspan: false, colspan: false }
  let clippedColumns = false

  for (let r = 0; r < limit; r++) {
    const line = []
    let col = 0
    const takeHeld = () => {
      while (held[col] && held[col].left > 0) {
        line[col] = held[col].text
        held[col].left--
        col++
      }
    }
    for (const cell of Array.isArray(source[r]) ? source[r] : []) {
      takeHeld()
      let colspan = Math.min(toSpan(cell?.colspan), MAX_COLSPAN)
      const rowspan = Math.min(toSpan(cell?.rowspan), limit - r) // ไม่เกินแถวที่เหลือ (และไม่เกิน MAX_ROWS)
      const text = String(cell?.text ?? '')
      if (col + colspan > MAX_COLUMNS) {
        clippedColumns = true
        colspan = MAX_COLUMNS - col
      }
      if (colspan <= 0) continue // เต็มความกว้างแล้ว ไม่มีที่วาง
      if (colspan > 1) merged.colspan = true
      if (rowspan > 1) merged.rowspan = true
      for (let k = 0; k < colspan; k++) {
        line[col + k] = text
        held[col + k] = rowspan > 1 ? { text, left: rowspan - 1 } : undefined // เซลล์ใหม่ทับช่องที่จองไว้ (ตารางผิดรูป) ไม่ปล่อยให้ค่าเก่าไหลไปแถวถัดไป
      }
      col += colspan
    }
    // ช่องท้ายแถวที่ยังถูก rowspan จองอยู่ (แถวนี้มีเซลล์น้อยกว่าที่แถวบนจองไว้)
    for (let c = col; c < held.length; c++) {
      if (held[c] && held[c].left > 0) {
        line[c] = held[c].text
        held[c].left--
      }
    }
    grid.push(line)
  }

  const width = grid.reduce((w, line) => Math.max(w, line.length), 0)
  const filled = grid.map(line => Array.from({ length: width }, (_, c) => line[c] ?? ''))
  return { rows: filled, merged, truncated: source.length > MAX_ROWS, clippedColumns }
}

/** ข้อความของเซลล์ (clone แล้วแปลง <br> และบล็อก p/div/li เป็นช่องว่าง ตัด <style>/<script>) — ไม่แตะ DOM เดิม */
function cellText(cell) {
  const copy = cell.cloneNode(true)
  const doc = cell.ownerDocument
  for (const dead of copy.querySelectorAll('style, script')) dead.remove()
  for (const el of copy.querySelectorAll('br, p, div, li, tr')) el.after(doc.createTextNode(' '))
  return copy.textContent ?? ''
}

/**
 * html (ข้อความ text/html จาก clipboard) → ผลของ expandSpans จากตารางที่มีเซลล์มากที่สุด หรือ null ถ้าไม่มีตาราง/ไม่มีเซลล์
 * ตารางซ้อน: นับ/อ่านเฉพาะเซลล์ของตารางนั้นเอง (table.rows / row.cells ไม่รวมตารางลูก) — ข้อความของตารางลูกอยู่ในเซลล์แม่ตามจริง
 * DOMParserImpl : ใส่ได้เมื่อรันนอกเบราว์เซอร์ (เทสต์) ; ไม่มี DOMParser เลย → throw
 */
export function readHtmlTables(html, { DOMParserImpl = globalThis.DOMParser } = {}) {
  if (typeof DOMParserImpl !== 'function') {
    throw new Error('อ่านตาราง HTML ไม่ได้ในสภาพแวดล้อมนี้ (ไม่มี DOMParser) — ใช้ในเบราว์เซอร์ หรือส่ง DOMParserImpl เข้ามา')
  }
  const doc = new DOMParserImpl().parseFromString(String(html ?? ''), 'text/html')
  let best = null
  let bestCount = 0
  for (const table of doc.querySelectorAll('table')) {
    const count = [...table.rows].reduce((n, row) => n + row.cells.length, 0)
    if (count > bestCount) { best = table; bestCount = count }
  }
  if (!best) return null
  const rows = [...best.rows].map(row => [...row.cells].map(cell => ({
    text: cellText(cell),
    colspan: cell.getAttribute('colspan'),
    rowspan: cell.getAttribute('rowspan'),
  })))
  return expandSpans(rows)
}
