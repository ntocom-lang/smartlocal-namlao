// ไอคอนประจำหมวดคำร้อง สำหรับภาพอินโฟกราฟิกสรุปรายเดือน (ภาพ SVG/PNG ที่วาดเอง ไม่ใช่คอมโพเนนต์ React)
//
// ทำไมไม่ใช้คอมโพเนนต์ lucide ตรงๆ: ภาพต้องเป็นสตริง SVG ก้อนเดียวที่ทั้งแสดงบนหน้าและแปลงเป็น PNG ได้
// เหมือนกันทุกพิกเซล (ดู complaintMonthlyInfographic.js) จึงต้องใช้ "ข้อมูลเส้น" (__iconNode) ของไอคอน
// ซึ่ง lucide-react ส่งออกไว้ที่ไฟล์ไอคอนแต่ละตัว — เป็น path ลึกภายในแพ็กเกจ ไม่ใช่ API ที่รับประกัน
// เทสต์ (tests/complaint-monthly-infographic.test.mjs) นำเข้าไอคอนทุกตัวในตารางนี้ ถ้าอัปเกรด lucide แล้ว
// ที่อยู่ไฟล์ย้าย เทสต์จะล้มเสียงดัง ไม่ใช่ภาพไอคอนหายเงียบๆ
//
// ไอคอนเป็นของ lucide (ISC license) ไม่ใช่ภาพประกอบหรือมาสคอตของ อปท. ใด

import { __iconNode as activity } from 'lucide-react/dist/esm/icons/activity.mjs'
import { __iconNode as building } from 'lucide-react/dist/esm/icons/building-2.mjs'
import { __iconNode as bug } from 'lucide-react/dist/esm/icons/bug.mjs'
import { __iconNode as circleDot } from 'lucide-react/dist/esm/icons/circle-dot.mjs'
import { __iconNode as circleHelp } from 'lucide-react/dist/esm/icons/circle-question-mark.mjs'
import { __iconNode as clipboardList } from 'lucide-react/dist/esm/icons/clipboard-list.mjs'
import { __iconNode as cloudRain } from 'lucide-react/dist/esm/icons/cloud-rain.mjs'
import { __iconNode as construction } from 'lucide-react/dist/esm/icons/construction.mjs'
import { __iconNode as droplet } from 'lucide-react/dist/esm/icons/droplet.mjs'
import { __iconNode as droplets } from 'lucide-react/dist/esm/icons/droplets.mjs'
import { __iconNode as ellipsis } from 'lucide-react/dist/esm/icons/ellipsis.mjs'
import { __iconNode as lightbulb } from 'lucide-react/dist/esm/icons/lightbulb.mjs'
import { __iconNode as messageSquareWarning } from 'lucide-react/dist/esm/icons/message-square-warning.mjs'
import { __iconNode as packageIcon } from 'lucide-react/dist/esm/icons/package.mjs'
import { __iconNode as pawPrint } from 'lucide-react/dist/esm/icons/paw-print.mjs'
import { __iconNode as receipt } from 'lucide-react/dist/esm/icons/receipt.mjs'
import { __iconNode as shieldAlert } from 'lucide-react/dist/esm/icons/shield-alert.mjs'
import { __iconNode as store } from 'lucide-react/dist/esm/icons/store.mjs'
import { __iconNode as trash } from 'lucide-react/dist/esm/icons/trash-2.mjs'
import { __iconNode as treePine } from 'lucide-react/dist/esm/icons/tree-pine.mjs'
import { __iconNode as truck } from 'lucide-react/dist/esm/icons/truck.mjs'
import { __iconNode as volume } from 'lucide-react/dist/esm/icons/volume-2.mjs'
import { __iconNode as waves } from 'lucide-react/dist/esm/icons/waves-horizontal.mjs'
import { __iconNode as wind } from 'lucide-react/dist/esm/icons/wind.mjs'
import { __iconNode as wrench } from 'lucide-react/dist/esm/icons/wrench.mjs'

// รหัสหมวดมาตรฐานของระบบ (ตรงกับ STANDARD_CATEGORY_LABEL ใน complaintCategoryLabels.js)
const BY_CODE = {
  light: lightbulb,
  trash,
  water: droplets,
  water_supply: droplets,
  water_repair: wrench,
  road: construction,
  drain: waves,
  canal: waves,
  flood: cloudRain,
  manhole: circleDot,
  waste_water: droplet,
  suction: truck,
  tree: treePine,
  noise: volume,
  building,
  mosquito: bug,
  pollution: wind,
  odor: wind,
  corruption: shieldAlert,
  tax: receipt,
  vendor: store,
  animals: pawPrint,
  borrow_equipment: packageIcon,
  grievance: messageSquareWarning,
  disease: activity,
  other: circleHelp,
}

// หมวดที่ อปท. ตั้งเอง (รหัสแบบ cat_xxxx) ไม่มีไอคอนเฉพาะ ใช้ไอคอนกลางแทน ไม่เดาจากชื่อ
const FALLBACK_ICON = clipboardList
// แถว "หมวดที่เหลือ (n หมวด)" ที่พับรวมกัน — ไม่ใช่หมวดจริง
const REST_ICON = ellipsis

export const KNOWN_ICON_CODES = Object.keys(BY_CODE)

/** ข้อมูลเส้นของไอคอน (รูปแบบ lucide __iconNode: [[แท็ก, แอตทริบิวต์], ...]) */
export function iconNodeForCategory(code) {
  if (code === null || code === undefined) return REST_ICON
  return BY_CODE[code] ?? FALLBACK_ICON
}
