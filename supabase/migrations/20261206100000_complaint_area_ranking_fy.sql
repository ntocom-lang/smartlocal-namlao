-- 20261206100000_complaint_area_ranking_fy.sql
--
-- ภาพสรุปเรื่องร้องเรียน (/reports/complaints) อยากแสดง "พื้นที่ที่มีเรื่องร้องเรียนมากที่สุด" (หมู่ 3–5 อันดับ)
-- เจ้าของระบบสั่ง 2569-11-17 ตามภาพอ้างอิงแบบ "TOP 10 จังหวัด"
--
-- ทำไมต้องเป็นฟังก์ชันใหม่: complaints_public_fy (ฟังก์ชันสาธารณะเดิม) ไม่คืนหมู่บ้าน และห้ามแก้ (ทุกหน้ารายงานใช้อยู่)
--
-- ⚠️ ด่านข้อมูลส่วนบุคคล (PDPA):
--   1) complaints.village เป็น text — ฟอร์มให้เลือกจากทะเบียนสถานที่ แต่มีตัวเลือก "อื่นๆ" ให้พิมพ์เอง,
--      อปท. ที่ยังไม่มีทะเบียนเป็นช่องพิมพ์ และผู้ที่เรียก RPC รับเรื่องตรงๆ ใส่อะไรก็ได้ (อาจมีชื่อคน/บ้านเลขที่/เบอร์)
--      → นับผ่าน exec_village_label เท่านั้น: คืน "หมู่ N" หรือชื่อในทะเบียน locations · ข้อความอื่น/ว่าง = NULL (ไม่ระบุ)
--      ไม่มีข้อความที่ผู้แจ้งพิมพ์เองออกจากฟังก์ชันนี้เลย
--   2) หมวดอ่อนไหว: ตัดรหัส 'corruption' ตายตัว + ตัดหมวดที่ตั้ง requires_manual_intake
--      ไม่พึ่งธงอย่างเดียว (แบบเดียวกับ 20261119100100): ธงนี้แอดมินปิดเองได้, ปุ่ม "โหลดค่าเริ่มต้น" ไม่ตั้งธงให้หมวด corruption
--      และคำร้องที่หมวดไม่มีแถวในตาราง COALESCE เป็น false — ถ้าหลุด anon จับคู่กับ complaints_public_fy (ref+หมวด+เวลา)
--      ในวันที่มีเรื่องเดียว = รู้ว่าผู้แจ้งเบาะแสทุจริตอยู่หมู่ไหน (พบใน migration-reviewer รอบ 1)
--   3) _exclude_categories (หมวดที่เจ้าหน้าที่เลือกไม่แสดงในภาพ) มีผลเฉพาะเจ้าหน้าที่/แอดมินของ อปท. นั้น หรือ superadmin
--      คนทั่วไปส่งมาก็ไม่มีผล — ไม่งั้นเรียก 2 ครั้ง (ตัด/ไม่ตัดหมวด X) แล้วลบกัน = ได้ยอดรายหมู่ของหมวด X
--      สิทธิ์ชุดเดียวกับ publish_complaint_monthly_snapshot (admin/officer/staff ของ อปท. นั้น + superadmin)
--   4) คนที่ไม่ใช่เจ้าหน้าที่ได้อันดับเฉพาะช่วง "เดือนเต็ม" (เริ่มวันที่ 1 จบวันสิ้นเดือน: เดือน/ไตรมาส/ปีงบ) อื่นๆ คืน 0 แถว
--      ช่วงวัน/สัปดาห์ จับคู่กับ complaints_public_fy แล้วชี้ได้ว่าเรื่องเดี่ยวในวันนั้นมาจากหมู่ไหน และแค่บังคับ "ยาวขั้นต่ำ"
--      กันไม่ได้ (เรียก [D, D+28] ลบ [D+1, D+28] = ยอดของวัน D) · เดือนเต็มลบกันละเอียดสุดได้แค่ระดับเดือน
--      (migration-reviewer รอบ 2) · เจ้าหน้าที่ได้ทุกช่วง · role/สังกัด NULL = ไม่ใช่เจ้าหน้าที่ (ปิดตายเมื่อไม่แน่ใจ)
--   ผลลัพธ์เป็นยอดนับรายหมู่เท่านั้น ไม่มี ref_no/วันที่/หมวด/สถานะ
--
-- นับหมวดเฉพาะกิจ (is_adhoc) ด้วย ให้ตรงกับยอดรวม/วงกลมในภาพเดียวกัน (complaint_stats_fy นับทุกหมวด)
-- — ต่างจากอันดับหมู่บ้านของห้องผู้บริหาร (20261115100100) ซึ่งตัดหมวดเฉพาะกิจ ตัวเลขสองหน้าจึงอาจไม่เท่ากันโดยเจตนา
--
-- ช่วงวันที่ยาวสุด 400 วัน (ปีงบประมาณ = 365/366) กันการสแกนทั้งตาราง · คืนไม่เกิน 30 แถว (หน้าใช้แค่ 5 อันดับ)
-- จัดกลุ่มตามข้อความ village ก่อน แล้วค่อยเรียก exec_village_label ต่อข้อความที่ไม่ซ้ำ (เรียกน้อยลงหลายสิบเท่า)
-- เพิ่มฟังก์ชันอย่างเดียว ไม่แก้ตาราง/ข้อมูลเดิม
-- ย้อนได้ด้วย: DROP FUNCTION public.complaint_area_ranking_fy(uuid, date, date, text[]);

BEGIN;

-- ── ด่านก่อนสร้าง: ของที่ฟังก์ชันพึ่งต้องมีครบและเป็นรุ่นที่รู้จัก ──
DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regprocedure('public.exec_village_label(uuid,text)') IS NULL
     OR to_regprocedure('public.get_my_role()') IS NULL
     OR to_regprocedure('public.get_my_municipality_id()') IS NULL THEN
    RAISE EXCEPTION 'complaint_area_ranking_fy: ต้องมี exec_village_label (20261115100100/20261116100000), get_my_role, get_my_municipality_id ก่อน';
  END IF;

  -- exec_village_label คือด่านกันข้อความที่ผู้แจ้งพิมพ์เอง — ต้องเป็นรุ่นในรีโป [E2 20261115100100, E2.1 20261116100000]
  -- (ค่าเดียวกับด่านใน 20261128100000_exec_overdue_items_place.sql)
  IF md5(replace((SELECT p.prosrc FROM pg_proc AS p WHERE p.oid = 'public.exec_village_label(uuid,text)'::regprocedure), chr(13), ''))
     NOT IN ('4b0062db0add791a7e9b243a3b1cb184', 'fcefeb5fdad4aee4517724bffc65a49b') THEN
    RAISE EXCEPTION 'complaint_area_ranking_fy: exec_village_label ไม่ใช่รุ่นในรีโป (md5 ไม่ตรง) — หยุดก่อน';
  END IF;

  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('complaints', 'municipality_id'), ('complaints', 'category'), ('complaints', 'village'), ('complaints', 'created_at'),
    ('complaint_categories', 'municipality_id'), ('complaint_categories', 'value'), ('complaint_categories', 'requires_manual_intake')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS ic
    WHERE ic.table_schema = 'public' AND ic.table_name = need.tbl AND ic.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'complaint_area_ranking_fy: ไม่พบคอลัมน์ %', v_missing;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.complaint_area_ranking_fy(
  _municipality_id    uuid,
  _from               date,
  _to                 date,
  _exclude_categories text[] DEFAULT NULL
)
RETURNS TABLE (
  area  text,    -- "หมู่ N" หรือชื่อในทะเบียน locations · NULL = ไม่ระบุ/ระบุไม่ได้ (หน้าเว็บไม่จัดอันดับแถวนี้)
  total bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from     timestamptz;
  v_to       timestamptz;
  v_exclude  text[] := '{}';
  v_is_staff boolean := false;
  v_role     text;
  v_muni     uuid;
BEGIN
  IF _municipality_id IS NULL OR _from IS NULL OR _to IS NULL OR _to < _from OR _to - _from > 400 THEN
    RETURN;
  END IF;

  -- เจ้าหน้าที่ของ อปท. นี้ (หรือ superadmin) — สิทธิ์ชุดเดียวกับ publish_complaint_monthly_snapshot
  IF auth.uid() IS NOT NULL THEN
    v_role := public.get_my_role();
    v_muni := public.get_my_municipality_id();
    -- ปิดตายเมื่อไม่แน่ใจ: role/สังกัดเป็น NULL = ไม่ใช่เจ้าหน้าที่
    v_is_staff := COALESCE(v_role = 'superadmin'
      OR (v_muni IS NOT NULL AND v_muni = _municipality_id AND v_role IN ('admin', 'officer', 'staff')), false);
  END IF;

  -- ด่าน 4: คนทั่วไปได้อันดับเฉพาะช่วงเดือนเต็ม (วันที่ 1 ถึงสิ้นเดือน: เดือน/ไตรมาส/ปีงบ)
  -- ขั้นต่ำ 28 วันกันไม่ได้: [D, D+28] ลบ [D+1, D+28] = ยอดรายหมู่ของวัน D
  IF NOT v_is_staff AND (EXTRACT(day FROM _from) <> 1 OR EXTRACT(day FROM _to + 1) <> 1) THEN
    RETURN;
  END IF;

  -- ด่าน 3: ตัดหมวดได้เฉพาะเจ้าหน้าที่ · ตัด NULL ออก (NULL ใน ANY ทำให้ทุกแถวหลุด) · จำกัด 50 รหัส
  IF v_is_staff AND _exclude_categories IS NOT NULL THEN
    v_exclude := COALESCE(array_remove(_exclude_categories[1:50], NULL), '{}');
  END IF;

  -- ขอบเขตวันที่ตามปฏิทินไทย แบบเดียวกับ complaint_stats_fy / complaint_issue_breakdown_fy (_to นับรวม)
  v_from := (_from::timestamp) AT TIME ZONE 'Asia/Bangkok';
  v_to   := ((_to + 1)::timestamp) AT TIME ZONE 'Asia/Bangkok';

  RETURN QUERY
    WITH raw AS (
      -- นับตามข้อความดิบก่อน (ข้อความนี้ไม่ออกจากฟังก์ชัน) แล้วแปลงชื่อทีละข้อความที่ไม่ซ้ำ
      SELECT c.village, count(*)::bigint AS n
      FROM public.complaints AS c
      LEFT JOIN public.complaint_categories AS cat
        ON cat.municipality_id = c.municipality_id AND cat.value = c.category
      WHERE c.municipality_id = _municipality_id
        AND c.created_at >= v_from
        AND c.created_at <  v_to
        AND c.category <> 'corruption'                          -- ด่าน 2: ปิดตายตามรหัส
        AND NOT COALESCE(cat.requires_manual_intake, false)     -- ด่าน 2: หมวดที่แอดมินตั้งเป็นอ่อนไหว
        AND NOT COALESCE(c.category = ANY (v_exclude), false)   -- ด่าน 3
      GROUP BY c.village
    )
    SELECT g.area, sum(g.n)::bigint AS total
    FROM (
      -- ด่าน 1: ชื่อพื้นที่มาจาก exec_village_label เสมอ ('' = ข้อความที่ไม่ใช่เลขหมู่/ชื่อในทะเบียน → NULL)
      SELECT NULLIF(public.exec_village_label(_municipality_id, r.village), '') AS area, r.n
      FROM raw AS r
    ) AS g
    GROUP BY g.area
    ORDER BY sum(g.n) DESC, g.area NULLS LAST
    LIMIT 30;
END;
$$;

REVOKE ALL ON FUNCTION public.complaint_area_ranking_fy(uuid, date, date, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complaint_area_ranking_fy(uuid, date, date, text[]) TO anon, authenticated;

COMMENT ON FUNCTION public.complaint_area_ranking_fy(uuid, date, date, text[]) IS
  'ภาพสรุปเรื่องร้องเรียน: ยอดเรื่องรายหมู่ (ชื่อผ่าน exec_village_label เท่านั้น ไม่มีข้อความที่ผู้แจ้งพิมพ์เอง) · '
  'ไม่นับ corruption และหมวด requires_manual_intake · _exclude_categories มีผลเฉพาะเจ้าหน้าที่ของ อปท. นั้น/superadmin · '
  'คนทั่วไปได้เฉพาะช่วงเดือนเต็ม · ช่วง ≤ 400 วัน คืน ≤ 30 แถว (20261206100000)';

-- ── ด่านท้ายไฟล์ (ล้ม = ย้อนกลับทั้งไฟล์) ──
-- 1) เจ้าของฟังก์ชันใหม่ต้องเรียก exec_village_label ได้ (ถอนสิทธิ์จาก PUBLIC แล้ว) — ไม่งั้นทุกครั้งได้ 42501 แล้วการ์ดหายเงียบ
-- 2) สิทธิ์ EXECUTE ต้องตรงตามแผน — REVOKE ที่ grantor ไม่ตรงผ่านเงียบๆ แต่สิทธิ์ยังอยู่ (แบบเดียวกับ 20261114100000)
DO $$
DECLARE
  v_owner oid := (SELECT p.proowner FROM pg_proc AS p
                  WHERE p.oid = 'public.complaint_area_ranking_fy(uuid,date,date,text[])'::regprocedure);
BEGIN
  IF NOT has_function_privilege(v_owner, 'public.exec_village_label(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'complaint_area_ranking_fy: เจ้าของฟังก์ชัน (%) เรียก exec_village_label ไม่ได้ — รันด้วย role เดียวกับ executive_overview',
      v_owner::regrole;
  END IF;
  IF NOT has_function_privilege('anon', 'public.complaint_area_ranking_fy(uuid,date,date,text[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.complaint_area_ranking_fy(uuid,date,date,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'complaint_area_ranking_fy: anon/authenticated ต้องเรียกได้ (หน้าสถิติเป็นหน้าสาธารณะ)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ตรวจหลังรัน (ไม่ต้องรันพร้อมไฟล์):
--   select * from public.complaint_area_ranking_fy('<uuid ของ อปท.>', '2026-10-01', '2026-10-31');
--   → แถวละหมู่ ไม่มีข้อความแปลกปลอม · แถว area = NULL คือไม่ระบุหมู่
