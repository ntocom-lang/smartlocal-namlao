-- Legacy private RPCs refuse community projections before they reach old print code.
-- Install after v2 views and before any real community intake. This cannot erase
-- offline data already downloaded by a stale client; real tenants start without it.
BEGIN;
DO $guard$
DECLARE expected jsonb:=jsonb_build_object('public.patient_booking_workspace(uuid)','e5ce1f20886c6df4a60f4273bdf838a8',
 'public.patient_booking_workspace_v2(uuid)','e5ce1f20886c6df4a60f4273bdf838a8',
 'public.patient_booking_mine(uuid)','d69773d7616d9eaf9a83662e9c8a96a8',
 'public.patient_booking_mine_v2(uuid)','d69773d7616d9eaf9a83662e9c8a96a8'); fn text; actual text;
BEGIN
 FOR fn IN SELECT jsonb_object_keys(expected) LOOP
  SELECT md5(replace(prosrc,chr(13),'')) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(fn);
  IF actual IS DISTINCT FROM expected->>fn THEN RAISE EXCEPTION 'Function drift: %',fn; END IF;
 END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION public.patient_booking_workspace(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); result jsonb;
BEGIN
 IF role_name IS NULL OR role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 result:=public.patient_booking_workspace_v2(p_muni);
 -- The snapshot examined here is exactly the snapshot returned below. No check/read race.
 -- An enabled policy forces upgrade even before the first community request.
 -- Closing intake must not restore the old printer while community work is visible.
 IF EXISTS(SELECT 1 FROM public.patient_booking_community_rules WHERE municipality_id=p_muni AND enabled)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(result->'bookings') b WHERE b->>'service_type'='community')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(result->'trips') t WHERE t#>>'{plan,service_type}'='community') THEN
  RAISE EXCEPTION USING ERRCODE='PBC01', MESSAGE='มีบริการชุมชน กรุณาโหลดหน้าใหม่เพื่อใช้ระบบจองรถรุ่นล่าสุด';
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.patient_booking_mine(p_muni uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text:=public.ptb_role(p_muni); result jsonb;
BEGIN
 IF role_name IS NULL OR role_name IN ('anonymous','outside') THEN RAISE EXCEPTION 'ไม่มีสิทธิ์เข้าถึงหน่วยงานนี้'; END IF;
 result:=public.patient_booking_mine_v2(p_muni);
 -- The snapshot examined here is exactly the snapshot returned below. No check/read race.
 -- An enabled policy forces upgrade even before the first community request.
 -- Closing intake must not restore the old printer while community work is visible.
 IF EXISTS(SELECT 1 FROM public.patient_booking_community_rules WHERE municipality_id=p_muni AND enabled)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(result->'bookings') b WHERE b->>'service_type'='community')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(result->'trips') t WHERE t#>>'{plan,service_type}'='community') THEN
  RAISE EXCEPTION USING ERRCODE='PBC01', MESSAGE='มีบริการชุมชน กรุณาโหลดหน้าใหม่เพื่อใช้ระบบจองรถรุ่นล่าสุด';
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.patient_booking_workspace(uuid),public.patient_booking_mine(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.patient_booking_workspace(uuid),public.patient_booking_mine(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
