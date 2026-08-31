-- ย้อนกลับ migration ทั้ง 3 ไฟล์:
--   20260831140000_positions_add_municipality_column.sql  (สแนปช็อต + เพิ่มคอลัมน์)
--   20260831141000_positions_helper_tables.sql            (ตารางเปล่า)
--   20260831142000_positions_per_municipality.sql         (ข้อมูล + RLS + ฟังก์ชัน)
-- รันไฟล์นี้ไฟล์เดียวย้อนได้ทั้งหมด
--
-- ⚠️ ไฟล์นี้อยู่นอก supabase/migrations โดยตั้งใจ จะไม่ถูก apply อัตโนมัติ
--    รันมือเท่านั้น และรันได้ต่อเมื่อ 3 ตารางสแนปช็อตยังอยู่ครบ:
--      public.positions_backup_20260831
--      public.profiles_position_backup_20260831
--      public.position_holders_backup_20260831
--
-- ⚠️ ตำแหน่งที่ "สร้างขึ้นใหม่หลัง migration" (แอดมิน อปท. เพิ่มเองผ่านแท็บแบบตำแหน่ง)
--    จะหายไปทั้งหมด และคนที่ถูกแต่งตั้งเข้าตำแหน่งเหล่านั้นจะถูกคืนค่าเป็นตำแหน่งเดิมตอนก่อน
--    migration — ยิ่งปล่อยไว้นานยิ่งเสียข้อมูลเยอะ ถ้าจะย้อนให้ย้อนเร็ว
--
-- ⚠️ ตรวจก่อนรัน: ดูว่าจะเสียตำแหน่งที่สร้างใหม่ไปกี่แถว
--    SELECT count(*) FROM public.positions p
--    WHERE NOT EXISTS (SELECT 1 FROM public.positions_backup_20260831 b WHERE b.id = p.id);

BEGIN;

-- 1. ปลดข้อบังคับที่ migration ใส่ไว้ เพื่อให้แถวชุดกลาง (municipality_id IS NULL) กลับเข้าไปได้
DROP INDEX IF EXISTS public.positions_municipality_name_key;
DROP INDEX IF EXISTS public.positions_municipality_sort_idx;
ALTER TABLE public.positions ALTER COLUMN municipality_id DROP NOT NULL;

-- 2. คืนแถวตำแหน่งชุดกลางเดิมด้วย id เดิม (FK ที่คืนในขั้นถัดไปจึงชี้ถูก)
INSERT INTO public.positions (id, name, category, role, department_hint, sort_order, created_at)
SELECT b.id, b.name, b.category, b.role, b.department_hint, b.sort_order, b.created_at
FROM public.positions_backup_20260831 b
ON CONFLICT (id) DO NOTHING;

-- 3. คืน FK ทั้ง 2 จุดให้ชี้แถวเดิม
UPDATE public.profiles pr
SET position_id = b.position_id
FROM public.profiles_position_backup_20260831 b
WHERE pr.id = b.id
  AND pr.position_id IS DISTINCT FROM b.position_id;

-- คนที่ถูกแต่งตั้งหลัง migration (ไม่มีในสแนปช็อต) จะชี้ตำแหน่งที่กำลังจะถูกลบในขั้น 4
-- ล้างเป็น NULL ไปก่อน ให้ผลเหมือน ON DELETE SET NULL แต่เห็นชัดว่าตั้งใจทำ
UPDATE public.profiles pr
SET position_id = NULL
WHERE pr.position_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.positions_backup_20260831 b WHERE b.id = pr.position_id);

UPDATE public.position_holders ph
SET position_id = b.position_id
FROM public.position_holders_backup_20260831 b
WHERE ph.id = b.id
  AND ph.position_id IS DISTINCT FROM b.position_id;

-- position_holders.position_id เป็น NOT NULL + ON DELETE CASCADE — แถวที่เพิ่มหลัง migration
-- และชี้ตำแหน่งที่กำลังจะถูกลบ จะโดน CASCADE หายไปเอง ตั้งใจปล่อยตามนั้น
-- (ตารางนี้ไม่มี UI ไหนเขียนแล้วตั้งแต่ 2026-08-31 โอกาสมีแถวใหม่แทบเป็นศูนย์)

-- 4. ลบตำแหน่งที่ migration โคลนขึ้นมา (และที่แอดมินเพิ่มเองหลังจากนั้น)
DELETE FROM public.positions WHERE municipality_id IS NOT NULL;

-- 5. คืนโครงสร้างและ RLS เดิม
ALTER TABLE public.positions DROP COLUMN IF EXISTS municipality_id;

DROP POLICY IF EXISTS "positions read own municipality" ON public.positions;
DROP POLICY IF EXISTS "positions admin manage own municipality" ON public.positions;

CREATE POLICY "staff and up can view positions" ON public.positions FOR SELECT
  TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['staff','officer','technician','admin','superadmin','viewer','council']));

CREATE POLICY "superadmin manage positions" ON public.positions FOR ALL
  TO authenticated
  USING (public.get_my_role() = 'superadmin')
  WITH CHECK (public.get_my_role() = 'superadmin');

-- 6. เก็บกวาดของที่ migration สร้างขึ้นใหม่
DROP FUNCTION IF EXISTS public.import_default_positions(uuid);
DROP TABLE IF EXISTS public.position_templates;
DROP TABLE IF EXISTS public._position_clone_map;

COMMIT;

-- ตรวจหลังรัน: ต้องได้จำนวนเท่ากับตอนก่อน migration
--   SELECT count(*) FROM public.positions;                                  -- = จำนวนใน positions_backup_20260831
--   SELECT count(*) FROM public.profiles WHERE position_id IS NOT NULL;     -- ≈ จำนวนใน profiles_position_backup_20260831
--
-- ตารางสแนปช็อตยังไม่ถูกลบ ลบเองเมื่อมั่นใจแล้วด้วย:
--   DROP TABLE public.positions_backup_20260831,
--              public.profiles_position_backup_20260831,
--              public.position_holders_backup_20260831;
