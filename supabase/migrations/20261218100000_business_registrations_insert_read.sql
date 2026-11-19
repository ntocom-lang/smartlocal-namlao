-- 20261218100000_business_registrations_insert_read.sql
-- ปิดช่องเดิมของคำขอลงทะเบียนธุรกิจ (043) ก่อนเปิดตลาดชาวบ้านให้ อปท. จริง — รันได้ทุกเมื่อ ไม่ขึ้นกับหน้าเว็บ
--
-- (1) policy INSERT เดิม = WITH CHECK (auth.uid() = user_id) อย่างเดียว ⇒ ประชาชนยิง REST ใส่ status='approved'
--     + approved_by = uuid ของเจ้าหน้าที่ตัวจริงได้ ⇒ ผ่านด่าน market_link_owner_from_registration (20261214100100)
--     แล้วได้เป็นเจ้าของร้าน · ใบใหม่จากประชาชนต้องเป็น "รอตรวจ" ที่ไม่มีร่องรอยการพิจารณาของเจ้าหน้าที่เท่านั้น
--     department_id IS NULL: ขั้นตอนเดิม (20260802060000) ธุรการกองรับใบที่ยังไม่มีกองเข้ากองตัวเอง · ประชาชนใส่รหัสกอง
--       ของ อปท. อื่นได้ (INSERT ไม่มี department_belongs_to_municipality แบบ UPDATE) ⇒ ใบค้างที่ไม่มีใครรับได้นอกจากแอดมิน
--     admin_note IS NULL: กันประชาชนเขียน "หมายเหตุเจ้าหน้าที่" ปลอมไว้ล่วงหน้า
--     หน้าเว็บ BusinessRegisterPage ส่ง status='pending' และไม่ส่ง 4 ช่องที่เหลืออยู่แล้ว ⇒ ไม่ต้องแก้หน้าเว็บ
--     TO authenticated (เดิม public): anon ไม่มีสิทธิ์ INSERT ระดับตารางอยู่แล้ว เปลี่ยนให้ policy ตรงกับความจริง
-- (2) policy public_read_approved_businesses (status='approved' TO public) เปิดเบอร์/ที่อยู่/LINE/พิกัดของคำขอที่อนุมัติแล้ว
--     ให้ทุกคนทุก อปท. (PDPA) · ไม่มีหน้าเว็บใช้แล้ว: หน้า /market ยุบไป /tourism (อ่าน tourism_places) ตั้งแต่ 2026-09-04
--     ฝั่งเจ้าหน้าที่ใช้ policy "internal read business registrations" (อปท. ตัวเอง) · ผู้ยื่นใช้ owner_read_own_registrations
--     + ถอน SELECT ระดับตารางของ anon (กันชั้นที่สอง ถ้ามีใครเพิ่ม policy TO public ในอนาคต)
--     ⚠️ ไม่แตะสิทธิ์ MAINTAIN ของ anon (เป็นงานกวาดแยก ดู project_revoke_authenticated_truncate)
--
-- ย้อนกลับ: ไม่มี — ย้อน = เปิดช่องเดิมคืน ถ้าพบหน้าเว็บที่ต้องใช้ ให้แก้ไปข้างหน้า (ไม่มีข้อมูลหายทั้งสองทาง)
-- ข้อมูลเดิม: ไฟล์นี้กันเฉพาะใบใหม่ ใบที่มีอยู่แล้วต้องตรวจด้วย SELECT แยกก่อนเปิดตลาดให้ อปท. จริง
BEGIN;
SET LOCAL lock_timeout = '5s'; -- DROP/CREATE POLICY ถือ AccessExclusiveLock จน COMMIT — มี session ค้างให้ล้มเร็ว ไม่ขวางหน้าเว็บ

DO $pre$
BEGIN
  IF to_regclass('public.business_registrations') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง public.business_registrations';
  END IF;
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.business_registrations'::regclass AND NOT attisdropped
         AND attname IN ('user_id', 'status', 'approved_by', 'approved_at', 'department_id', 'admin_note')) <> 6 THEN
    RAISE EXCEPTION 'business_registrations ไม่ตรงโครงที่คาด (user_id/status/approved_by/approved_at/department_id/admin_note)';
  END IF;
END
$pre$;

-- (1) INSERT: ใบใหม่ = รอตรวจ ไม่มีผู้อนุมัติ/วันอนุมัติ/กอง/หมายเหตุเจ้าหน้าที่
DROP POLICY IF EXISTS "authenticated_insert_registration" ON public.business_registrations;
CREATE POLICY "authenticated_insert_registration" ON public.business_registrations
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'          -- NULL ไม่ผ่าน (ไม่ส่งมา = DEFAULT 'pending' ถูกเติมก่อนตรวจ)
    AND approved_by IS NULL
    AND approved_at IS NULL
    AND department_id IS NULL
    AND admin_note IS NULL
  );

-- (2) ปิดอ่านคำขอข้าม อปท.
DROP POLICY IF EXISTS "public_read_approved_businesses" ON public.business_registrations;
REVOKE SELECT ON public.business_registrations FROM anon;

-- ด่านท้ายไฟล์: ล้มทั้งไฟล์ถ้าผลไม่ตรง
DO $post$
DECLARE
  v_check text;
BEGIN
  -- เทียบสตริงเต็ม (LIKE '%pending%' ผ่านได้แม้เป็น status <> 'pending') · ตัด "auth." ก่อนเทียบ
  -- เพราะ session ที่ search_path มี auth จะ deparse เป็น uid() เฉยๆ
  SELECT replace(pg_get_expr(p.polwithcheck, p.polrelid), 'auth.uid()', 'uid()') INTO v_check
    FROM pg_policy p
   WHERE p.polrelid = 'public.business_registrations'::regclass AND p.polname = 'authenticated_insert_registration'
     AND p.polpermissive AND p.polcmd = 'a';
  IF v_check IS DISTINCT FROM '((user_id = uid()) AND (status = ''pending''::text) AND (approved_by IS NULL) AND (approved_at IS NULL) AND (department_id IS NULL) AND (admin_note IS NULL))' THEN
    RAISE EXCEPTION 'policy INSERT ไม่ตรงที่คาด: %', v_check;
  END IF;
  -- policy permissive รวมกันด้วย OR ⇒ มี INSERT/ALL ตัวอื่นค้าง = ช่องกลับมา
  IF EXISTS (SELECT 1 FROM pg_policy p
              WHERE p.polrelid = 'public.business_registrations'::regclass
                AND p.polcmd IN ('a', '*') AND p.polpermissive
                AND p.polname <> 'authenticated_insert_registration') THEN
    RAISE EXCEPTION 'ยังมี policy INSERT/ALL ตัวอื่นบน business_registrations';
  END IF;
  -- policy อ่านที่เปิดให้ public/anon ต้องเหลือแค่ owner_read_own_registrations (USING auth.uid() = user_id ⇒ anon ได้ 0 แถว)
  IF EXISTS (SELECT 1 FROM pg_policy p
              WHERE p.polrelid = 'public.business_registrations'::regclass
                AND p.polcmd IN ('r', '*')
                AND (0::oid = ANY (p.polroles) OR 'anon'::regrole::oid = ANY (p.polroles))
                AND NOT (p.polname = 'owner_read_own_registrations'
                         AND replace(pg_get_expr(p.polqual, p.polrelid), 'auth.uid()', 'uid()') = '(uid() = user_id)')) THEN
    RAISE EXCEPTION 'ยังมี policy อ่านที่เปิดให้ public/anon บน business_registrations';
  END IF;
  IF has_any_column_privilege('anon', 'public.business_registrations', 'SELECT') THEN
    RAISE EXCEPTION 'anon ยังมีสิทธิ์ SELECT บน business_registrations';
  END IF;
END
$post$;

COMMIT;

NOTIFY pgrst, 'reload schema';
