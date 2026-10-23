// ตรรกะล้วน (ไม่มี React) ของ "รายการจุดแบบแผ่น A4" — แผ่นที่ 2 ของใบพิมพ์ภาพนำเสนอ และรายการใต้โปสเตอร์ในหน้าเว็บ (จอ ≥ 1024px)
// วาดด้วย src/components/water/WaterRouteListSheet.jsx · ใช้กับผังที่มี route.poster เท่านั้น (ตอนนี้น้ำเลา)
//
// เจ้าของระบบสั่ง 2569-10-23: "ย่อให้เหลือเท่ากระดาษ A4 เหมือนกัน ขอเป็นระเบียบด้วย" → จัดเป็น 3 คอลัมน์ตามสายน้ำของผัง
// (คอลัมน์ละสายหรือกลุ่มสายที่อยู่ติดกัน ไม่ฉีกกลุ่มข้ามคอลัมน์) ไม่ตัดข้อความใดทิ้ง

import { routeItems } from './route.js'
import { POSTER_PRINT_SIZE } from './poster.js'
import { GOV_PAGE_MARGIN_LANDSCAPE } from '../govDocStyle.js'

export const LIST_SHEET_COLUMNS = 3

// พื้นที่พิมพ์ A4 แนวนอนตามขอบมาตรฐานของระบบ (3 ซม. บน · 2 ซม. ซ้ายขวา · 1 ซม. ล่าง) บนกล่องหน้าสูง 208 มม. (ดู posterPrintCss)
// แผ่นรายการใช้สัดส่วนนี้ทั้งบนจอและบนกระดาษ — ขนาดตัวอักษรเป็น cqw ของความกว้างแผ่น จึงย่อ/ขยายตามกันทุกจอ เห็นบนจอเหมือนที่พิมพ์
export const LIST_SHEET_MM = { w: 257, h: 168 }
export const LIST_SHEET_PRINT = { size: POSTER_PRINT_SIZE, margin: GOV_PAGE_MARGIN_LANDSCAPE }

// ตัวอักษรไทยโดยประมาณต่อบรรทัดในคอลัมน์ของแผ่น — ใช้ "ถ่วงน้ำหนัก" ให้คอลัมน์สูงใกล้กันเท่านั้น
// ความพอดีกับกระดาษจริงวัดด้วยเบราว์เซอร์ในเทสต์ (ทุกฉากค่าสด) ไม่พึ่งตัวเลขประมาณนี้
const PER_LINE = { name: 36, sub: 46, live: 44, group: 34 }
const lines = (text, per) => (text ? Math.ceil(String(text).length / per) : 0)

export function listItemWeight(item, badges = {}) {
  const live = (item.live ?? []).map(slot => badges[slot]?.detail).filter(Boolean)
  return 0.4
    + lines(item.name, PER_LINE.name) * 1.25
    + lines(item.sub, PER_LINE.sub)
    + ((item.tags ?? []).length > 0 ? 1.1 : 0)
    + live.reduce((sum, text) => sum + 0.35 + lines(text, PER_LINE.live), 0)
}

/**
 * แบ่งลำดับน้ำหนักเป็น `columns` ช่วงติดกัน ให้ช่วงที่หนักสุดเบาที่สุด (เสมอกัน = ช่วงสม่ำเสมอกว่า)
 * คืน [[จาก, ถึง) ...] ยาว `columns` เสมอ (ช่วงที่เหลือเป็นว่างเมื่อหน่วยน้อยกว่าคอลัมน์)
 */
export function balanceRanges(weights, columns) {
  const n = weights.length
  const k = Math.min(columns, n)
  if (k === 0) return Array.from({ length: columns }, () => [0, 0])
  const prefix = [0]
  weights.forEach((w, i) => prefix.push(prefix[i] + w))
  const sum = (from, to) => prefix[to] - prefix[from]
  const best = Array.from({ length: k + 1 }, () => Array(n + 1).fill(null))
  best[0][0] = { max: 0, sq: 0, cut: -1 }
  for (let j = 1; j <= k; j++) {
    for (let i = j; i <= n; i++) {
      for (let cut = j - 1; cut < i; cut++) {
        const prev = best[j - 1][cut]
        if (!prev) continue
        const w = sum(cut, i)
        const cand = { max: Math.max(prev.max, w), sq: prev.sq + w * w, cut }
        const cur = best[j][i]
        if (!cur || cand.max < cur.max - 1e-9 || (Math.abs(cand.max - cur.max) < 1e-9 && cand.sq < cur.sq)) best[j][i] = cand
      }
    }
  }
  const ranges = []
  let end = n
  for (let j = k; j >= 1; j--) {
    const { cut } = best[j][end]
    ranges.unshift([cut, end])
    end = cut
  }
  while (ranges.length < columns) ranges.push([n, n])
  return ranges
}

/**
 * กลุ่มตามสายของผัง: [{ heading, items }] เรียงตามหมายเลข · ผังที่ไม่กำหนด group = กลุ่มเดียวไม่มีหัวข้อ
 */
export function listGroups(route) {
  const groups = []
  for (const item of routeItems(route)) {
    const heading = item.group ?? null
    const last = groups[groups.length - 1]
    if (last && last.heading === heading) last.items.push(item)
    else groups.push({ heading, items: [item] })
  }
  return groups
}

/**
 * จัดรายการเป็นคอลัมน์ของแผ่น: [{ units: [{ heading, items }], weight }] ยาว `columns` เสมอ
 * หน่วยที่แบ่งได้ = กลุ่มตามสาย (ไม่ฉีกกลุ่มข้ามคอลัมน์) · ถ้ากลุ่มน้อยกว่าคอลัมน์ (เช่นผังไม่มีกลุ่ม) แบ่งทีละจุดแทน
 * หัวข้อกลุ่มขึ้นที่จุดแรกของกลุ่มเสมอ
 */
export function listColumns(route, badges = {}, columns = LIST_SHEET_COLUMNS) {
  const groups = listGroups(route)
  const units = groups.length >= columns
    ? groups
    : groups.flatMap(group => group.items.map((item, i) => ({ heading: i === 0 ? group.heading : null, items: [item] })))
  const weightOf = unit => (unit.heading ? Math.max(1, lines(unit.heading, PER_LINE.group)) * 1.4 + 0.3 : 0)
    + unit.items.reduce((sum, item) => sum + listItemWeight(item, badges), 0)
  const weights = units.map(weightOf)
  return balanceRanges(weights, columns).map(([from, to]) => ({
    units: units.slice(from, to),
    weight: weights.slice(from, to).reduce((a, b) => a + b, 0),
  }))
}
