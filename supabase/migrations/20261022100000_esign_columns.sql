-- 20261022100000_esign_columns.sql
--
-- [เฟส DDL] ลงนามออนไลน์รายเรื่อง (ชุด A เฟส ๑) — เพิ่มคอลัมน์ที่ fleet_trips เท่านั้น
-- ตารางใหม่อยู่ไฟล์ถัดไป (20261022100100) ส่วนฟังก์ชัน/trigger/RLS อยู่ไฟล์สุดท้าย (20261022100200)
-- แยกไฟล์ตาม docs/ai/NOTES.md ข้อ 3: ADD COLUMN แล้วอ้างในไฟล์เดียวกันเคยพัง 42703
--
-- ── คอลัมน์สองตัวนี้คืออะไร ──────────────────────────────────────────────────────────────────
-- esign_slots        NULL = เซ็นสดเหมือนเดิม (ทริปเก่าทุกใบและทริปของ อปท. ที่ยังไม่เปิดใช้)
--                    ไม่ NULL = ทริปนี้ลงนามออนไลน์ ค่าคือ "ภาพถ่าย" ของโหมดรายช่อง ณ ตอนสร้างคำขอ
--                    เช่น {"requester":"online","dept_head":"online","authority":"wet","sk1":"online"}
--                    ตรึงตอน INSERT โดย trigger ในไฟล์ที่ ๓ — แอดมินสลับสวิตช์ทีหลังไม่กระทบทริปที่สร้างไปแล้ว
-- esign_verify_code  รหัสสุ่ม 32 ตัวอักษรฐาน 16 (122 บิต เหมือน complaints.track_token) ใช้เป็นกุญแจของหน้าตรวจสอบ
--                    สาธารณะ — ไม่ใช้ id ของทริปเพราะ id ไม่ควรออกไปนอกระบบ
--
-- ⚠️ ทั้งสองคอลัมน์ client เขียนเองไม่ได้ (trigger ในไฟล์ที่ ๓ เขียนทับทุกครั้ง) จึงไม่มีทางปลอมว่าทริปเป็นโหมดออนไลน์
-- ⚠️ ไม่ต้อง GRANT เพิ่ม: fleet_trips ใช้สิทธิ์ระดับตาราง ไม่ใช่ column-level grant แบบ municipalities (NOTES.md ข้อ 4)
-- ผลต่อของที่ใช้งานอยู่: ไม่มี — คอลัมน์ใหม่เป็น NULL ทุกแถว ไม่มีโค้ดฝั่งหน้าเว็บเดิมที่อ่านมัน

DO $guard$
BEGIN
  IF to_regclass('public.fleet_trips') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ public.fleet_trips — ตารางยานพาหนะต้องมาก่อน';
  END IF;
END;
$guard$;

ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS esign_slots jsonb,
  ADD COLUMN IF NOT EXISTS esign_verify_code text;

COMMENT ON COLUMN public.fleet_trips.esign_slots IS
  'โหมดลงนามรายช่องของทริปนี้ ตรึงตอนสร้างคำขอ (NULL = เซ็นสด) — trigger trg_fleet_trips_esign_guard เป็นผู้เขียนเพียงผู้เดียว';
COMMENT ON COLUMN public.fleet_trips.esign_verify_code IS
  'รหัสหน้าตรวจสอบลายเซ็นสาธารณะ (32 hex สุ่ม) — ออกพร้อม esign_slots เท่านั้น ห้ามใส่ใน view/ฟังก์ชันสาธารณะอื่น';

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select count(*) filter (where esign_slots is not null or esign_verify_code is not null) from public.fleet_trips;   → 0
