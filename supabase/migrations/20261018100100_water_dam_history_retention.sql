-- ฤดูแล้ง (เฟส 5 · PR 5.1) — เก็บค่าอ่างเก็บน้ำที่อยู่ในรัศมี 10 กม. ไว้ย้อนหลังนานขึ้น + ฟังก์ชันอ่านประวัติ
--
-- ทำไม: water_readings ลบทุกอย่างที่เก่ากว่า 7 วัน ค่าอ่างจึงมีย้อนหลังแค่ 6–7 วัน ดูแนวโน้มทั้งฤดูแล้งไม่ได้
-- และย้อนเก็บทีหลังไม่ได้ (ต้นทางส่งแต่ค่าล่าสุด) จึงต้องเริ่มเก็บก่อนฤดูแล้ง — เหตุผลเดียวกับตัวจดเหตุการณ์
--
-- ขอบเขต (เจ้าของระบบสั่ง 2569-10-18): "รัศมี 10 กม. เน้นต้นน้ำ ทางน้ำที่ไหลมาหาพื้นที่เรา"
--   · ระยะวัดจาก c.distance_km (เส้นตรงจากสำนักงาน ไม่ใช่ระยะตามลำน้ำ) · ไม่มีระยะ (NULL) = ไม่เก็บยาว
--   · เก็บเฉพาะอ่าง (station_type = 'dam') ซึ่งส่งรายวัน 1 วัน = 1 แถว → 400 วัน ≈ 400 แถวต่อสถานี (ไม่ถึง 1 MB ต่อปี)
--     ฝน/ระดับน้ำ/เตือนภัยยังลบที่ 7 วันเหมือนเดิม (รายชั่วโมง เก็บยาวแล้วโตเร็ว และยังไม่มีการใช้งาน)
--   · "ต้นน้ำ" คำนวณจากพิกัดไม่ได้ (พิกัดไม่บอกทิศน้ำไหล) — ฟังก์ชันนี้ส่งอ่างในรัศมีทั้งหมด การเลือกว่าอ่างไหนคือต้นน้ำ
--     ที่ยืนยันแล้วของ อปท. ไหนอยู่ที่ทะเบียนฝั่งหน้าเว็บ (PR 5.2) ไม่ใช่ที่นี่
--
-- ⚠️ CREATE OR REPLACE FUNCTION เขียนทับทั้งฟังก์ชัน — เทียบกับตัวที่ใช้งานจริงบน production แล้ว (2569-10-18) ตรงกับ
-- 20260919100300 ทุกบรรทัด: ลบ water_readings + water_warnings ที่ 7 วัน คืนผลรวมจำนวนแถวที่ลบ (integer)
-- ไฟล์นี้คงทุกอย่างนั้นไว้ เปลี่ยนเฉพาะเงื่อนไขลบของ water_readings
--
-- ผลข้างเคียงที่ตรวจแล้ว: get_public_water_situation นับ "ตัวเลขอ่างซ้ำเดิมกี่รายงาน" (dam_same_count) จากแถวอ่างที่เก็บไว้
-- ทั้งหมด → เก็บนานขึ้นทำให้นับได้เกิน 7 และ dam_same_capped จริงน้อยลง (ถูกต้องกว่าเดิม ความหมายไม่เปลี่ยน) ·
-- water-alert-notify / thaiwater-watchdog / ตัวจดเหตุการณ์ ดึงเป็นช่วงเวลาสั้น (3 วัน / ล่าสุด / 24 ชม.) ไม่กระทบ

DO $$
BEGIN
  IF to_regclass('public.water_readings') IS NULL OR to_regclass('public.water_station_config') IS NULL
     OR to_regclass('public.water_warnings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply migration ตาราง water_station_config / water_readings / water_warnings ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

-- ค่านโยบายที่ใช้ร่วมกันของ cleanup กับฟังก์ชันอ่าน — แก้ตรงนี้ที่เดียว (ห้ามเขียนเลข 10 / 400 ซ้ำในฟังก์ชันอื่น)
CREATE OR REPLACE FUNCTION public.water_dam_history_radius_km()
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT 10::numeric $$;

CREATE OR REPLACE FUNCTION public.water_dam_history_keep_days()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $$ SELECT 400 $$;

REVOKE ALL ON FUNCTION public.water_dam_history_radius_km() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.water_dam_history_keep_days() FROM PUBLIC, anon, authenticated;

-- คืนจำนวนแถวที่ลบรวมทั้งสองตาราง (ชนิดคืนค่าเดิม integer — cron เรียกแบบไม่อ่านค่า)
CREATE OR REPLACE FUNCTION public.cleanup_old_water_readings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted integer;
  deleted_warnings integer;
BEGIN
  -- อ่างในรัศมี → เก็บตามนโยบายยาว · ทุกอย่างอื่น (รวมอ่างที่ไม่มีระยะหรืออยู่นอกรัศมี) → 7 วันเหมือนเดิม
  -- CASE: WHEN เป็น NULL (ไม่มีระยะ) นับเป็น "ไม่เข้า" จึงตกไปที่ ELSE 7 วัน — ไม่ใช้ NOT (...) เพราะ NOT NULL = NULL
  -- จะทำให้แถวไม่ถูกลบเลย
  DELETE FROM public.water_readings AS r
  USING public.water_station_config AS c
  WHERE c.id = r.station_config_id
    AND CASE
          WHEN c.station_type = 'dam' AND c.distance_km <= public.water_dam_history_radius_km()
            THEN r.recorded_at < now() - make_interval(days => public.water_dam_history_keep_days())
          ELSE r.recorded_at < now() - interval '7 days'
        END;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  DELETE FROM public.water_warnings WHERE issued_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted_warnings = ROW_COUNT;
  RETURN deleted + deleted_warnings;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_water_readings() FROM PUBLIC, anon, authenticated;

-- ประวัติค่าอ่างของ อปท. หนึ่งแห่ง (หน้าสาธารณะ ไม่ต้องล็อกอิน) — บังคับระบุ อปท. เสมอ ส่ง NULL ได้ NULL
--   · เฉพาะอ่างที่เปิดใช้ (is_active) และอยู่ในรัศมีตามนโยบาย · เรียงใกล้→ไกล
--   · _days ครอบ 1..120 (ค่าเริ่มต้น 30) — หน้าสาธารณะไม่ต้องการมากกว่านี้ และกันคนยิง 400 วันซ้ำๆ ทำ egress บวม
--   · ค่าว่างไม่ถูกแปลงเป็น 0 (jsonb_strip_nulls: ช่องที่ไม่มีค่าไม่ปรากฏ) · แถวที่ยังไม่มีให้ readings = []
--   · หน่วยตามต้นทาง: ปริมาณเป็นล้าน ลบ.ม. · ไม่ส่งสถานะ/สี/ข้อความแปลความ (ฝั่งหน้าเว็บคำนวณจากกฎเดิม)
CREATE OR REPLACE FUNCTION public.get_public_dam_history(_municipality_id uuid, _days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'days', d.days,
    'radius_km', public.water_dam_history_radius_km(),
    'dams', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'station_code', c.station_code,
        'station_name', c.station_name,
        'tambon_name', c.tambon_name,
        'amphoe_name', c.amphoe_name,
        'distance_km', c.distance_km,
        'readings', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'recorded_at', r.recorded_at,
            'storage_percent', r.storage_percent,
            'storage_mcm', r.dam_storage_mcm,
            'capacity_mcm', r.dam_capacity_mcm,
            'inflow_mcm', r.dam_inflow_mcm,
            'released_mcm', r.dam_released_mcm
          ) ORDER BY r.recorded_at)
          FROM public.water_readings AS r
          WHERE r.station_config_id = c.id
            AND r.recorded_at >= now() - make_interval(days => d.days)
        ), '[]'::jsonb)
      )) ORDER BY c.distance_km, c.station_code)
      FROM public.water_station_config AS c
      WHERE c.municipality_id = m.id
        AND c.is_active
        AND c.station_type = 'dam'
        AND c.distance_km <= public.water_dam_history_radius_km()
    ), '[]'::jsonb)
  )
  FROM public.municipalities AS m
  CROSS JOIN LATERAL (
    SELECT LEAST(GREATEST(COALESCE(_days, 30), 1), 120) AS days
  ) AS d
  WHERE m.id = _municipality_id
    AND m.is_active = true;
$$;

COMMENT ON FUNCTION public.get_public_dam_history(uuid, integer) IS
  'ประวัติค่าอ่างเก็บน้ำ (ThaiWater/กรมชลประทาน รายวัน) ในรัศมีนโยบายของ อปท. หนึ่งแห่ง ย้อนหลัง 1–120 วัน — บังคับระบุ อปท. เสมอ ส่ง NULL ได้ NULL. ค่าว่างไม่ปรากฏ (ไม่เป็น 0)';

-- ถอนจาก anon/authenticated ให้ชัดก่อนแล้วค่อย GRANT — ค่าเริ่มต้นของ Supabase ให้ EXECUTE กับสองบทบาทนี้อัตโนมัติ
-- การให้สิทธิ์จึงต้องเป็นการตัดสินใจที่เห็นในไฟล์ (ไม่ใช่ผลของค่าเริ่มต้น)
REVOKE ALL ON FUNCTION public.get_public_dam_history(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_dam_history(uuid, integer) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
