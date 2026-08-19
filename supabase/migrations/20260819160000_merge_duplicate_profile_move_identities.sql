-- merge_duplicate_profile() only re-pointed public.* table FKs and then deleted
-- merge_id's auth.users row. auth.identities.user_id -> auth.users.id is
-- ON DELETE CASCADE, so any OAuth identity (Google/LINE) linked ONLY to the
-- merge_id account would be silently destroyed along with it — the person would
-- lose the ability to log in with that provider entirely, even though the whole
-- point of merging is to let them log in with EITHER identity into one account.
-- Fix: move auth.identities rows from merge_id to keep_id before deleting
-- merge_id. Refuses (rather than silently producing an ambiguous state) if
-- keep_id already has an identity on the same provider — that needs a human
-- decision, not an automatic overwrite.

CREATE OR REPLACE FUNCTION public.merge_duplicate_profile(
  p_keep_id uuid,
  p_merge_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_keep_muni uuid;
  v_merge_muni uuid;
  v_keep_name text;
  v_merge_name text;
  v_counts jsonb := '{}'::jsonb;
  v_conflicting_providers text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'superadmin' THEN
    RAISE EXCEPTION 'Permission denied: superadmin only';
  END IF;

  IF p_keep_id = p_merge_id THEN
    RAISE EXCEPTION 'keep_id and merge_id must be different accounts';
  END IF;

  SELECT municipality_id, full_name INTO v_keep_muni, v_keep_name
    FROM public.profiles WHERE id = p_keep_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'keep_id not found'; END IF;

  SELECT municipality_id, full_name INTO v_merge_muni, v_merge_name
    FROM public.profiles WHERE id = p_merge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_id not found'; END IF;

  IF v_keep_muni IS DISTINCT FROM v_merge_muni THEN
    RAISE EXCEPTION 'Refusing to merge accounts from different municipalities (keep=%, merge=%)', v_keep_muni, v_merge_muni;
  END IF;

  -- ทั้ง dry-run และของจริงต้องเช็คนี้ก่อนเสมอ: ถ้า keep_id มี provider เดียวกับที่จะย้ายมาอยู่แล้ว
  -- (เช่น ทั้งคู่ผูก Google ไว้คนละบัญชี) ห้ามย้ายทับอัตโนมัติ ต้องให้คนตัดสินใจเอง
  SELECT array_agg(DISTINCT i.provider) INTO v_conflicting_providers
  FROM auth.identities i
  WHERE i.user_id = p_merge_id
    AND i.provider IN (SELECT provider FROM auth.identities WHERE user_id = p_keep_id);

  IF p_dry_run THEN
    SELECT jsonb_build_object(
      'dry_run', true,
      'keep_id', p_keep_id, 'keep_name', v_keep_name,
      'merge_id', p_merge_id, 'merge_name', v_merge_name,
      'keep_identities', (SELECT jsonb_agg(jsonb_build_object('provider', provider, 'email', email)) FROM auth.identities WHERE user_id = p_keep_id),
      'merge_identities', (SELECT jsonb_agg(jsonb_build_object('provider', provider, 'email', email)) FROM auth.identities WHERE user_id = p_merge_id),
      'identity_provider_conflict', v_conflicting_providers,
      'rows_to_move', jsonb_build_object(
        'category_assignments_technician_id', (SELECT count(*) FROM public.category_assignments WHERE technician_id = p_merge_id),
        'complaints_assigned_to', (SELECT count(*) FROM public.complaints WHERE assigned_to = p_merge_id),
        'complaints_document_uploaded_by', (SELECT count(*) FROM public.complaints WHERE document_uploaded_by = p_merge_id),
        'complaints_user_id', (SELECT count(*) FROM public.complaints WHERE user_id = p_merge_id),
        'document_access_logs_user_id', (SELECT count(*) FROM public.document_access_logs WHERE user_id = p_merge_id),
        'document_requests_user_id', (SELECT count(*) FROM public.document_requests WHERE user_id = p_merge_id),
        'document_requests_assigned_to', (SELECT count(*) FROM public.document_requests WHERE assigned_to = p_merge_id),
        'document_requests_payment_verified_by', (SELECT count(*) FROM public.document_requests WHERE payment_verified_by = p_merge_id),
        'documents_uploaded_by', (SELECT count(*) FROM public.documents WHERE uploaded_by = p_merge_id),
        'events_created_by', (SELECT count(*) FROM public.events WHERE created_by = p_merge_id),
        'fleet_audit_log_changed_by', (SELECT count(*) FROM public.fleet_audit_log WHERE changed_by = p_merge_id),
        'fleet_bookings_approved_by', (SELECT count(*) FROM public.fleet_bookings WHERE approved_by = p_merge_id),
        'fleet_bookings_requester_id', (SELECT count(*) FROM public.fleet_bookings WHERE requester_id = p_merge_id),
        'fleet_fuel_records_created_by', (SELECT count(*) FROM public.fleet_fuel_records WHERE created_by = p_merge_id),
        'fleet_fuel_records_driver_id', (SELECT count(*) FROM public.fleet_fuel_records WHERE driver_id = p_merge_id),
        'fleet_fuel_records_updated_by', (SELECT count(*) FROM public.fleet_fuel_records WHERE updated_by = p_merge_id),
        'fleet_maintenance_created_by', (SELECT count(*) FROM public.fleet_maintenance WHERE created_by = p_merge_id),
        'fleet_maintenance_technician_id', (SELECT count(*) FROM public.fleet_maintenance WHERE technician_id = p_merge_id),
        'fleet_maintenance_updated_by', (SELECT count(*) FROM public.fleet_maintenance WHERE updated_by = p_merge_id),
        'fleet_trips_approved_by', (SELECT count(*) FROM public.fleet_trips WHERE approved_by = p_merge_id),
        'fleet_trips_created_by', (SELECT count(*) FROM public.fleet_trips WHERE created_by = p_merge_id),
        'fleet_trips_driver_id', (SELECT count(*) FROM public.fleet_trips WHERE driver_id = p_merge_id),
        'posts_created_by', (SELECT count(*) FROM public.posts WHERE created_by = p_merge_id),
        'approval_requests_approved_by', (SELECT count(*) FROM public.approval_requests WHERE approved_by = p_merge_id),
        'approval_requests_created_by', (SELECT count(*) FROM public.approval_requests WHERE created_by = p_merge_id),
        'business_registrations_approved_by', (SELECT count(*) FROM public.business_registrations WHERE approved_by = p_merge_id),
        'business_registrations_user_id', (SELECT count(*) FROM public.business_registrations WHERE user_id = p_merge_id),
        'civil_projects_created_by', (SELECT count(*) FROM public.civil_projects WHERE created_by = p_merge_id),
        'data_center_entries_created_by', (SELECT count(*) FROM public.data_center_entries WHERE created_by = p_merge_id),
        'infrastructure_works_created_by', (SELECT count(*) FROM public.infrastructure_works WHERE created_by = p_merge_id),
        'notification_deliveries_requested_by', (SELECT count(*) FROM public.notification_deliveries WHERE requested_by = p_merge_id),
        'org_project_updates_created_by', (SELECT count(*) FROM public.org_project_updates WHERE created_by = p_merge_id),
        'org_projects_created_by', (SELECT count(*) FROM public.org_projects WHERE created_by = p_merge_id),
        'push_subscriptions_user_id', (SELECT count(*) FROM public.push_subscriptions WHERE user_id = p_merge_id),
        'satisfaction_responses_user_id', (SELECT count(*) FROM public.satisfaction_responses WHERE user_id = p_merge_id),
        'tourism_places_created_by', (SELECT count(*) FROM public.tourism_places WHERE created_by = p_merge_id),
        'tourism_reviews_user_id', (SELECT count(*) FROM public.tourism_reviews WHERE user_id = p_merge_id)
      )
    ) INTO v_counts;
    RETURN v_counts;
  END IF;

  IF v_conflicting_providers IS NOT NULL AND array_length(v_conflicting_providers, 1) > 0 THEN
    RAISE EXCEPTION 'Both accounts have an identity on the same provider(s): % — resolve manually before merging (cannot auto-decide which one to keep)', v_conflicting_providers;
  END IF;

  UPDATE public.category_assignments SET technician_id = p_keep_id WHERE technician_id = p_merge_id;
  UPDATE public.complaints SET assigned_to = p_keep_id WHERE assigned_to = p_merge_id;
  UPDATE public.complaints SET document_uploaded_by = p_keep_id WHERE document_uploaded_by = p_merge_id;
  UPDATE public.complaints SET user_id = p_keep_id WHERE user_id = p_merge_id;
  UPDATE public.document_access_logs SET user_id = p_keep_id WHERE user_id = p_merge_id;
  UPDATE public.document_requests SET user_id = p_keep_id WHERE user_id = p_merge_id;
  UPDATE public.document_requests SET assigned_to = p_keep_id WHERE assigned_to = p_merge_id;
  UPDATE public.document_requests SET payment_verified_by = p_keep_id WHERE payment_verified_by = p_merge_id;
  UPDATE public.documents SET uploaded_by = p_keep_id WHERE uploaded_by = p_merge_id;
  UPDATE public.events SET created_by = p_keep_id WHERE created_by = p_merge_id;
  UPDATE public.fleet_audit_log SET changed_by = p_keep_id WHERE changed_by = p_merge_id;
  UPDATE public.fleet_bookings SET approved_by = p_keep_id WHERE approved_by = p_merge_id;
  UPDATE public.fleet_bookings SET requester_id = p_keep_id WHERE requester_id = p_merge_id;
  UPDATE public.fleet_fuel_records SET created_by = p_keep_id WHERE created_by = p_merge_id;
  UPDATE public.fleet_fuel_records SET driver_id = p_keep_id WHERE driver_id = p_merge_id;
  UPDATE public.fleet_fuel_records SET updated_by = p_keep_id WHERE updated_by = p_merge_id;
  UPDATE public.fleet_maintenance SET created_by = p_keep_id WHERE created_by = p_merge_id;
  UPDATE public.fleet_maintenance SET technician_id = p_keep_id WHERE technician_id = p_merge_id;
  UPDATE public.fleet_maintenance SET updated_by = p_keep_id WHERE updated_by = p_merge_id;
  UPDATE public.fleet_trips SET approved_by = p_keep_id WHERE approved_by = p_merge_id;
  UPDATE public.fleet_trips SET created_by = p_keep_id WHERE created_by = p_merge_id;
  UPDATE public.fleet_trips SET driver_id = p_keep_id WHERE driver_id = p_merge_id;
  UPDATE public.posts SET created_by = p_keep_id WHERE created_by = p_merge_id;
  UPDATE public.approval_requests SET approved_by = p_keep_id WHERE approved_by = p_merge_id;
  UPDATE public.approval_requests SET created_by = p_keep_id WHERE created_by = p_merge_id;
  UPDATE public.business_registrations SET approved_by = p_keep_id WHERE approved_by = p_merge_id;
  UPDATE public.business_registrations SET user_id = p_keep_id WHERE user_id = p_merge_id;
  UPDATE public.civil_projects SET created_by = p_keep_id WHERE created_by = p_merge_id;
  UPDATE public.data_center_entries SET created_by = p_keep_id WHERE created_by = p_merge_id;
  UPDATE public.infrastructure_works SET created_by = p_keep_id WHERE created_by = p_merge_id;
  UPDATE public.notification_deliveries SET requested_by = p_keep_id WHERE requested_by = p_merge_id;
  UPDATE public.org_project_updates SET created_by = p_keep_id WHERE created_by = p_merge_id;
  UPDATE public.org_projects SET created_by = p_keep_id WHERE created_by = p_merge_id;
  UPDATE public.satisfaction_responses SET user_id = p_keep_id WHERE user_id = p_merge_id;
  UPDATE public.tourism_places SET created_by = p_keep_id WHERE created_by = p_merge_id;
  UPDATE public.tourism_reviews SET user_id = p_keep_id WHERE user_id = p_merge_id;

  DELETE FROM public.push_subscriptions ps_merge
  WHERE ps_merge.user_id = p_merge_id
    AND EXISTS (
      SELECT 1 FROM public.push_subscriptions ps_keep
      WHERE ps_keep.user_id = p_keep_id AND ps_keep.endpoint = ps_merge.endpoint
    );
  UPDATE public.push_subscriptions SET user_id = p_keep_id WHERE user_id = p_merge_id;

  -- ย้าย identity (Google/LINE/ฯลฯ) มาไว้ที่บัญชีที่เก็บไว้ ก่อนลบ auth.users ของบัญชีซ้ำ —
  -- ไม่งั้น ON DELETE CASCADE จะลบสิทธิ์ login ผ่าน provider นั้นหายไปเลย
  UPDATE auth.identities SET user_id = p_keep_id WHERE user_id = p_merge_id;

  INSERT INTO public.audit_logs (
    municipality_id, actor_id, actor_name, actor_role, action,
    resource_type, resource_id, resource_label, metadata
  ) VALUES (
    v_keep_muni, auth.uid(),
    (SELECT full_name FROM public.profiles WHERE id = auth.uid()), v_caller_role,
    'merge_duplicate_profile', 'profile', p_keep_id::text,
    COALESCE(v_keep_name, 'unnamed'),
    jsonb_build_object('kept_id', p_keep_id, 'merged_id', p_merge_id, 'merged_name', v_merge_name)
  );

  DELETE FROM auth.users WHERE id = p_merge_id;

  RETURN jsonb_build_object('dry_run', false, 'merged_into', p_keep_id, 'deleted', p_merge_id);
END;
$$;
