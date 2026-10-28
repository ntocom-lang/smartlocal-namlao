-- สถิติรายหน้าของเว็บไซต์ เฟส 2/2: ปิดสิทธิ์ตาราง + ฟังก์ชันนับ/อ่านอันดับหน้า
--
-- ── สิ่งที่แก้ของเดิม ────────────────────────────────────────────────────────────────────
-- record_site_open เดิมมี 2 พารามิเตอร์ (20260930100100) ตอนนี้เพิ่มรุ่น 4 พารามิเตอร์ (+ ชื่อหน้า + เครื่องนี้เพิ่งเปิดหน้านี้
-- ครั้งแรกของวันไหม) และ "คงรุ่น 2 พารามิเตอร์ไว้" โดยให้เรียกรุ่นใหม่ด้วยชื่อหน้าว่าง — เหตุผล:
--   แอปบนมือถือ/แท็บที่ค้างเวอร์ชันเก่า (PWA แคชบันเดิลได้นานหลัง deploy) ยังเรียกรุ่น 2 พารามิเตอร์อยู่
--   ถ้าลบทิ้ง การเข้าชมจากเครื่องเหล่านั้นจะ error แล้วหายเงียบๆ = นับขาด
--   ห้ามใส่ DEFAULT ให้พารามิเตอร์ที่เพิ่ม: PostgREST เจอ 2 ฟังก์ชันชื่อเดียวกันที่ DEFAULT ทำให้เรียกกำกวมได้
--   แล้วตอบ "could not choose the best candidate function" ทั้งสองรุ่นพังพร้อมกัน — รุ่นละจำนวนพารามิเตอร์ตายตัวไม่ชนกัน
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน (NOTES.md ข้อ 5): รุ่น 2 พารามิเตอร์ถูกแทนด้วยตัวส่งต่อโดยตั้งใจ
--   เนื้อนับเดิมย้ายไปอยู่ในรุ่น 4 พารามิเตอร์ครบทุกบรรทัด (เพดาน 600/ชม. · 50 เครื่อง/วัน · คืน null เมื่อไม่มี อปท.)
--
-- ── ชื่อหน้า ────────────────────────────────────────────────────────────────────────────
-- รับเฉพาะรูปแบบ ^[a-z0-9][a-z0-9_-]{0,59}$ นอกนั้นนับเป็น 'other' (ไม่ error — ผู้ใช้ไม่ควรเห็นอะไรผิดปกติ)
-- ชื่อหน้าใหม่ได้ไม่เกิน 60 ชื่อ/อปท./วัน เกินนั้นรวมเป็น 'other' — ฝั่งเว็บส่งชื่อจากตารางตายตัวราว 40 ชื่อ
-- จึงไม่เคยชน แต่คนที่ยิงฟังก์ชันตรงด้วย anon key (อยู่ในบันเดิลทุกเว็บ) สร้างแถวใหม่ได้ไม่เกินเพดานนี้
-- ชื่อหน้าเป็นกลุ่มของหน้า ไม่ใช่ URL — ไม่มีโทเคน/รหัส/ไอดีใคร (ดู src/lib/siteOpenStats.js pageKeyForPath)
--
-- ── สิทธิ์ ──────────────────────────────────────────────────────────────────────────────
-- เหมือนตัวนับเดิม: ตาราง RLS เปิดไม่มี policy + REVOKE (RLS ไม่กัน TRUNCATE) เขียน/อ่านผ่านฟังก์ชัน SECURITY DEFINER
-- เท่านั้น · ALTER DEFAULT PRIVILEGES ของ Supabase ให้ anon=X ติดมากับฟังก์ชันใหม่ จึง REVOKE ก่อนแล้ว GRANT ตั้งใจ
-- ตัวเลขที่คืนเป็นยอดรวมสาธารณะ (หน้า /reports/visitors เปิดให้ทุกคนอยู่แล้ว) จึงให้ anon เรียกได้
-- เพดานกันยิงรัวของ "เครื่องเพิ่งเปิดหน้านี้" แยกบัคเก็ต site_page_visitor 400 ครั้ง/วัน/IP (คนหนึ่งเปิดไม่กี่สิบหน้า/วัน)
--
-- ชื่อฟังก์ชันอ่านอันดับหลีกคำ track/visit/analytics/pageview/beacon เหมือนเดิม (ชื่อ RPC อยู่ใน URL ตัวบล็อกโฆษณาดัก)

DO $$
BEGIN
  IF to_regclass('public.site_page_daily') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20261028100000_site_page_daily_table.sql ก่อนไฟล์นี้';
  END IF;
  IF to_regclass('public.site_open_daily') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ site_open_daily (20260930100000) — ต้องมีก่อนไฟล์นี้';
  END IF;
  IF to_regprocedure('public.record_site_open(uuid, boolean)') IS NULL
     OR to_regprocedure('public.get_site_open_summary(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ record_site_open/get_site_open_summary (20260930100100) — ต้องมีก่อนไฟล์นี้';
  END IF;
  IF to_regprocedure('public.rpc_rate_limit_hit(text, integer, interval)') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ rpc_rate_limit_hit (20260905170000) — ต้องมีก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

REVOKE ALL ON public.site_page_daily FROM anon, authenticated, PUBLIC;
ALTER TABLE public.site_page_daily ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.site_page_daily IS
  'สถิติรายหน้าของเว็บไซต์ รายวันต่อ อปท. (ยอดรวมเท่านั้น ไม่มีข้อมูลส่วนบุคคล): page_key = ชื่อกลุ่มของหน้า ไม่ใช่ URL, opens = ครั้งที่เปิด, visitors = เครื่องที่เปิดหน้านี้ครั้งแรกของวัน';

-- ── นับ 1 การเข้าชม พร้อมชื่อหน้า (รุ่นใหม่ 4 พารามิเตอร์) ──────────────────────────────────
-- _page_key        ชื่อกลุ่มของหน้าที่เปิด (ว่าง/รูปแบบผิด = 'other')
-- _first_page_today เครื่องนี้ยังไม่เคยเปิดหน้านี้วันนี้ (ฝั่งเว็บจำชื่อหน้าที่เปิดแล้วของวันไว้ใน localStorage)
-- ยอดรวมของวัน (site_open_daily) นับเหมือนเดิมทุกบรรทัด แล้วจึงเพิ่มแถวรายหน้า — ผ่านเพดาน 600/ชม. ตัวเดียวกัน
-- เกินเพดาน = ไม่นับทั้งยอดรวมและรายหน้า ผลรวมรายหน้าจึงไม่เกินยอดรวมของวัน
CREATE OR REPLACE FUNCTION public.record_site_open(
  _municipality_id  uuid,
  _first_today      boolean,
  _page_key         text,
  _first_page_today boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today        date    := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_visitor      integer := 0;
  v_page         text    := 'other';
  v_page_visitor integer := 0;
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

    -- ── รายหน้า ──
    IF _page_key IS NOT NULL AND _page_key ~ '^[a-z0-9][a-z0-9_-]{0,59}$' THEN
      v_page := _page_key;
    END IF;
    -- ชื่อใหม่ของวันนี้เกินเพดาน 60 ชื่อ → รวมเป็น 'other' (ชื่อที่มีแถวอยู่แล้วนับต่อได้เสมอ)
    IF v_page <> 'other'
       AND NOT EXISTS (SELECT 1 FROM site_page_daily
                       WHERE municipality_id = _municipality_id AND visit_date = v_today AND page_key = v_page)
       AND (SELECT count(*) FROM site_page_daily
            WHERE municipality_id = _municipality_id AND visit_date = v_today) >= 60 THEN
      v_page := 'other';
    END IF;

    IF coalesce(_first_page_today, false)
       AND rpc_rate_limit_hit('site_page_visitor', 400, interval '1 day') THEN
      v_page_visitor := 1;
    END IF;

    INSERT INTO site_page_daily AS p (municipality_id, visit_date, page_key, opens, visitors)
    VALUES (_municipality_id, v_today, v_page, 1, v_page_visitor)
    ON CONFLICT (municipality_id, visit_date, page_key)
    DO UPDATE SET opens    = p.opens + 1,
                  visitors = p.visitors + excluded.visitors;
  END IF;

  RETURN get_site_open_summary(_municipality_id);
END;
$$;

REVOKE ALL ON FUNCTION public.record_site_open(uuid, boolean, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_site_open(uuid, boolean, text, boolean) TO anon, authenticated;

COMMENT ON FUNCTION public.record_site_open(uuid, boolean, text, boolean) IS
  'นับการเข้าชมเว็บไซต์ 1 ครั้งพร้อมชื่อหน้า (มีเพดานกันยิงรัว) แล้วคืนยอดสรุปล่าสุด — เรียกจาก src/lib/siteOpenCounter.js';

-- ── รุ่นเดิม 2 พารามิเตอร์: ตัวส่งต่อสำหรับแอปเวอร์ชันเก่าที่ยังค้างอยู่ในเครื่องผู้ใช้ ──────────────
-- นับยอดรวมตามเดิม และลงรายหน้าเป็น 'other' (ไม่รู้ว่าเปิดหน้าไหน) ผลรวมรายหน้าจึงยังเท่ายอดรวม
CREATE OR REPLACE FUNCTION public.record_site_open(_municipality_id uuid, _first_today boolean)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.record_site_open(_municipality_id, _first_today, NULL::text, false);
$$;

REVOKE ALL ON FUNCTION public.record_site_open(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_site_open(uuid, boolean) TO anon, authenticated;

COMMENT ON FUNCTION public.record_site_open(uuid, boolean) IS
  'รุ่นเดิมก่อนมีสถิติรายหน้า — ส่งต่อไปรุ่น 4 พารามิเตอร์โดยไม่ระบุหน้า (สำหรับแอปเวอร์ชันเก่าที่ค้างอยู่)';

-- ── อันดับหน้า ───────────────────────────────────────────────────────────────────────────
-- คืน json เดียว: since = วันแรกที่มีข้อมูลรายหน้าของ อปท. (ใช้เขียนกำกับ "เริ่มนับรายหน้าเมื่อ ...")
-- rows = ผลรวมต่อชื่อหน้าในช่วงวันที่ เรียงมากไปน้อย (null = ไม่จำกัดฝั่งนั้น) ไม่เกิน 200 ชื่อ
-- — ต่ำกว่าเพดาน 1,000 แถวของ PostgREST ที่ตัดเงียบๆ (NOTES.md ข้อ 14) ชื่อจริงมีราว 40
-- visitors ในที่นี้คือผลรวมรายวัน: เครื่องเดียวที่กลับมาหลายวันนับทุกวัน (ไม่ใช่ "จำนวนเครื่องไม่ซ้ำทั้งช่วง")
CREATE OR REPLACE FUNCTION public.get_site_page_ranking(_municipality_id uuid, _from date, _to date)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH r AS (
    SELECT page_key, sum(opens)::bigint AS opens, sum(visitors)::bigint AS visitors
    FROM site_page_daily
    WHERE municipality_id = _municipality_id
      AND (_from IS NULL OR visit_date >= _from)
      AND (_to   IS NULL OR visit_date <= _to)
    GROUP BY page_key
    ORDER BY 2 DESC, 1
    LIMIT 200
  )
  SELECT json_build_object(
    'since', (SELECT min(visit_date) FROM site_page_daily WHERE municipality_id = _municipality_id),
    'rows',  coalesce((SELECT json_agg(json_build_object('page_key', page_key, 'opens', opens, 'visitors', visitors)
                                       ORDER BY opens DESC, page_key) FROM r), '[]'::json)
  );
$$;

REVOKE ALL ON FUNCTION public.get_site_page_ranking(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_site_page_ranking(uuid, date, date) TO anon, authenticated;

COMMENT ON FUNCTION public.get_site_page_ranking(uuid, date, date) IS
  'อันดับหน้าของเว็บไซต์ตามจำนวนครั้งที่เปิดในช่วงวันที่ (null = ไม่จำกัด) พร้อมวันแรกที่มีข้อมูล — ส่วนอันดับหน้าของ /reports/visitors';

COMMIT;
