-- 20261101120000_esign_trip_returns_table.sql
--
-- [เฟส DDL] ปุ่ม "ส่งคืนผู้ขอ" ในลงนามออนไลน์ (เจ้าของระบบอนุมัติ 2569-11-01)
-- ตารางเปล่าและดัชนีเท่านั้น RLS/trigger/ฟังก์ชันอยู่ไฟล์ถัดไป (20261101120100) แยกตาม docs/ai/NOTES.md ข้อ 3
--
-- esign_trip_returns  บันทึกเหตุการณ์แบบเพิ่มอย่างเดียว ไม่มีคอลัมน์ที่แก้ทีหลัง
--   kind = returned     ผู้ลงนาม (ผอ.กอง/ผู้มีอำนาจ) ส่งใบคืนผู้ขอพร้อมเหตุผล
--   kind = resubmitted  ผู้ขอส่งกลับให้ลงนามต่อ (ลงนามใหม่ หรือกดส่งต่อเมื่อช่องผู้ขอเซ็นสด)
--   "ค้างอยู่" = แถวล่าสุดของใบนั้นเป็น returned คำนวณจากลำดับ seq
--   seq คือลำดับจริง: created_at ของธุรกรรมที่รอล็อกกันอยู่อาจสลับลำดับกับเวลาเริ่มธุรกรรม
--
-- ไม่มี FK ไปทริป เหมือน esign_signatures: แอดมินลบทริปแล้วหลักฐานยังอยู่
-- reason เป็นข้อความที่เจ้าหน้าที่พิมพ์เอง อาจมีข้อมูลบุคคล จึงไม่ส่งออก Telegram/กระดิ่ง/หน้าตรวจสอบสาธารณะ
--
-- ผลต่อของที่ใช้งานอยู่: ไม่มี — ตารางว่าง ไม่มีโค้ดเรียกจนกว่าจะ apply ไฟล์ถัดไป
-- idx_fleet_trips_esign_open: รายการรอลงนามต้องกวาดใบออนไลน์รวมที่จบทริปแล้ว ใบเซ็นสดไม่เข้าดัชนีนี้จึงเล็กมาก

DO $guard$
BEGIN
  IF to_regclass('public.esign_signatures') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ public.esign_signatures — ต้องรันชุดลงนามออนไลน์ก่อน';
  END IF;
END;
$guard$;

CREATE TABLE IF NOT EXISTS public.esign_trip_returns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE RESTRICT,
  doc_type        text NOT NULL CHECK (doc_type IN ('fleet_trip_request')),
  doc_id          uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('returned', 'resubmitted')),
  slot            text CHECK (slot IN ('dept_head', 'authority')),
  actor_id        uuid,
  actor_name      text NOT NULL DEFAULT '',
  actor_position  text NOT NULL DEFAULT '',
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT esign_trip_returns_shape CHECK (
    (kind = 'returned' AND slot IS NOT NULL AND char_length(btrim(reason)) BETWEEN 3 AND 500)
    OR (kind = 'resubmitted' AND slot IS NULL AND reason IS NULL)
  )
);

COMMENT ON TABLE public.esign_trip_returns IS
  'ส่งคืนผู้ขอ/ส่งกลับให้ลงนามต่อ แบบเพิ่มอย่างเดียว — เขียนผ่านฟังก์ชันลงนามเท่านั้น';

CREATE INDEX IF NOT EXISTS idx_esign_trip_returns_doc
  ON public.esign_trip_returns (doc_type, doc_id, seq DESC);

CREATE INDEX IF NOT EXISTS idx_fleet_trips_esign_open
  ON public.fleet_trips (municipality_id)
  WHERE esign_slots IS NOT NULL;

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select count(*) from public.esign_trip_returns;   → 0
