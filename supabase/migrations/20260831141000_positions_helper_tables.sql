-- ═══ ส่วนที่ 2/3: สร้างตารางเปล่า ═══════════════════════════════
-- ไฟล์นี้มีแต่ CREATE TABLE ล้วนๆ ไม่มีคำสั่งใดอ้างถึงตารางที่สร้างในไฟล์เดียวกันเลย
--
-- เหตุที่ต้องแยกละเอียดขนาดนี้: ตอนรวมทุกอย่างไว้ไฟล์เดียวได้ error 42703 ว่าไม่มีคอลัมน์
-- municipality_id ทั้งที่ ALTER TABLE อยู่ก่อนหน้าในไฟล์เดียวกัน แยกออกเป็นไฟล์ที่ 1 แล้วผ่าน
-- ส่วนที่เหลือยังไม่ผ่าน จึงตัดปัญหาแบบเดียวกันที่อาจเกิดกับ "ตารางที่เพิ่งสร้าง" ออกไปด้วย
--
-- ลำดับ: 20260831140000 (สแนปช็อต + คอลัมน์) → ไฟล์นี้ → 20260831142000 (ข้อมูล + RLS)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'positions' AND column_name = 'municipality_id'
  ) THEN
    RAISE EXCEPTION 'ยังไม่มีคอลัมน์ positions.municipality_id — ต้องรัน 20260831140000_positions_add_municipality_column.sql ก่อน';
  END IF;

  IF to_regclass('public.positions_backup_20260831') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตารางสแนปช็อต positions_backup_20260831 — ห้ามรันต่อโดยไม่มี backup';
  END IF;
END $$;

-- แม่แบบชุดตำแหน่งมาตรฐาน อบต./เทศบาล — ข้อมูลจะถูกเติมในไฟล์ถัดไป
CREATE TABLE IF NOT EXISTS public.position_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL UNIQUE,
  category        text        NOT NULL
    CHECK (category IN ('political_exec','council','top_admin','dept_head','operating_staff','field_technician')),
  role            text        NOT NULL
    CHECK (role IN ('superadmin','admin','officer','technician','staff','viewer','council','citizen')),
  department_hint text,
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ตารางแมป old_id → new_id ระหว่างโคลน ใช้ชั่วคราวแล้วถูกลบทิ้งท้ายไฟล์ถัดไป
-- เป็นตารางจริงไม่ใช่ TEMP เพราะต้องมองเห็นข้าม statement และข้ามไฟล์ได้แน่นอน
DROP TABLE IF EXISTS public._position_clone_map;
CREATE TABLE public._position_clone_map (
  old_id          uuid NOT NULL,
  new_id          uuid NOT NULL,
  municipality_id uuid NOT NULL
);
