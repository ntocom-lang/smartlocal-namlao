-- สถานการณ์น้ำ-ฝน เฟส 3/6 — สิทธิ์ตาราง + RLS + RPC ฝั่งประชาชน + ตัวลบข้อมูลเก่า
-- (ตารางสร้างไว้แล้วใน 20260918150000 และ 20260918150100 ไฟล์นี้จึงอ้างถึงได้)
--
-- ใครอ่าน/เขียนได้:
--   - เขียน: Edge Function thaiwater-sync ด้วย service_role เท่านั้น (ข้าม RLS อยู่แล้ว)
--   - อ่าน: ทุกคน (รวมผู้ไม่ล็อกอิน) ผ่าน get_public_water_situation() เท่านั้น
--   - แก้รายชื่อสถานี: ผ่าน migration/SQL ของ superadmin — ยังไม่มีหน้าจอให้แก้ จึงไม่เปิดสิทธิ์เขียน
--     ให้ role ไหนเลย (ถ้าทำหน้าจอตั้งค่าทีหลัง ค่อยเพิ่ม policy พร้อมหน้าจอนั้น)
-- ตารางทั้งสองจึงเปิด RLS ไว้โดยไม่มี policy และถอนสิทธิ์ของ anon/authenticated ออกหมด
--
-- RPC บังคับให้ระบุ อปท. ทุกครั้ง เหตุผลเดียวกับ get_public_waste_schedule:
-- RLS ไม่รู้ว่าผู้ไม่ล็อกอินเปิดเว็บของ อปท. ไหน ส่ง NULL ได้ NULL ไม่ใช่ข้อมูลทุกแห่ง

DO $$
BEGIN
  IF to_regclass('public.water_station_config') IS NULL
     OR to_regclass('public.water_readings') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260918150000 และ 20260918150100 ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

-- ===========================================================================
-- สิทธิ์ระดับตาราง — ALTER DEFAULT PRIVILEGES ของ Supabase ให้ anon/authenticated ได้ ALL
-- กับตารางใหม่ และ RLS ไม่บังคับกับ TRUNCATE ต้องถอนเองทุกครั้ง (ดู 20260905200000)
-- ===========================================================================
REVOKE ALL ON public.water_station_config, public.water_readings FROM anon, authenticated, PUBLIC;

ALTER TABLE public.water_station_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_readings       ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- RPC ฝั่งประชาชน — ข้อมูลสาธารณะจากสถานีตรวจวัด ไม่มีข้อมูลส่วนบุคคล
--
-- คืนสถานีที่ตั้งค่าไว้ "ทุกตัว" แม้ยังไม่มีค่าวัด (LEFT JOIN) — สถานีที่หยุดส่งข้อมูลต้องโชว์ว่า
-- "ไม่มีข้อมูลล่าสุด" ให้เห็น ไม่ใช่หายไปเงียบๆ จนคนเข้าใจว่าพื้นที่นั้นไม่มีสถานี
--
-- synced_at = ครั้งล่าสุดที่ระบบดึงข้อมูลของ อปท. นี้ได้ — ถ้าต้นทางปิดกั้นหรือ Edge Function พัง
-- ค่านี้จะหยุดเดิน หน้าเว็บใช้เตือนว่าข้อมูลไม่เป็นปัจจุบัน
--
-- prev_* = ค่าระดับน้ำก่อนหน้าราว 1 ชั่วโมง (เก่ากว่าค่าล่าสุด 50 นาที–3 ชั่วโมง) จากที่ระบบเก็บเอง
-- ไม่ใช้ waterlevel_msl_previous ของต้นทาง เพราะช่วงห่างไม่เท่ากันแต่ละหน่วยงาน
-- (สถานี สสน. ส่งทุก 10 นาที ต่างจาก ชป. ที่ส่งรายชั่วโมง — เทียบ 10 นาทีจะดูเหมือนน้ำนิ่งตลอด)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.get_public_water_situation(_municipality_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'synced_at', (
      SELECT max(r.fetched_at)
      FROM public.water_readings AS r
      JOIN public.water_station_config AS c ON c.id = r.station_config_id
      WHERE c.municipality_id = m.id AND c.is_active
    ),
    'stations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'station_type', c.station_type,
        'station_code', c.station_code,
        'station_name', c.station_name,
        'tambon_name', c.tambon_name,
        'amphoe_name', c.amphoe_name,
        'province_name', c.province_name,
        'river_name', c.river_name,
        'agency_name', c.agency_name,
        'latitude', c.latitude,
        'longitude', c.longitude,
        'distance_km', c.distance_km,
        'is_primary', c.is_primary,
        'note', c.note,
        'recorded_at', l.recorded_at,
        'rain_24h_mm', l.rain_24h_mm,
        'rain_1h_mm', l.rain_1h_mm,
        'waterlevel_msl', l.waterlevel_msl,
        'bank_diff_m', l.bank_diff_m,
        'storage_percent', l.storage_percent,
        'situation_level', l.situation_level,
        'situation_text', l.situation_text,
        'situation_color', l.situation_color,
        'prev_recorded_at', p.recorded_at,
        'prev_waterlevel_msl', p.waterlevel_msl
      ) ORDER BY c.station_type, c.display_order, c.distance_km NULLS LAST, c.station_name)
      FROM public.water_station_config AS c
      LEFT JOIN LATERAL (
        SELECT r.*
        FROM public.water_readings AS r
        WHERE r.station_config_id = c.id
        ORDER BY r.recorded_at DESC
        LIMIT 1
      ) AS l ON true
      LEFT JOIN LATERAL (
        SELECT r.recorded_at, r.waterlevel_msl
        FROM public.water_readings AS r
        WHERE c.station_type = 'waterlevel'
          AND r.station_config_id = c.id
          AND r.recorded_at <= l.recorded_at - interval '50 minutes'
          AND r.recorded_at >= l.recorded_at - interval '3 hours'
        ORDER BY r.recorded_at DESC
        LIMIT 1
      ) AS p ON true
      WHERE c.municipality_id = m.id
        AND c.is_active
    ), '[]'::jsonb)
  )
  FROM public.municipalities AS m
  WHERE m.id = _municipality_id
    AND m.is_active = true;
$$;

REVOKE ALL ON FUNCTION public.get_public_water_situation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_water_situation(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_water_situation(uuid) IS
  'สถานการณ์น้ำ-ฝนฝั่งประชาชน — บังคับระบุ อปท. เสมอ ส่ง NULL ได้ NULL. ข้อมูลจาก ThaiWater (สสน.) ที่ thaiwater-sync ดึงมาเก็บทุกชั่วโมง';

-- ===========================================================================
-- ลบค่าที่เก่ากว่า 7 วัน — เรียกจาก pg_cron วันละครั้ง (20260918150500) ไม่ต้องมีใครกด
-- SQL ล้วน ไม่ผ่าน Edge Function จึงไม่กินโควตา invocation
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_water_readings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.water_readings WHERE recorded_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_water_readings() FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- ประทับเวลาแก้ไขรายชื่อสถานี
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.touch_water_station_config()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at      := OLD.created_at;
    NEW.municipality_id := OLD.municipality_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_water_station_config() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS touch_water_station_config ON public.water_station_config;
CREATE TRIGGER touch_water_station_config
  BEFORE INSERT OR UPDATE ON public.water_station_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_water_station_config();

NOTIFY pgrst, 'reload schema';

COMMIT;
