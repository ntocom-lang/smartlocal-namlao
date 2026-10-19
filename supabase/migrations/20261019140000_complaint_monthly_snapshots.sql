-- 20261019140000_complaint_monthly_snapshots.sql
--
-- เฟส 2 ของสรุปเรื่องร้องเรียนรายเดือน (#497 #500 #502): "ล็อกตัวเลข" ของเดือนที่ปิดแล้ว
--
-- ปัญหา: ร้อยละแล้วเสร็จนับจากสถานะ "ปัจจุบัน" ของเรื่องที่รับในเดือนนั้น เรื่องที่ปิดทีหลังทำให้ตัวเลขของเดือนที่ผ่านไปแล้ว
-- ขยับได้ ภาพที่เผยแพร่ลง LINE/Facebook เมื่อต้นเดือนจึงอาจไม่ตรงกับหน้าเว็บที่คนเปิดดูทีหลัง (และหน้านี้เป็นหลักฐาน ITA)
--
-- วิธี (เจ้าของระบบอนุมัติ 2569-10-19): เจ้าหน้าที่เปิดหน้ารายเดือน ตรวจตัวเลขที่เห็น แล้วกด "ล็อกตัวเลขของเดือนนี้" ครั้งเดียว
--   → ฟังก์ชันนี้ "คำนวณใหม่ที่ฝั่งฐานข้อมูล ณ ตอนกด" แล้วเก็บเป็นชุดตัวเลขที่ล็อก (ไม่รับตัวเลขจากหน้าจอ จึงปลอมไม่ได้)
--   → หน้าเว็บ/ภาพ/ใบ A4 ของเดือนนั้นใช้ชุดที่ล็อกพร้อมบอกวันที่ล็อก · เดือนที่ไม่เคยล็อกยังแสดงตัวเลขสดเหมือนเดิม
-- ไม่มี "ฉบับร่างอัตโนมัติ" เพราะคำนวณตอนกดแล้ว สิ่งที่เจ้าหน้าที่เห็นบนจอก็คือสิ่งที่ถูกล็อก (ไม่มีตัวเลขที่ระบบเตรียมไว้
-- ต่างจากที่คนเห็นตอนยืนยัน) · การล็อกอัตโนมัติ (ไม่ต้องกด) เป็นเรื่องที่เจ้าของระบบจะตัดสินหลังใช้งานจริง 3 เดือน
--
-- ตัวเลขที่เก็บเป็น "ยอดรวมล้วน" (สถานะ · ยอดรายหมวด · ยอดรายลักษณะปัญหาของหมวดไฟฟ้า) ไม่มีข้อความดิบ/ชื่อ/เบอร์/ที่อยู่
-- ยอดรายลักษณะปัญหามาจาก complaint_issue_breakdown_fy ซึ่งกรองรายการอนุญาตที่ฐานข้อมูลอยู่แล้ว (#500)
--
-- ตาราง append-only: ล็อกใหม่ (แก้ตัวเลข) = เพิ่มแถว revision ใหม่ + ต้องระบุเหตุผล ไม่แก้/ไม่ลบแถวเดิม → ย้อนตรวจได้ทุกครั้ง
-- และเขียน audit_logs ทุกครั้งที่ล็อก · ผู้ใช้ทั่วไปเข้าตารางตรงๆ ไม่ได้ ต้องผ่านฟังก์ชันสองตัวด้านล่างเท่านั้น
--
-- เพิ่มตาราง + ฟังก์ชันใหม่อย่างเดียว ไม่แก้ฟังก์ชัน/ตารางเดิม
-- ย้อนได้ด้วย: DROP FUNCTION public.publish_complaint_monthly_snapshot(uuid, date, text);
--              DROP FUNCTION public.complaint_monthly_snapshot_get(uuid, date);
--              DROP TABLE public.complaint_monthly_snapshots;   (หน้าเว็บกลับไปใช้ตัวเลขสดเอง)

DO $$
BEGIN
  IF to_regprocedure('public.complaint_stats_fy(uuid,date,date)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ complaint_stats_fy — ต้อง apply 20260906100000_public_stats_fiscal_year_rpc.sql ก่อน';
  END IF;
  IF to_regprocedure('public.complaint_issue_breakdown_fy(uuid,text,date,date)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ complaint_issue_breakdown_fy — ต้อง apply 20261018140000_complaint_issue_breakdown_fy.sql ก่อน';
  END IF;
  IF to_regclass('public.audit_logs') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง audit_logs';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.complaint_monthly_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- วันที่ 1 ของเดือนที่ล็อก (ค.ศ.) — เดือนตามปฏิทินไทย
  period_month    date NOT NULL CHECK (EXTRACT(day FROM period_month) = 1),
  revision        integer NOT NULL CHECK (revision >= 1),
  -- complaint_stats_fy ของเดือนนั้น (total/open/in_progress/resolved/rejected/avg_days) ไม่มี this_month (ขึ้นกับวันที่เปิดดู)
  stats           jsonb NOT NULL,
  -- [{category, total}] มาก→น้อย — ยอดรวมต้องเท่า stats.total
  categories      jsonb NOT NULL,
  -- [{category, rows:[{issue_label, total}]}] เฉพาะหมวดที่มีรายการอนุญาต (ตอนนี้ light) · ว่างได้
  issue_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- เหตุผลที่ล็อกใหม่ (revision ≥ 2 บังคับ)
  note            text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  published_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT complaint_monthly_snapshots_unique UNIQUE (municipality_id, period_month, revision)
);

ALTER TABLE public.complaint_monthly_snapshots ENABLE ROW LEVEL SECURITY;

-- ไม่มี policy ให้ใครเลย (anon/authenticated อ่านตรงๆ ไม่ได้ — published_by เป็นรหัสผู้ใช้ ไม่ควรออกสาธารณะ)
-- อ่าน/เขียนผ่านฟังก์ชัน SECURITY DEFINER สองตัวเท่านั้น
-- ⚠️ REVOKE ALL จาก authenticated ด้วย: default privileges ของ Supabase ให้ ALL (รวม TRUNCATE ที่ RLS ไม่กัน) ดู docs/ai/NOTES.md
REVOKE ALL ON TABLE public.complaint_monthly_snapshots FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.complaint_monthly_snapshots IS
  'ตัวเลขสรุปเรื่องร้องเรียนรายเดือนที่เจ้าหน้าที่ล็อกแล้ว (append-only ตาม revision) — ใช้แทนตัวเลขสดของเดือนที่ปิดแล้ว เขียนผ่าน publish_complaint_monthly_snapshot เท่านั้น';

-- ── อ่านชุดที่ล็อกล่าสุดของเดือนนั้น (สาธารณะ — หน้า /reports/complaints) ──────────────────────
-- คืน NULL เมื่อเดือนนั้นยังไม่เคยล็อก (หน้าเว็บใช้ตัวเลขสดตามเดิม) · ไม่คืน published_by
CREATE OR REPLACE FUNCTION public.complaint_monthly_snapshot_get(
  _municipality_id uuid,
  _period_month    date
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF _municipality_id IS NULL OR _period_month IS NULL OR EXTRACT(day FROM _period_month) <> 1 THEN
    RETURN NULL;
  END IF;
  RETURN (
    SELECT json_build_object(
      'revision',        s.revision,
      'published_at',    s.published_at,
      'stats',           s.stats,
      'categories',      s.categories,
      'issue_breakdown', s.issue_breakdown
    )
    FROM public.complaint_monthly_snapshots s
    WHERE s.municipality_id = _municipality_id
      AND s.period_month = _period_month
    ORDER BY s.revision DESC
    LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complaint_monthly_snapshot_get(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complaint_monthly_snapshot_get(uuid, date) TO anon, authenticated;

COMMENT ON FUNCTION public.complaint_monthly_snapshot_get(uuid, date) IS
  'ชุดตัวเลขสรุปเรื่องร้องเรียนรายเดือนที่ล็อกล่าสุด (NULL = ยังไม่เคยล็อก) สำหรับหน้ารายงานสาธารณะ';

-- ── ล็อกตัวเลขของเดือนที่ปิดแล้ว (เจ้าหน้าที่กดครั้งเดียว) ─────────────────────────────────────
-- สิทธิ์: superadmin ทุก อปท. · admin/officer/staff ของ อปท. นั้น (ไม่รวม viewer/council/technician/ประชาชน)
-- เดือนที่ล็อกได้: เดือนที่ "จบแล้ว" ตามเวลาไทย และไม่เก่ากว่า 24 เดือน (เท่าตัวเลือกเดือนของหน้ารายงาน)
-- ล็อกซ้ำ: ตัวเลขที่คำนวณใหม่ "เท่าเดิม" = ไม่เพิ่มแถว (กดซ้ำ/กดสองแท็บไม่ทำให้ประวัติรก) · ต่างจากเดิม = ต้องระบุเหตุผล
CREATE OR REPLACE FUNCTION public.publish_complaint_monthly_snapshot(
  _municipality_id uuid,
  _period_month    date,
  _note            text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- ประเภทของหมวดที่มีรายการย่อย ต้องตรงกับ ISSUE_BREAKDOWN_CATEGORY ใน src/pages/ComplaintStats.jsx
  -- และรายการอนุญาตใน complaint_issue_breakdown_fy (หมวดอื่นฟังก์ชันนั้นคืนว่างเสมอ)
  c_breakdown_category constant text := 'light';
  v_role         text;
  v_actor_muni   uuid;
  v_current      date;
  v_from         date;
  v_to           date;
  v_from_ts      timestamptz;
  v_to_ts        timestamptz;
  v_stats        jsonb;
  v_categories   jsonb;
  v_breakdown    jsonb;
  v_light_rows   jsonb;
  v_cat_total    bigint;
  v_light_total  bigint;
  v_light_sum    bigint;
  v_prev         public.complaint_monthly_snapshots;
  v_revision     integer;
  v_note         text;
  v_id           uuid;
  v_published_at timestamptz;
  v_actor        record;
  v_attempt      integer;
  v_consistent   boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;
  IF _municipality_id IS NULL OR _period_month IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุหน่วยงานและเดือน' USING ERRCODE = '22023';
  END IF;

  v_role := public.get_my_role();
  v_actor_muni := public.get_my_municipality_id();
  IF NOT (
    v_role = 'superadmin'
    OR (v_actor_muni IS NOT NULL AND v_actor_muni = _municipality_id AND v_role IN ('admin', 'officer', 'staff'))
  ) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ล็อกตัวเลขสรุปของหน่วยงานนี้' USING ERRCODE = '42501';
  END IF;

  -- เดือนปัจจุบันตามเวลาไทย (timestamp ไม่มีโซน → date ไม่ขึ้นกับ timezone ของ session)
  v_current := date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date;
  IF EXTRACT(day FROM _period_month) <> 1 THEN
    RAISE EXCEPTION 'เดือนต้องเป็นวันที่ 1 ของเดือน' USING ERRCODE = '22023';
  END IF;
  IF _period_month >= v_current THEN
    RAISE EXCEPTION 'ล็อกได้เฉพาะเดือนที่สิ้นสุดแล้ว (เดือนนี้ตัวเลขยังขยับอยู่)' USING ERRCODE = '22023';
  END IF;
  IF _period_month < (v_current - interval '24 months')::date THEN
    RAISE EXCEPTION 'ย้อนล็อกได้ไม่เกิน 24 เดือน' USING ERRCODE = '22023';
  END IF;

  -- กันกดซ้ำพร้อมกัน (สองแท็บ/ดับเบิลคลิก) ให้เรียงทีละคำสั่งต่อเดือนต่อ อปท.
  PERFORM pg_advisory_xact_lock(hashtextextended('complaint_monthly_snapshot:' || _municipality_id::text || ':' || _period_month::text, 0));

  v_from    := _period_month;
  v_to      := (_period_month + interval '1 month' - interval '1 day')::date;
  -- ขอบเขตเวลาไทยแบบเดียวกับ complaint_stats_fy (เทียบเป็น timestamptz เพื่อให้ index บน created_at ใช้ได้)
  v_from_ts := (v_from::timestamp) AT TIME ZONE 'Asia/Bangkok';
  v_to_ts   := ((v_to + 1)::timestamp) AT TIME ZONE 'Asia/Bangkok';

  -- คำนวณหลายคำสั่ง: แต่ละคำสั่งอ่านฐานข้อมูลคนละจังหวะ (READ COMMITTED) ถ้ามีเรื่องเข้ามาคั่นระหว่างทาง
  -- ยอดรวมกับยอดรายหมวดจะไม่เท่ากัน → คำนวณใหม่ (สูงสุด 3 รอบ) ไม่ยอมเก็บชุดที่ตัวเลขขัดกันเอง
  FOR v_attempt IN 1..3 LOOP
    v_stats := public.complaint_stats_fy(_municipality_id, v_from, v_to)::jsonb - 'this_month';

    SELECT COALESCE(jsonb_agg(jsonb_build_object('category', k.category, 'total', k.total)
                              ORDER BY k.total DESC, k.category), '[]'::jsonb),
           COALESCE(sum(k.total), 0)
      INTO v_categories, v_cat_total
      FROM (
        SELECT c.category, count(*)::bigint AS total
        FROM public.complaints c
        WHERE c.municipality_id = _municipality_id
          AND c.created_at >= v_from_ts
          AND c.created_at <  v_to_ts
        GROUP BY c.category
      ) k;

    -- WITH ORDINALITY: คงลำดับที่ฟังก์ชันเรียงให้แล้ว (มาก→น้อย "ไม่ระบุ" ท้ายสุด) ไม่ให้ aggregate สลับลำดับ
    SELECT COALESCE(jsonb_agg(jsonb_build_object('issue_label', b.issue_label, 'total', b.total) ORDER BY b.ord), '[]'::jsonb),
           COALESCE(sum(b.total), 0)
      INTO v_light_rows, v_light_sum
      FROM public.complaint_issue_breakdown_fy(_municipality_id, c_breakdown_category, v_from, v_to) WITH ORDINALITY AS b(issue_label, total, ord);

    SELECT COALESCE(sum((e->>'total')::bigint), 0) INTO v_light_total
      FROM jsonb_array_elements(v_categories) e WHERE e->>'category' = c_breakdown_category;

    IF (v_stats->>'total')::bigint = v_cat_total AND v_light_sum = v_light_total THEN
      v_consistent := true;
      EXIT;
    END IF;
  END LOOP;
  IF NOT v_consistent THEN
    RAISE EXCEPTION 'ข้อมูลเรื่องร้องเรียนกำลังเปลี่ยนระหว่างคำนวณ กรุณากดอีกครั้ง' USING ERRCODE = '40001';
  END IF;

  v_breakdown := CASE
    WHEN jsonb_array_length(v_light_rows) > 0
      THEN jsonb_build_array(jsonb_build_object('category', c_breakdown_category, 'rows', v_light_rows))
    ELSE '[]'::jsonb
  END;

  SELECT * INTO v_prev
    FROM public.complaint_monthly_snapshots s
    WHERE s.municipality_id = _municipality_id AND s.period_month = _period_month
    ORDER BY s.revision DESC
    LIMIT 1;

  IF FOUND THEN
    -- เท่าเดิมทุกตัว = ไม่มีอะไรให้ล็อกใหม่ คืนชุดเดิม (ไม่เพิ่มแถว ไม่เขียน audit ซ้ำ)
    IF v_prev.stats = v_stats AND v_prev.categories = v_categories AND v_prev.issue_breakdown = v_breakdown THEN
      RETURN json_build_object(
        'unchanged', true, 'revision', v_prev.revision, 'published_at', v_prev.published_at,
        'stats', v_prev.stats, 'categories', v_prev.categories, 'issue_breakdown', v_prev.issue_breakdown
      );
    END IF;
    v_note := NULLIF(btrim(COALESCE(_note, '')), '');
    IF v_note IS NULL THEN
      RAISE EXCEPTION 'เดือนนี้ล็อกไว้แล้ว และตัวเลขตอนนี้ต่างจากที่ล็อก — ต้องระบุเหตุผลที่ล็อกใหม่' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_note) > 500 THEN
      RAISE EXCEPTION 'เหตุผลยาวเกิน 500 ตัวอักษร' USING ERRCODE = '22023';
    END IF;
    v_revision := v_prev.revision + 1;
  ELSE
    -- ล็อกครั้งแรกไม่ต้องมีเหตุผล · ถ้าใส่มาก็เก็บไว้
    v_note := NULLIF(btrim(COALESCE(_note, '')), '');
    IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
      RAISE EXCEPTION 'เหตุผลยาวเกิน 500 ตัวอักษร' USING ERRCODE = '22023';
    END IF;
    v_revision := 1;
  END IF;

  INSERT INTO public.complaint_monthly_snapshots
    (municipality_id, period_month, revision, stats, categories, issue_breakdown, note, published_by)
  VALUES
    (_municipality_id, _period_month, v_revision, v_stats, v_categories, v_breakdown, v_note, auth.uid())
  RETURNING id, published_at INTO v_id, v_published_at;

  -- บันทึกร่องรอยฝั่งเซิร์ฟเวอร์ (หน้าจอข้ามไม่ได้) · metadata มีแต่เดือน/รอบ/ยอดรวม/เหตุผล ไม่มีข้อมูลบุคคล
  SELECT p.full_name, p.role INTO v_actor FROM public.profiles p WHERE p.id = auth.uid();
  INSERT INTO public.audit_logs
    (municipality_id, actor_id, actor_name, actor_role, action, resource_type, resource_id, resource_label, metadata)
  VALUES
    (_municipality_id, auth.uid(), v_actor.full_name, COALESCE(v_actor.role, v_role),
     CASE WHEN v_revision = 1 THEN 'publish' ELSE 'republish' END,
     'complaint_monthly_snapshot', v_id::text,
     'สรุปเรื่องร้องเรียน ' || (EXTRACT(year FROM _period_month)::int + 543)::text || '-' || lpad(EXTRACT(month FROM _period_month)::int::text, 2, '0'),
     jsonb_build_object('period_month', _period_month, 'revision', v_revision,
                        'total', (v_stats->>'total')::bigint, 'note', v_note));

  RETURN json_build_object(
    'unchanged', false, 'revision', v_revision, 'published_at', v_published_at,
    'stats', v_stats, 'categories', v_categories, 'issue_breakdown', v_breakdown
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_complaint_monthly_snapshot(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_complaint_monthly_snapshot(uuid, date, text) TO authenticated;

COMMENT ON FUNCTION public.publish_complaint_monthly_snapshot(uuid, date, text) IS
  'ล็อกตัวเลขสรุปเรื่องร้องเรียนของเดือนที่ปิดแล้ว — คำนวณใหม่ฝั่งฐานข้อมูลตอนกด (ไม่รับตัวเลขจากหน้าจอ) เก็บเป็น revision ใหม่ + audit_logs · admin/officer/staff ของ อปท. นั้น หรือ superadmin';
