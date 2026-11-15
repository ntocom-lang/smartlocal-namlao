-- 20261127100000_exec_summary_complaint_spike.sql
--
-- ห้องผู้บริหาร — สัญญาณ "เรื่องร้องเรียนพุ่งผิดปกติ" (เจ้าของระบบอนุมัติ 2026-11-15)
--   exec_summary_complaint_spike(uuid, date, date)  ฟังก์ชันใหม่ 1 ตัว ไม่ทับของเดิม (ไม่ CREATE OR REPLACE ฟังก์ชันที่มีอยู่)
--   executive_overview() เรียกเองตามชื่อคีย์ 'complaint_spike' (dynamic dispatch เฉพาะฟังก์ชันเจ้าของเดียวกัน — ไฟล์ 20261115100000)
--
-- กฎ (ภาษาคน — ตรงกับสูตร ⓘ ในทะเบียน src/lib/executiveRegistry.js รายการ complaints alert 'spike'):
--   ต่อหมวดคำร้อง: 7 วันล่าสุด [T−6 00:00, T+1 00:00) เวลาไทย มีอย่างน้อย 5 เรื่อง
--   และมากกว่าหรือเท่ากับ 2 เท่าของค่าเฉลี่ยต่อสัปดาห์ของ 28 วันก่อนหน้า [T−34 00:00, T−6 00:00)
--   ⇔ recent >= 5 AND recent * 2 >= base   (base = ยอด 28 วัน · ค่าเฉลี่ยต่อสัปดาห์ = base / 4 · 2 เท่า = base / 2)
--   นับเฉพาะหมวดที่ยังอยู่ในทะเบียน (INNER JOIN) — หมวดที่ถูกลบไม่รู้ว่าเคยเป็นหมวดอ่อนไหวไหม จึงไม่นับ (รีวิว ข้อ 1)
--   ไม่นับ: ปฏิเสธ (rejected) / หมวดเฉพาะกิจ (is_adhoc) / หมวดอ่อนไหว (requires_manual_intake) / ไม่ระบุหมวด
--   ด่านข้อมูลพอ (insufficient_history = true → ไม่ตัดสิน) กันเตือนลวงของ อปท. ที่เพิ่งเริ่มใช้ระบบ:
--     ต้องมีคำร้องเก่ากว่าช่วงฐาน (ก่อน T−34) อย่างน้อย 1 เรื่อง และช่วงฐาน 28 วันมีคำร้องที่นับได้รวมทุกหมวด ≥ 4 เรื่อง
--     (ข้อมูลทดสอบเก่าค้าง 1 แถวแต่เพิ่งใช้จริง = ช่วงฐานบาง → ไม่ตัดสิน)
--   หมู่บ้านที่แจ้งมากสุด: เฉพาะหมู่ที่มี ≥ 2 เรื่อง และมากกว่าอันดับสองจริง (เสมอกัน = ไม่ระบุ) (รีวิว ข้อ 2)
--   _from/_to ไม่ใช้ (กฎนับจากวันนี้เสมอ) แต่ต้องรับไว้ตามสัญญา exec_summary_<key>(uuid,date,date)
--
-- คืน (ตัวเลขรวม + รหัส/ชื่อหมวด + ชื่อหมู่บ้านที่ผ่าน exec_village_label เท่านั้น — ไม่คืนชื่อคน/ข้อความผู้ร้อง/id รายเรื่อง):
--   { recent_days: 7, base_days: 28, min: 5, ratio: 2, insufficient_history: bool,
--     groups: [{ category, label, recent, base, village, village_n }] }   สูงสุด 10 หมวด เรียง recent มาก → น้อย
--
-- ระบบแค่ชี้ ไม่สั่งการ ไม่เปลี่ยนสถานะคำร้อง — ยอดพุ่งอาจมาจากเหตุอื่น เช่น เพิ่งประชาสัมพันธ์ช่องทางแจ้งเรื่อง
--
-- ย้อนกลับ: DROP FUNCTION IF EXISTS public.exec_summary_complaint_spike(uuid, date, date);
--   + ลบแถว version 20261127100000 ใน supabase_migrations.schema_migrations (ไม่มีข้อมูลหาย)
--   (หน้าเว็บที่ขอคีย์นี้จะได้ {ok:false} → แถบ "ตรวจสัญญาณเตือนของ คำร้อง ไม่ได้" ไม่พังทั้งหน้า)
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT p.prosecdef, p.proowner::regrole, p.proconfig,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
--   FROM pg_proc p WHERE p.oid = 'public.exec_summary_complaint_spike(uuid,date,date)'::regprocedure;
--     → t / owner เดียวกับ executive_overview / {search_path=""} / f / f

BEGIN;

DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regprocedure('public.executive_overview(uuid,date,date,text[])') IS NULL
     OR to_regprocedure('public.exec_assert_viewer(uuid)') IS NULL
     OR to_regprocedure('public.exec_village_label(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'exec_summary_complaint_spike: ต้อง apply 20261115100000 / 20261115100100 / 20261116100000 ก่อน';
  END IF;
  -- ฟังก์ชันใหม่พึ่ง exec_village_label กันข้อความที่ผู้แจ้งพิมพ์เอง — ล็อกรุ่น E2.1 (#686) ถ้าถูกแก้นอก repo ให้หยุด (รีวิว ข้อ 3)
  IF (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_catalog.pg_proc AS p
      WHERE p.oid = 'public.exec_village_label(uuid,text)'::regprocedure) IS DISTINCT FROM 'fcefeb5fdad4aee4517724bffc65a49b' THEN
    RAISE EXCEPTION 'exec_summary_complaint_spike: exec_village_label ไม่ใช่รุ่น 20261116100000 (md5 ไม่ตรง) — ตรวจก่อน';
  END IF;
  IF to_regprocedure('public.exec_summary_complaint_spike(uuid,date,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'exec_summary_complaint_spike: มีฟังก์ชันชื่อนี้อยู่แล้ว — ไฟล์นี้สร้างใหม่เท่านั้น ห้ามรันทับ';
  END IF;

  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('complaints', 'municipality_id'), ('complaints', 'status'), ('complaints', 'created_at'),
    ('complaints', 'category'), ('complaints', 'village'),
    ('complaint_categories', 'municipality_id'), ('complaint_categories', 'value'), ('complaint_categories', 'label'),
    ('complaint_categories', 'is_adhoc'), ('complaint_categories', 'requires_manual_intake')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'exec_summary_complaint_spike: ไม่พบคอลัมน์ %', v_missing;
  END IF;
END $$;

CREATE FUNCTION public.exec_summary_complaint_spike(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today       date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_recent_from timestamptz;
  v_base_from   timestamptz;
  v_end         timestamptz;
  v_older       boolean;
  v_base_total  int;
  v_groups      jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);

  v_recent_from := (v_today - 6)::timestamp AT TIME ZONE 'Asia/Bangkok';
  v_base_from   := (v_today - 34)::timestamp AT TIME ZONE 'Asia/Bangkok';
  v_end         := (v_today + 1)::timestamp AT TIME ZONE 'Asia/Bangkok';

  -- ด่านข้อมูลพอ ① มีคำร้องเก่ากว่าช่วงฐาน (นับทุกสถานะ — แค่ดูว่าเคยใช้ระบบมาก่อน)
  SELECT EXISTS (
    SELECT 1 FROM public.complaints AS c
    WHERE c.municipality_id = _municipality_id AND c.created_at < v_base_from
  ) INTO v_older;

  IF v_older THEN
    WITH base AS (
      SELECT c.category, cat.label AS cat_label, c.created_at,
             -- ชื่อหมู่ใช้เฉพาะ 7 วันล่าสุด — ไม่เรียกฟังก์ชัน (มี SET จึงไม่ inline) กับทั้ง 35 วัน (รีวิว ข้อ 5)
             CASE WHEN c.created_at >= v_recent_from
                  THEN public.exec_village_label(c.municipality_id, c.village) END AS village
      FROM public.complaints AS c
      JOIN public.complaint_categories AS cat
        ON cat.municipality_id = c.municipality_id AND cat.value = c.category
      WHERE c.municipality_id = _municipality_id
        AND c.created_at >= v_base_from
        AND c.created_at <  v_end
        AND c.status <> 'rejected'
        AND NOT COALESCE(cat.is_adhoc, false)
        AND NOT COALESCE(cat.requires_manual_intake, false)
    ),
    per_cat AS (
      SELECT b.category, max(b.cat_label) AS label,
             count(*) FILTER (WHERE b.created_at >= v_recent_from)::int AS recent,
             count(*) FILTER (WHERE b.created_at <  v_recent_from)::int AS base
      FROM base AS b
      GROUP BY b.category
    ),
    spikes AS (
      SELECT p.category, p.label, p.recent, p.base
      FROM per_cat AS p
      WHERE p.recent >= 5 AND p.recent * 2 >= p.base
      ORDER BY p.recent DESC, p.category
      LIMIT 10
    ),
    village_counts AS (
      SELECT b.category, b.village, count(*)::int AS n
      FROM base AS b
      JOIN spikes AS s ON s.category = b.category
      WHERE b.created_at >= v_recent_from AND b.village <> ''
      GROUP BY b.category, b.village
    ),
    ranked AS (
      SELECT vc.category, vc.village, vc.n,
             row_number() OVER w AS rn, lead(vc.n) OVER w AS next_n
      FROM village_counts AS vc
      WINDOW w AS (PARTITION BY vc.category ORDER BY vc.n DESC, vc.village)
    ),
    top_village AS (
      SELECT r.category, r.village, r.n
      FROM ranked AS r
      WHERE r.rn = 1 AND r.n >= 2 AND r.n > COALESCE(r.next_n, 0)
    )
    SELECT (SELECT COALESCE(sum(p.base), 0)::int FROM per_cat AS p),
           COALESCE(jsonb_agg(jsonb_build_object(
             'category',  s.category,
             'label',     COALESCE(s.label, s.category),
             'recent',    s.recent,
             'base',      s.base,
             'village',   tv.village,
             'village_n', tv.n
           ) ORDER BY s.recent DESC, s.category), '[]'::jsonb)
      INTO v_base_total, v_groups
    FROM spikes AS s
    LEFT JOIN top_village AS tv ON tv.category = s.category;   -- aggregate ไม่มี GROUP BY = ได้ 1 แถวเสมอ (ไม่มีหมวดพุ่ง = '[]')
  END IF;

  -- ด่านข้อมูลพอ ② ช่วงฐานบาง (< 4 เรื่องที่นับได้ใน 28 วัน) = ไม่ตัดสิน และไม่คืนกลุ่ม
  IF NOT v_older OR COALESCE(v_base_total, 0) < 4 THEN
    RETURN jsonb_build_object('recent_days', 7, 'base_days', 28, 'min', 5, 'ratio', 2,
                              'insufficient_history', true, 'groups', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'recent_days', 7, 'base_days', 28, 'min', 5, 'ratio', 2,
    'insufficient_history', false,
    'groups', v_groups
  );
END;
$$;

-- ── สิทธิ์: เรียกผ่าน executive_overview() เท่านั้น ─────────────────────────────────────
-- Supabase แจก EXECUTE ให้ anon/authenticated อัตโนมัติกับฟังก์ชันใหม่ใน public (ข้อ 5 NOTES.md) — ถอนทั้งหมด
REVOKE ALL ON FUNCTION public.exec_summary_complaint_spike(uuid, date, date) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.exec_summary_complaint_spike(uuid, date, date) IS
  'ห้องผู้บริหาร: คำร้องหมวดที่ 7 วันล่าสุด ≥ 5 เรื่อง และ ≥ 2 เท่าของค่าเฉลี่ยต่อสัปดาห์ 28 วันก่อนหน้า · ตัวเลขรวม + หมู่บ้านในทะเบียน (≥ 2 เรื่อง ไม่เสมอ) เท่านั้น';

-- ด่านท้ายไฟล์: ตัวรวบเรียกเฉพาะฟังก์ชัน "เจ้าของเดียวกับตัวรวบ" — รันคนละ role กับไฟล์ E2 = การ์ดว่างเงียบ จึงล้มทั้งไฟล์
-- + ยืนยันว่า REVOKE ได้ผลจริง (authenticated/anon เรียกตรงไม่ได้)
DO $$
DECLARE
  v_fn oid := 'public.exec_summary_complaint_spike(uuid,date,date)'::regprocedure;
BEGIN
  IF (SELECT p.proowner FROM pg_proc AS p WHERE p.oid = v_fn)
     <> (SELECT o.proowner FROM pg_proc AS o WHERE o.oid = 'public.executive_overview(uuid,date,date,text[])'::regprocedure) THEN
    RAISE EXCEPTION 'exec_summary_complaint_spike: เจ้าของฟังก์ชันไม่ตรงกับ executive_overview';
  END IF;
  IF has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'exec_summary_complaint_spike: ถอนสิทธิ์ EXECUTE ของ anon/authenticated ไม่สำเร็จ';
  END IF;
END $$;

COMMIT;
