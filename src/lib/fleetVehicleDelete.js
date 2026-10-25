// ลบรถ (หน้า "ยานพาหนะ") — กติกาล้วน ไม่แตะ DOM/supabase เทสต์รันด้วย node (tests/fleet-vehicle-delete.test.mjs)
//
// เดิมรถที่มีประวัติ (เที่ยวใช้รถ/เติมน้ำมัน/ซ่อมบำรุง) ลบไม่ได้กับทุกคน ให้ตั้ง "ปลดระวาง" แทนเพื่อรักษาประวัติราชการ
// เจ้าของระบบสั่ง 2569-10-25: Super Admin ลบได้ทุกอย่าง — จึงเปิดทางให้ Super Admin เท่านั้น (ไม่ใช่ผู้ดูแลยานพาหนะ/แอดมิน อปท.)
// โดยต้องพิมพ์คำยืนยัน เพราะการลบรถลบประวัติทั้งหมดของรถคันนั้นตามไปด้วย (FK ON DELETE CASCADE) กู้คืนไม่ได้
//
// ส่วนที่ไม่เปลี่ยน: บันทึกอุบัติเหตุกันการลบรถที่ฐานข้อมูล (fleet_incidents.vehicle_id ON DELETE RESTRICT — หลักฐานเหตุการณ์)
// ต้องลบบันทึกอุบัติเหตุก่อน · ลายเซ็นออนไลน์ของเที่ยวที่ถูกลบตามรถยังอยู่ในตาราง esign_* (append-only ไม่มี FK ไปเที่ยว)
import { ESIGN_TRIP_EXCEPTIONS } from './esign.js'

export const VEHICLE_DELETE_CONFIRM_WORD = 'ยืนยันลบ'

const historyText = ({ trips, fuel, maintenance }) => [
  trips ? `เที่ยวใช้รถ ${trips}` : '',
  fuel ? `เติมน้ำมัน ${fuel}` : '',
  maintenance ? `ซ่อมบำรุง ${maintenance}` : '',
].filter(Boolean).join(' · ')

/**
 * @returns {{ kind: 'simple' } | { kind: 'blocked', message: string } | { kind: 'typed', prompt: string, word: string }}
 *   simple = ไม่มีประวัติ ยืนยันธรรมดา · blocked = มีประวัติและไม่ใช่ Super Admin · typed = Super Admin ต้องพิมพ์คำยืนยัน
 */
export function vehicleDeletePlan({ name = '', trips = 0, fuel = 0, maintenance = 0, signedTrips = 0, isSuperAdmin = false } = {}) {
  const history = trips + fuel + maintenance
  if (history === 0) return { kind: 'simple' }
  if (!isSuperAdmin) {
    return {
      kind: 'blocked',
      message: `ไม่สามารถลบได้ เพราะมีประวัติที่เกี่ยวข้อง ${history} รายการ\nให้แก้ไขสถานะเป็น “ปลดระวาง” เพื่อรักษาประวัติราชการ\n(เฉพาะ Super Admin ที่ลบรถพร้อมประวัติได้)`,
    }
  }
  const signedNote = signedTrips > 0
    ? `\nมีเที่ยวที่ลงนามออนไลน์ ${signedTrips} เที่ยว: QR/ลิงก์ตรวจสอบบนใบที่พิมพ์ไปแล้วจะขึ้น “ไม่พบ” (ระบบเก็บหลักฐานลายเซ็นและบันทึกว่าใครลบไว้)`
    : ''
  return {
    kind: 'typed',
    word: VEHICLE_DELETE_CONFIRM_WORD,
    prompt: `⚠️ ลบ “${name}” พร้อมประวัติทั้งหมดถาวร (${historyText({ trips, fuel, maintenance })})${signedNote}\n`
      + `กู้คืนไม่ได้ — ถ้าแค่เลิกใช้ ให้ตั้งสถานะ “ปลดระวาง” แทน\n\nพิมพ์ “${VEHICLE_DELETE_CONFIRM_WORD}” เพื่อยืนยัน`,
  }
}

export const vehicleDeleteConfirmed = input => String(input ?? '').trim() === VEHICLE_DELETE_CONFIRM_WORD

/** ข้อความ error ตอนลบรถไม่สำเร็จ — ฐานข้อมูลปฏิเสธด้วยเหตุที่อ่านไม่ออกถ้าแสดงดิบ */
export function vehicleDeleteErrorText(error) {
  const raw = String(error?.message ?? '')
  if (raw.includes('ESIGN_TRIP_HAS_SIGNATURES')) {
    return `ลบไม่สำเร็จ: รถคันนี้มีเที่ยวที่ลงนามออนไลน์แล้ว — ${ESIGN_TRIP_EXCEPTIONS.ESIGN_TRIP_HAS_SIGNATURES}`
  }
  if (error?.code === '23503' && raw.includes('fleet_incidents')) {
    return 'ลบไม่สำเร็จ: รถคันนี้มีบันทึกอุบัติเหตุ (เก็บเป็นหลักฐานเหตุการณ์) — ลบบันทึกอุบัติเหตุของรถคันนี้ก่อน แล้วลองใหม่'
  }
  return `ลบไม่สำเร็จ: ${raw}`
}
