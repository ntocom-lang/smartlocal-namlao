-- สถิติการเข้าชมเว็บไซต์ เฟส 2/2: ปิดสิทธิ์ตาราง + RPC
--
-- ── นิยามการนับ (เจ้าของระบบเลือก 2569-09-29: ยอดมากที่สุดเท่าที่ยังตรวจสอบย้อนได้) ─────────
-- opens นับทุกครั้งที่หน้าแสดงผล ทุกคนรวมเจ้าหน้าที่ ฝั่งเว็บ (src/lib/siteOpenCounter.js) เป็นคนตัด
-- สิ่งที่ไม่ใช่คนออกก่อนยิงมา: บอต/crawler, เบราว์เซอร์ที่สคริปต์คุม (E2E), localhost/dev
-- ห้ามเติมตัวเลขเริ่มต้น ตัวคูณ หรือนับสัญญาณพื้นหลังเป็นการเข้าชม — ตัวนับอยู่ในเมนูรายงานเดียวกับ
-- สถิติ e-Service ที่ อปท. ใช้เป็นหลักฐาน ITA ถ้าตัวเลขดูออกว่าปั่น หน้าอื่นหมดความน่าเชื่อถือไปด้วย
--
-- ── สิทธิ์ ──────────────────────────────────────────────────────────────────────────────
-- ตารางไม่มีใครแตะตรงได้: RLS เปิดโดยไม่มี policy + REVOKE (RLS ไม่กัน TRUNCATE — 20260905200000)
-- เขียน/อ่านผ่านฟังก์ชัน SECURITY DEFINER ข้างล่างเท่านั้น ตัวเลขที่คืนเป็นยอดรวมสาธารณะ
-- (ท้ายเว็บของทุก อปท. แสดงอยู่แล้ว) จึงให้ anon เรียกได้ทุกตัว
-- Supabase ตั้ง ALTER DEFAULT PRIVILEGES ให้ฟังก์ชันใหม่มี anon=X ติดมาเอง จึง REVOKE ก่อนแล้ว
-- GRANT กลับเฉพาะที่ตั้งใจ ไม่ปล่อยตามค่า default
--
-- ── กันยิงรัว ───────────────────────────────────────────────────────────────────────────
-- ใครมี anon key (อยู่ในบันเดิลของทุกเว็บ) ก็เรียก record_site_open ได้ จึงใช้ rpc_rate_limit_hit
-- (20260905170000 — ล็อกอินนับราย uid, ไม่ล็อกอินนับราย IP แบบปลอมไม่ได้, IP ลบเองหลัง ~1 วัน)
--   site_open    600 ครั้ง/ชม. — กันสคริปต์ยิงถล่ม DB เท่านั้น คนจริงต้องเปิดหน้าใหม่ทุก 6 วินาที
--                ติดกันทั้งชั่วโมงถึงจะชน ตั้งสูงเผื่อ CGNAT มือถือที่หลายคนใช้ IP เดียวกัน
--   site_visitor 50 เครื่องใหม่/วัน — ตัวรองเท่านั้น
-- เกินเพดาน = "ไม่นับเพิ่ม" แต่ยังคืนตัวเลขตามปกติ ไม่ raise — ผู้ใช้ไม่ควรเห็นอะไรผิดปกติ
-- เพราะแค่เปิดเว็บเยอะ และท้ายเว็บที่แสดงตัวเลขจะได้ไม่หายไปเฉยๆ
--
-- ── ชื่อฟังก์ชัน ────────────────────────────────────────────────────────────────────────
-- เลี่ยงคำ track / visit / analytics / pageview / beacon เพราะชื่อ RPC อยู่ใน URL
-- (/rest/v1/rpc/<ชื่อ>) และตัวบล็อกโฆษณาหลายตัวดักคำพวกนี้ โดนบล็อก = นับขาดเงียบๆ
-- (ความเห็นเชิงวิชาชีพ ยังไม่ได้ทดสอบกับ filter list จริง) ชื่อตารางไม่อยู่ใน URL จึงไม่ต้องเลี่ยง
--
-- ── วันที่ ──────────────────────────────────────────────────────────────────────────────
-- ตัดวันด้วย now() AT TIME ZONE 'Asia/Bangkok' ฝั่ง server เสมอ ไม่เชื่อนาฬิกาเครื่องผู้ใช้
-- ปีงบประมาณ = 1 ต.ค. – 30 ก.ย. (ตรงกับ src/lib/fiscalYear.js)

DO $$
BEGIN
  IF to_regclass('public.site_open_daily') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260930100000_site_open_daily_table.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regprocedure('public.rpc_rate_limit_hit(text, integer, interval)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ rpc_rate_limit_hit (20260905170000) — ต้องมีก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

REVOKE ALL ON public.site_open_daily FROM anon, authenticated, PUBLIC;
ALTER TABLE public.site_open_daily ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.site_open_daily IS
  'สถิติการเข้าชมเว็บไซต์รายวันต่อ อปท. (ยอดรวมเท่านั้น ไม่มีข้อมูลส่วนบุคคล): opens = การเข้าชม (ครั้ง) ตัวเลขหลัก, visitors = เครื่องไม่ซ้ำต่อวัน ตัวรอง';

-- ── ยอดสรุปสำหรับท้ายเว็บและการ์ดหน้ารายงาน ─────────────────────────────────────────────
-- คืนทั้ง 2 ตัวชี้วัดแบบคู่ขนาน หน้าเว็บแสดงเฉพาะ opens — visitors อยู่ในผลด้วยเพื่อให้เปิดแสดง
-- ทีหลังได้โดยไม่ต้องแก้ฟังก์ชันนี้ (CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน — NOTES.md ข้อ 5)
-- ยอดรวมทั้งหมด sum จากทุกแถวของ อปท. นั้น = 365 แถว/ปี ใช้ PK (municipality_id, visit_date)
CREATE OR REPLACE FUNCTION public.get_site_open_summary(_municipality_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    SELECT today,
           date_trunc('month', today::timestamp)::date AS month_start,
           -- ต.ค. ขึ้นไปคือปีงบถัดไปแล้ว ปีงบจึงเริ่ม 1 ต.ค. ของปีปฏิทินนี้ ไม่งั้นเริ่มของปีก่อน
           make_date(extract(year FROM today)::int
                       - CASE WHEN extract(month FROM today) >= 10 THEN 0 ELSE 1 END,
                     10, 1) AS fy_start
    FROM (SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date AS today) t
  ),
  s AS (
    SELECT visit_date, opens, visitors
    FROM site_open_daily
    WHERE municipality_id = _municipality_id
  )
  SELECT json_build_object(
    'as_of', d.today,
    -- วันแรกที่มีข้อมูล = วันที่เริ่มนับจริง (หน้ารายงานเขียนกำกับ "เริ่มนับเมื่อ ...")
    'since', min(s.visit_date),
    'opens', json_build_object(
      'today',            coalesce(sum(s.opens) FILTER (WHERE s.visit_date = d.today), 0),
      'yesterday',        coalesce(sum(s.opens) FILTER (WHERE s.visit_date = d.today - 1), 0),
      'this_month',       coalesce(sum(s.opens) FILTER (WHERE s.visit_date >= d.month_start), 0),
      'this_fiscal_year', coalesce(sum(s.opens) FILTER (WHERE s.visit_date >= d.fy_start), 0),
      'total',            coalesce(sum(s.opens), 0)
    ),
    'visitors', json_build_object(
      'today',            coalesce(sum(s.visitors) FILTER (WHERE s.visit_date = d.today), 0),
      'yesterday',        coalesce(sum(s.visitors) FILTER (WHERE s.visit_date = d.today - 1), 0),
      'this_month',       coalesce(sum(s.visitors) FILTER (WHERE s.visit_date >= d.month_start), 0),
      'this_fiscal_year', coalesce(sum(s.visitors) FILTER (WHERE s.visit_date >= d.fy_start), 0),
      'total',            coalesce(sum(s.visitors), 0)
    )
  )
  FROM d
  LEFT JOIN s ON true
  GROUP BY d.today, d.month_start, d.fy_start;
$$;

REVOKE ALL ON FUNCTION public.get_site_open_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_open_summary(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_site_open_summary(uuid) IS
  'ยอดสรุปการเข้าชมเว็บไซต์ (วันนี้/เมื่อวาน/เดือนนี้/ปีงบนี้/ทั้งหมด) ของ อปท. — ท้ายเว็บ + หน้า /reports/visitors';

-- ── นับ 1 การเข้าชม ─────────────────────────────────────────────────────────────────────
-- ฝั่งเว็บเรียกทุกครั้งที่หน้าแสดงผล (หลังหน่วง ~1 วินาทีกัน redirect นับซ้ำ)
-- _first_today = เครื่องนี้ยังไม่เคยถูกนับเป็น visitors ของวันนี้ (ฝั่งเว็บจำวันที่ไว้ใน localStorage)
-- คืนยอดสรุปล่าสุดทันที ท้ายเว็บจะได้ไม่ต้องยิง get_site_open_summary ซ้ำ
CREATE OR REPLACE FUNCTION public.record_site_open(_municipality_id uuid, _first_today boolean)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today   date    := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_visitor integer := 0;
BEGIN
  -- id ที่ไม่มีอยู่จริงคืน null เงียบๆ ไม่ปล่อยให้ชน FK แล้วกลายเป็น error 409 บนหน้าเว็บ
  IF _municipality_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM municipalities WHERE id = _municipality_id) THEN
    RETURN NULL;
  END IF;

  IF rpc_rate_limit_hit('site_open', 600, interval '1 hour') THEN
    -- เรียกเพดานตัวที่ 2 เฉพาะตอนเป็นเครื่องใหม่ของวัน ไม่งั้นทุกการเข้าชมจะไปกินโควตานี้ด้วย
    IF coalesce(_first_today, false)
       AND rpc_rate_limit_hit('site_visitor', 50, interval '1 day') THEN
      v_visitor := 1;
    END IF;

    INSERT INTO site_open_daily AS s (municipality_id, visit_date, opens, visitors)
    VALUES (_municipality_id, v_today, 1, v_visitor)
    ON CONFLICT (municipality_id, visit_date)
    DO UPDATE SET opens    = s.opens + 1,
                  visitors = s.visitors + excluded.visitors;
  END IF;

  RETURN get_site_open_summary(_municipality_id);
END;
$$;

REVOKE ALL ON FUNCTION public.record_site_open(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_site_open(uuid, boolean) TO anon, authenticated;

COMMENT ON FUNCTION public.record_site_open(uuid, boolean) IS
  'นับการเข้าชมเว็บไซต์ 1 ครั้ง (มีเพดานกันยิงรัว) แล้วคืนยอดสรุปล่าสุด — เรียกจาก src/lib/siteOpenCounter.js';

-- ── รายวัน (กราฟ 30 วันล่าสุด) ─────────────────────────────────────────────────────────
-- เติมวันที่ไม่มีแถวเป็น 0 ด้วย generate_series กราฟจะได้ไม่ลากเส้นข้ามวันที่ว่าง
-- ช่วงยาวสุด 366 วัน (ตัดจากต้นช่วง) — ต่ำกว่าเพดาน 1,000 แถวของ PostgREST ที่ตัดเงียบๆ (NOTES.md ข้อ 14)
-- cast เป็น timestamp ก่อนเข้า generate_series ให้ได้วันตรงตัว ไม่ขึ้นกับ TimeZone ของ session
CREATE OR REPLACE FUNCTION public.get_site_open_daily(_municipality_id uuid, _from date, _to date)
RETURNS TABLE (visit_date date, opens integer, visitors integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.day::date, coalesce(s.opens, 0), coalesce(s.visitors, 0)
  FROM generate_series(greatest(_from, _to - 365)::timestamp, _to::timestamp, interval '1 day') AS g(day)
  LEFT JOIN site_open_daily s
    ON s.municipality_id = _municipality_id
   AND s.visit_date = g.day::date
  WHERE _municipality_id IS NOT NULL
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.get_site_open_daily(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_open_daily(uuid, date, date) TO anon, authenticated;

COMMENT ON FUNCTION public.get_site_open_daily(uuid, date, date) IS
  'การเข้าชมเว็บไซต์รายวันในช่วงวันที่ (ไม่เกิน 366 วัน วันที่ไม่มีข้อมูลเป็น 0) — กราฟหน้า /reports/visitors';

-- ── รายเดือน (กราฟตามปีงบ / ทุกปีงบ) ──────────────────────────────────────────────────
-- คืนเฉพาะเดือนที่มีข้อมูล หน้าเว็บเติมเดือนที่ขาดเป็น 0 เอง · _from/_to เป็น null = ไม่จำกัดฝั่งนั้น
-- 12 แถว/ปี จึงไม่มีทางชนเพดาน 1,000 แถวของ PostgREST แม้ดู "ทุกปีงบ"
CREATE OR REPLACE FUNCTION public.get_site_open_monthly(_municipality_id uuid, _from date, _to date)
RETURNS TABLE (month_start date, opens bigint, visitors bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT date_trunc('month', s.visit_date::timestamp)::date, sum(s.opens), sum(s.visitors)
  FROM site_open_daily s
  WHERE s.municipality_id = _municipality_id
    AND (_from IS NULL OR s.visit_date >= _from)
    AND (_to   IS NULL OR s.visit_date <= _to)
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.get_site_open_monthly(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_open_monthly(uuid, date, date) TO anon, authenticated;

COMMENT ON FUNCTION public.get_site_open_monthly(uuid, date, date) IS
  'การเข้าชมเว็บไซต์รายเดือนในช่วงวันที่ (null = ไม่จำกัด) — กราฟรายเดือนตามปีงบของหน้า /reports/visitors';

COMMIT;
