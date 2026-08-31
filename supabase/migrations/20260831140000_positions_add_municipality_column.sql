-- ═══ ส่วนที่ 1/2: สแนปช็อต + เพิ่มคอลัมน์ ═══════════════════════
-- ⚠️ ต้องรันไฟล์นี้ให้จบก่อน แล้วค่อยรัน 20260831141000_positions_per_municipality.sql
--    ห้ามรวมสองไฟล์ส่งไปพร้อมกัน — ตอน apply ครั้งแรกที่รวมทุกอย่างไว้ไฟล์เดียว ได้ error
--    42703 "column municipality_id of relation positions does not exist" ทั้งที่ ALTER TABLE
--    อยู่บรรทัดก่อนหน้า แยกการเพิ่มคอลัมน์ออกมาเป็นคนละครั้งที่ส่งจึงตัดปัญหานี้ทิ้งได้แน่นอน
--
-- แยกตาราง positions ให้เป็น "ของใครของมัน" รายหน่วยงาน — เดิมเป็นตารางกลางไม่มี municipality_id
-- (ดู 20260729171006_positions_personnel.sql) ทุก อปท. ใช้แถวชุดเดียวกัน ผลคือ:
--   1. แอดมิน อปท. แก้ตำแหน่งของตัวเองไม่ได้เลย (RLS เดิมให้เฉพาะ superadmin)
--   2. ถ้าเปิดสิทธิ์ให้แก้ อปท. หนึ่งแก้ชื่อ/ลบตำแหน่ง อีก อปท. เปลี่ยนตามทันที และคนที่ถือตำแหน่ง
--      ที่ถูกลบจะหลุด position_id (ON DELETE SET NULL) แล้วหายจากหน้าบุคลากรฝั่งประชาชนทั้งคน
--      เพราะ get_public_personnel_directory ใช้ INNER JOIN positions
--   3. แต่ละ อปท. มีโครงสร้างตำแหน่งไม่เหมือนกันอยู่แล้ว (ชื่อกอง จำนวนกอง ต่างกัน)
--
-- หลังไฟล์นี้: positions.municipality_id เป็น NOT NULL ทุกแถว, แอดมินของแต่ละ อปท. จัดการเองได้
-- ชุดตำแหน่งมาตรฐานเดิมย้ายไปเก็บที่ position_templates ไว้ให้ อปท. ใหม่กดนำเข้า
--
-- FK ที่ชี้มาที่ positions มี 2 จุดเท่านั้น (ตรวจแล้ว) ต้อง repoint ทั้งคู่ก่อนลบแถวกลาง:
--   - profiles.position_id       ON DELETE SET NULL
--   - position_holders.position_id ON DELETE CASCADE

-- ── 0. สแนปช็อตก่อนแตะอะไรทั้งสิ้น ─────────────────────────────
-- เก็บสภาพเดิมของทั้ง 3 ตารางที่ไฟล์นี้จะแก้ ไว้ย้อนกลับได้ถ้าผลลัพธ์ไม่เป็นอย่างที่คิด
-- (ดูสคริปต์ย้อนกลับที่ supabase/rollback/20260831140000_rollback_positions_per_municipality.sql)
-- ทำก่อน ALTER TABLE เพื่อให้สแนปช็อตเป็นโครงสร้างเดิมเป๊ะ ยังไม่มีคอลัมน์ municipality_id
--
-- ⚠️ ตารางสแนปช็อตต้องปิดตายทั้งหมด — PostgREST เปิด API ให้ทุกตารางใน schema public โดยอัตโนมัติ
-- ถ้าไม่ REVOKE + เปิด RLS แบบไม่มี policy จะกลายเป็นช่องอ่านข้อมูลข้าม อปท. ทันที
-- (position_holders มีชื่อ-นามสกุลและเบอร์โทรของบุคคล = ข้อมูลส่วนบุคคลตาม PDPA)
CREATE TABLE IF NOT EXISTS public.positions_backup_20260831 AS
  SELECT * FROM public.positions;

CREATE TABLE IF NOT EXISTS public.profiles_position_backup_20260831 AS
  SELECT id, municipality_id, position_id FROM public.profiles WHERE position_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.position_holders_backup_20260831 AS
  SELECT * FROM public.position_holders;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'positions_backup_20260831',
    'profiles_position_backup_20260831',
    'position_holders_backup_20260831'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated, public', v_table);
    EXECUTE format(
      'COMMENT ON TABLE public.%I IS %L',
      v_table,
      'สแนปช็อตก่อน migration 20260831140000 (positions แยกรายหน่วยงาน) — ปิดการเข้าถึงทั้งหมด '
      || 'ลบทิ้งได้เมื่อยืนยันว่าระบบทำงานปกติแล้ว'
    );
  END LOOP;
END $$;

DO $$
DECLARE
  v_positions integer;
  v_profiles  integer;
  v_holders   integer;
BEGIN
  SELECT count(*) INTO v_positions FROM public.positions_backup_20260831;
  SELECT count(*) INTO v_profiles  FROM public.profiles_position_backup_20260831;
  SELECT count(*) INTO v_holders   FROM public.position_holders_backup_20260831;
  RAISE NOTICE 'สแนปช็อต: positions % แถว, profiles ที่ผูกตำแหน่ง % แถว, position_holders % แถว',
    v_positions, v_profiles, v_holders;

  IF v_positions = 0 THEN
    RAISE EXCEPTION 'ตาราง positions ว่างเปล่า — ผิดปกติ หยุดก่อนเพื่อไม่ให้ migration ทำงานบน DB ผิดตัว';
  END IF;
END $$;

-- ── 1. คอลัมน์เจ้าของ ──────────────────────────────────────────
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS municipality_id uuid REFERENCES public.municipalities(id) ON DELETE CASCADE;

