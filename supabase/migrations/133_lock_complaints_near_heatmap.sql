-- 133_lock_complaints_near_heatmap.sql
-- ปัญหา: complaints_near / complaints_heatmap (055) เป็น SECURITY DEFINER แต่ไม่เคย
-- REVOKE EXECUTE FROM PUBLIC มาก่อน — Postgres default คือ PUBLIC เรียกได้ทันที
-- (รวม anon) และฟังก์ชันไม่บังคับ municipality ของผู้เรียก ทำให้:
--   - complaints_near ไม่ใส่ _municipality_id -> เห็นคำร้องทุกเทศบาลในรัศมี
--   - complaints_heatmap ใส่ municipality_id ของเทศบาลอื่น (หาได้จากตาราง public
--     municipalities) -> เห็น heatmap เทศบาลอื่น
-- แก้: จำกัดเฉพาะ authenticated ที่เป็นเจ้าหน้าที่ และบังคับ municipality ตัวเอง
-- (ยกเว้น superadmin)

DROP FUNCTION IF EXISTS complaints_near(double precision, double precision, double precision, uuid);

CREATE OR REPLACE FUNCTION complaints_near(
  _lat      double precision,
  _lng      double precision,
  _radius_m double precision default 1000,
  _municipality_id uuid default null
)
RETURNS TABLE (
  id            uuid,
  ref_no        text,
  subject       text,
  status        text,
  category      text,
  latitude      double precision,
  longitude     double precision,
  distance_m    double precision,
  created_at    timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE
  v_muni uuid;
BEGIN
  IF get_my_role() NOT IN ('superadmin', 'admin', 'officer', 'staff', 'technician', 'viewer', 'council') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF get_my_role() = 'superadmin' THEN
    v_muni := _municipality_id; -- superadmin ระบุเทศบาลไหนก็ได้ (หรือ null = ทั้งหมด)
  ELSE
    v_muni := get_my_municipality_id(); -- staff อื่น: บังคับเทศบาลตัวเองเสมอ ไม่สนใจ input
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.ref_no, c.subject, c.status, c.category,
    c.latitude, c.longitude,
    ST_Distance(c.location, ST_MakePoint(_lng, _lat)::geography) as distance_m,
    c.created_at
  FROM complaints c
  WHERE c.location IS NOT NULL
    AND ST_DWithin(c.location, ST_MakePoint(_lng, _lat)::geography, _radius_m)
    AND (v_muni IS NULL OR c.municipality_id = v_muni)
  ORDER BY distance_m;
END;
$$;

REVOKE EXECUTE ON FUNCTION complaints_near(double precision, double precision, double precision, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION complaints_near(double precision, double precision, double precision, uuid) TO authenticated;


DROP FUNCTION IF EXISTS complaints_heatmap(uuid, int);

CREATE OR REPLACE FUNCTION complaints_heatmap(
  _municipality_id uuid,
  _precision int default 4
)
RETURNS TABLE (
  lat    double precision,
  lng    double precision,
  count  bigint
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF get_my_role() NOT IN ('superadmin', 'admin', 'officer', 'staff', 'technician', 'viewer', 'council') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF get_my_role() <> 'superadmin' AND get_my_municipality_id() IS DISTINCT FROM _municipality_id THEN
    RAISE EXCEPTION 'Permission denied: municipality mismatch';
  END IF;

  RETURN QUERY
  SELECT
    avg(c.latitude)  as lat,
    avg(c.longitude) as lng,
    count(*)         as count
  FROM complaints c
  WHERE c.municipality_id = _municipality_id
    AND c.location IS NOT NULL
  GROUP BY
    round(c.latitude::numeric,  _precision - 1),
    round(c.longitude::numeric, _precision - 1)
  ORDER BY count DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION complaints_heatmap(uuid, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION complaints_heatmap(uuid, int) TO authenticated;
