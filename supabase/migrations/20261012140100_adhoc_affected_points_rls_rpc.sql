-- ผู้ได้รับผลกระทบรอบจุดต้นทางเรื่องเฉพาะกิจ (เฟส 2) ภาค 2: RLS ปิดตาย + สิทธิ์ + ฟังก์ชันอ่าน/เขียน/ลบ
-- ตารางสร้างไว้ใน 20261012140000 (แยกไฟล์ตามเฟส ดู docs/ai/NOTES.md ข้อ 3)
--
-- ใครทำอะไรได้ (เจ้าของระบบตัดสิน 2569-10-12 · ผู้บริหารไม่รวม — ที่เจ้าของตอบ "ผู้บริหารเห็นทั้งหมด" ตอบเรื่องจุดต้นทาง+วงรัศมี
-- ไม่ได้ตอบเรื่องพิกัดบุคคล ใช้ค่าที่เข้มกว่าไว้ก่อน):
--   ดู/เพิ่ม/แก้/ลบ : superadmin · admin · "ผู้รับผิดชอบ" ของ อปท. เดียวกัน (ใช้ can_manage_adhoc_overlay ตัวเดียวกับจุดต้นทาง)
--   ผู้บริหาร/สภา/เจ้าหน้าที่ทั่วไป/ประชาชน/anon : ไม่เห็นเลย
--
-- ⚠️ นี่คือพิกัดบุคคล จึงไม่ให้ใคร (แม้แต่ผู้รับผิดชอบ) อ่านตารางตรงๆ — ตารางไม่มี policy และเพิกถอนสิทธิ์ทุก role
-- ทางเข้าเดียวคือฟังก์ชัน SECURITY DEFINER ด้านล่าง เพื่อให้ audit log บังคับได้ที่ต้นทาง หน้าจอข้ามไม่ได้
--   - ดู   → adhoc_affected_list()   บันทึก audit 1 แถวต่อการดึงหนึ่งครั้ง (นับจำนวน ไม่เก็บพิกัด)
--   - เพิ่ม/แก้ → adhoc_affected_save()  บันทึก audit create/update (ไม่เก็บพิกัด ไม่เก็บเนื้อหาหมายเหตุ)
--   - ลบ   → adhoc_affected_delete() บันทึก audit delete
-- ต้นทางไม่ได้เก็บ "ใครคือผู้ได้รับผลกระทบ" เลย (ไม่มีชื่อ/เบอร์) audit จึงไม่มีทางรั่วตัวตนด้วย

CREATE INDEX IF NOT EXISTS adhoc_affected_points_zone_idx ON public.adhoc_affected_points (zone_id);
CREATE INDEX IF NOT EXISTS adhoc_affected_points_muni_idx ON public.adhoc_affected_points (municipality_id);

ALTER TABLE public.adhoc_affected_points ENABLE ROW LEVEL SECURITY;

-- ไม่สร้าง policy ใดเลย = ปฏิเสธทุก role ที่ไม่ใช่เจ้าของตาราง (ฟังก์ชัน SECURITY DEFINER ด้านล่างรันเป็นเจ้าของ จึงผ่าน)
-- ⚠️ REVOKE จาก authenticated ด้วย ไม่ใช่แค่ anon: default privileges ของ Supabase ให้ ALL (รวม TRUNCATE ที่ RLS ไม่กัน)
-- บทเรียนจากตาราง adhoc_impact_zones (ตรวจพบตอน apply จริง) — ตรวจ has_table_privilege หลัง apply ทุกครั้ง
REVOKE ALL ON TABLE public.adhoc_affected_points FROM PUBLIC, anon, authenticated;

-- ── ดู ──────────────────────────────────────────────────────────────────────
-- ส่งเฉพาะจุดของ "จุดต้นทางที่ยังเปิดเรื่องอยู่และผู้เรียกมีสิทธิ์จัดการ" · ส่ง id จุดต้นทางที่ไม่มีสิทธิ์/ปิดแล้ว = ไม่คืนอะไร ไม่ error
-- (ไม่บอกว่ามี id นั้นอยู่หรือไม่) · audit เมื่อมีจุดถูกส่งออกจริงเท่านั้น ดึงแล้วว่างไม่ถือว่าเปิดดูข้อมูลบุคคล
CREATE OR REPLACE FUNCTION public.adhoc_affected_list(p_zone_ids uuid[])
RETURNS TABLE (
  id uuid, zone_id uuid, kind text, latitude double precision, longitude double precision,
  note text, created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_zones uuid[];
  v_actor record;
  r       record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(z.id), ARRAY[]::uuid[]) INTO v_zones
    FROM public.adhoc_impact_zones z
   WHERE z.id = ANY (COALESCE(p_zone_ids, ARRAY[]::uuid[]))
     AND z.is_active
     AND public.can_manage_adhoc_overlay(z.municipality_id);

  IF cardinality(v_zones) = 0 THEN
    RETURN;
  END IF;

  SELECT p.full_name, p.role INTO v_actor FROM public.profiles p WHERE p.id = v_uid;

  -- หนึ่งแถว audit ต่อ อปท. (superadmin ข้าม อปท. ได้) ไม่ใช่ต่อจุด — ไม่ให้ audit บวมทุกครั้งที่เปิดแผนที่
  FOR r IN
    SELECT a.municipality_id, count(*)::integer AS n, array_agg(DISTINCT a.zone_id) AS zone_ids
      FROM public.adhoc_affected_points a
     WHERE a.zone_id = ANY (v_zones)
     GROUP BY a.municipality_id
  LOOP
    INSERT INTO public.audit_logs
      (municipality_id, actor_id, actor_name, actor_role, action,
       resource_type, resource_id, resource_label, metadata)
    VALUES
      (r.municipality_id, v_uid, v_actor.full_name, v_actor.role, 'view_affected_points',
       'adhoc_affected_point', NULL, 'ดูพิกัดผู้ได้รับผลกระทบ',
       jsonb_build_object('zone_ids', r.zone_ids, 'point_count', r.n));
  END LOOP;

  RETURN QUERY
  SELECT a.id, a.zone_id, a.kind, a.latitude, a.longitude, a.note, a.created_at
    FROM public.adhoc_affected_points a
   WHERE a.zone_id = ANY (v_zones)
   ORDER BY a.created_at, a.id;
END
$$;

-- ── เพิ่ม/แก้ ───────────────────────────────────────────────────────────────
-- p_id NULL = เพิ่มใหม่ · มีค่า = แก้ (ย้ายไปจุดต้นทางอื่นไม่ได้ ต้องลบแล้วเพิ่มใหม่)
-- municipality_id ใช้ของจุดต้นทาง ไม่รับจากหน้าจอ · ผู้ไม่มีสิทธิ์กับ "ไม่พบจุดต้นทาง" ตอบข้อความเดียวกัน กันเดาว่ามี id นั้นอยู่
-- เพดาน 200 จุดต่อจุดต้นทาง (สมมติฐานของผม กัน loop/กดซ้ำจนตารางบวม ปรับได้ที่ migration ถัดไป)
CREATE OR REPLACE FUNCTION public.adhoc_affected_save(
  p_id        uuid,
  p_zone_id   uuid,
  p_kind      text,
  p_latitude  double precision,
  p_longitude double precision,
  p_note      text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_actor    record;
  v_zone     record;
  v_existing record;
  v_note     text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_id       uuid;
  v_count    integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'กรุณาเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;

  SELECT z.id, z.municipality_id, z.label, z.is_active
    INTO v_zone
    FROM public.adhoc_impact_zones z
   WHERE z.id = p_zone_id
     FOR SHARE;
  IF NOT FOUND OR NOT public.can_manage_adhoc_overlay(v_zone.municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์จัดการผู้ได้รับผลกระทบของจุดต้นทางนี้' USING ERRCODE = '42501';
  END IF;
  IF NOT v_zone.is_active THEN
    RAISE EXCEPTION 'จุดต้นทางนี้ปิดเรื่องแล้ว เปิดเรื่องอีกครั้งก่อนจึงจะเพิ่ม/แก้ได้' USING ERRCODE = '55000';
  END IF;

  SELECT p.full_name, p.role INTO v_actor FROM public.profiles p WHERE p.id = v_uid;

  IF p_id IS NULL THEN
    SELECT count(*) INTO v_count FROM public.adhoc_affected_points a WHERE a.zone_id = p_zone_id;
    IF v_count >= 200 THEN
      RAISE EXCEPTION 'เพิ่มได้สูงสุด 200 จุดต่อจุดต้นทาง' USING ERRCODE = '54000';
    END IF;

    INSERT INTO public.adhoc_affected_points
      (municipality_id, zone_id, kind, latitude, longitude, note, created_by)
    VALUES
      (v_zone.municipality_id, p_zone_id, p_kind, p_latitude, p_longitude, v_note, v_uid)
    RETURNING id INTO v_id;
  ELSE
    SELECT a.id, a.zone_id INTO v_existing
      FROM public.adhoc_affected_points a
     WHERE a.id = p_id
       FOR UPDATE;
    IF NOT FOUND OR v_existing.zone_id <> p_zone_id THEN
      RAISE EXCEPTION 'ไม่พบรายการนี้ในจุดต้นทางที่ระบุ' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.adhoc_affected_points
       SET kind = p_kind, latitude = p_latitude, longitude = p_longitude, note = v_note, updated_at = now()
     WHERE id = p_id;
    v_id := p_id;
  END IF;

  -- metadata ไม่มีพิกัดและไม่มีเนื้อหาหมายเหตุ (หมายเหตุอาจมีรายละเอียดที่อ่อนไหว บอกแค่ว่ามี/ไม่มี)
  INSERT INTO public.audit_logs
    (municipality_id, actor_id, actor_name, actor_role, action,
     resource_type, resource_id, resource_label, metadata)
  VALUES
    (v_zone.municipality_id, v_uid, v_actor.full_name, v_actor.role,
     CASE WHEN p_id IS NULL THEN 'create' ELSE 'update' END,
     'adhoc_affected_point', v_id::text, v_zone.label,
     jsonb_build_object('zone_id', p_zone_id, 'kind', p_kind, 'has_note', v_note IS NOT NULL));

  RETURN v_id;
END
$$;

-- ── ลบ ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adhoc_affected_delete(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_actor record;
  v_row   record;
  v_label text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'กรุณาเข้าสู่ระบบก่อน' USING ERRCODE = '42501';
  END IF;

  SELECT a.id, a.zone_id, a.municipality_id, a.kind
    INTO v_row
    FROM public.adhoc_affected_points a
   WHERE a.id = p_id
     FOR UPDATE;
  IF NOT FOUND OR NOT public.can_manage_adhoc_overlay(v_row.municipality_id) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ลบรายการนี้ หรือรายการถูกลบไปแล้ว' USING ERRCODE = '42501';
  END IF;

  SELECT z.label INTO v_label FROM public.adhoc_impact_zones z WHERE z.id = v_row.zone_id;
  SELECT p.full_name, p.role INTO v_actor FROM public.profiles p WHERE p.id = v_uid;

  DELETE FROM public.adhoc_affected_points WHERE id = p_id;

  INSERT INTO public.audit_logs
    (municipality_id, actor_id, actor_name, actor_role, action,
     resource_type, resource_id, resource_label, metadata)
  VALUES
    (v_row.municipality_id, v_uid, v_actor.full_name, v_actor.role, 'delete',
     'adhoc_affected_point', p_id::text, v_label,
     jsonb_build_object('zone_id', v_row.zone_id, 'kind', v_row.kind));

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.adhoc_affected_list(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adhoc_affected_save(uuid, uuid, text, double precision, double precision, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.adhoc_affected_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adhoc_affected_list(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adhoc_affected_save(uuid, uuid, text, double precision, double precision, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adhoc_affected_delete(uuid) TO authenticated;

COMMENT ON FUNCTION public.adhoc_affected_list(uuid[]) IS
  'ดึงพิกัดผู้ได้รับผลกระทบของจุดต้นทางที่ผู้เรียกมีสิทธิ์จัดการและยังเปิดเรื่องอยู่ — บันทึก audit view_affected_points ต่อ อปท. ต่อการดึงหนึ่งครั้ง (นับจำนวน ไม่เก็บพิกัด)';
COMMENT ON FUNCTION public.adhoc_affected_save(uuid, uuid, text, double precision, double precision, text) IS
  'เพิ่ม (p_id NULL) หรือแก้ผู้ได้รับผลกระทบ — เฉพาะแอดมิน/ผู้รับผิดชอบ จุดต้นทางต้องยังเปิดเรื่อง สูงสุด 200 จุดต่อจุดต้นทาง บันทึก audit create/update';
COMMENT ON FUNCTION public.adhoc_affected_delete(uuid) IS
  'ลบผู้ได้รับผลกระทบ 1 จุด — เฉพาะแอดมิน/ผู้รับผิดชอบ บันทึก audit delete';
