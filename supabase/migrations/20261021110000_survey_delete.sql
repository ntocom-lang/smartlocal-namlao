-- 20261021110000_survey_delete.sql
--
-- แบบสำรวจความเห็นประชาชน: เพิ่ม "ลบแบบสำรวจ" (เจ้าของระบบสั่ง 2026-10-20) — ต้อง apply หลัง 20261020170100
--
-- ฟังก์ชันใหม่ล้วน ไม่มี CREATE OR REPLACE ทับของเดิม (docs/ai/NOTES.md ข้อ 5):
--   survey_can_delete(_municipality_id)  ตัวช่วยภายใน ไม่เปิดให้ API
--   delete_survey(_survey_id)            เปิดให้ authenticated (anon เรียกไม่ได้)
--
-- ใครลบได้: superadmin + admin ของ อปท. นั้น เท่านั้น — แคบกว่าผู้ที่ "สร้าง/ปิด" ได้ (survey_can_manage = + officer/staff)
--   เพราะลบแล้วกู้คืนไม่ได้ (ไม่มีถังขยะ) เจ้าหน้าที่ที่สร้างผิดยังใช้ "ปิดตอนนี้" ได้ แล้วให้ admin ลบ
-- ลบอะไร: แถว surveys แถวเดียว — ตัวเลือก ทะเบียนผู้ใช้สิทธิ์ และหีบบัตร (ยอดโหวต + ความเห็น) ไหลตาม ON DELETE CASCADE ทั้งหมด
--   ลบได้ทุกสถานะ รวมที่ยังเปิดรับและมีผู้ตอบแล้ว (หน้าจอมีขั้นยืนยันบอกจำนวนผู้ตอบก่อน)
-- ประวัติ: ลง audit_logs action 'delete' ก่อนลบ — ใคร/เรื่องอะไร/สถานะ/ผู้ตอบกี่คน/ความเห็นกี่รายการ ไม่เก็บเนื้อความเห็น
--   audit_logs ไม่มี FK ไปตาราง surveys (resource_id เป็นข้อความ) ประวัติจึงอยู่ต่อหลังลบ
--
-- ทดสอบพฤติกรรมด้วย PGlite: tests/community-survey-db.test.mjs

CREATE OR REPLACE FUNCTION public.survey_can_delete(_municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND public.get_my_municipality_id() = _municipality_id),
    false)
$$;

CREATE OR REPLACE FUNCTION public.delete_survey(_survey_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_s        public.surveys%ROWTYPE;
  v_answers  integer;
  v_comments integer;
  v_status   text;
BEGIN
  SELECT * INTO v_s FROM public.surveys WHERE id = _survey_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF auth.uid() IS NULL OR NOT public.survey_can_delete(v_s.municipality_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  SELECT count(*)::int, count(comment)::int INTO v_answers, v_comments
    FROM public.survey_ballots WHERE survey_id = v_s.id;
  v_status := CASE WHEN now() < LEAST(v_s.closes_at, COALESCE(v_s.closed_early_at, v_s.closes_at)) THEN 'open' ELSE 'closed' END;

  -- ลงประวัติก่อนลบ (ธุรกรรมเดียวกัน: ลบไม่สำเร็จ = ประวัติก็ไม่ลง)
  PERFORM public.survey_audit(v_s.municipality_id, 'delete', v_s.id, v_s.question,
    jsonb_build_object('status', v_status, 'answers', v_answers, 'comments', v_comments));

  DELETE FROM public.surveys WHERE id = v_s.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.survey_can_delete(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_survey(uuid)     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_survey(uuid)  TO authenticated;

NOTIFY pgrst, 'reload schema';
