-- ที่ปรึกษา AI เฉพาะ Super Admin รอบ 2 ไฟล์ 3 — RPC "ภาพรวมระบบ" (D1) ตัวเลขรวมราย อปท. ให้แนบไปกับคำถาม (เจ้าของระบบอนุมัติ 2569-11-08)
--   ไม่สร้างตาราง/คอลัมน์ — มีแต่ฟังก์ชัน จึงจบในไฟล์เดียว · ไม่ต้องพึ่งไฟล์ 130000/130100 (Edge Function เรียกเมื่อผู้ใช้ติ๊ก "แนบภาพรวมระบบ")
--
-- advisor_system_overview(p_days)  p_days = 30 หรือ 90 เท่านั้น · EXECUTE ได้เฉพาะ service_role (Edge Function superadmin-advisor)
--   คืน jsonb: ราย อปท. ที่ is_active และไม่ใช่สนามซ้อม (slug 'demo' — ไม่มีคอลัมน์ธงทดสอบในตาราง municipalities)
--   ⚠️ PDPA: ส่งออกนอกระบบไปผู้ให้บริการ AI ต่างประเทศ → มีแต่ "จำนวน/ผลรวม" กับ "รหัส" (สถานะ/หมวด/ประเภท/บทบาท)
--      ห้ามมีชื่อ เบอร์ ที่อยู่ พิกัด ข้อความอิสระ หรือ id ของแถวใดๆ
--      ⚠️ ทุกค่าที่ออกเป็น "key ของ JSON" ต้องผ่าน whitelist ห้าม GROUP BY ค่าดิบ: document_requests.document_type/status และ
--         complaints.category ไม่มี CHECK และ anon INSERT ได้ — ใครยิง API ใส่ "นายสมชาย 081..." เป็นประเภทคำขอ ค่านั้นจะออกไปถึงผู้ให้บริการ AI
--         (ผู้ตรวจ migration พบ 2569-11-08) ค่านอก whitelist รวมเป็น 'custom_or_unrecognized' / 'other' / 'unrecognized'
--      ไม่ส่ง mobility ของรถผู้ป่วย (บอกว่าใช้วีลแชร์/นอนเปล = ข้อมูลสุขภาพ)
--      จำนวน 1–4 ของกลุ่มสุขภาพ/ช่วยเหลือประชาชน (รถผู้ป่วย + คำขอ public_assistance_request / patient_transport_request) แสดงเป็น "<5"
--      — อปท. เล็กมี 1–2 รายก็เดาตัวคนได้ (small-cell suppression — ความเห็นเชิงวิชาชีพ ไม่ใช่ข้อบังคับที่ตรวจกับตัวบท)
--      กลุ่มอ่อนไหวรายงานแยก ไม่รวมใน created/by_status/by_type และไม่แตกตามสถานะ — ไม่งั้นเอายอดรวมลบยอดย่อยแล้วได้เลขที่ปิดไว้กลับมา
--      เทียบ 30 กับ 90 วันยังเห็นส่วนต่างได้ — ยอมรับ เพราะผู้เรียกคือ superadmin ที่อ่านข้อมูลดิบได้อยู่แล้ว ตัวกันนี้คือกันฝั่งผู้ให้บริการ AI
--   นิยามที่ใช้ (ตรงกับของเดิมในระบบ)
--     คำร้อง: open = new/pending/received · in_progress · resolved = done/closed/completed · rejected · parked (complaint_stats 20261025100200)
--             เวลาปิดเฉลี่ย = closed_at − created_at เฉพาะ resolved ที่มี closed_at (ข้อมูลเก่าบางแถวไม่มี closed_at)
--             ค้างเกินกำหนด = ยังไม่ปิด (open/in_progress) และ due_date < วันนี้เวลาไทย และไม่ใช่หมวดเฉพาะกิจ
--             ≈ ไม่หักวันหยุดนักขัตฤกษ์แบบหน้าจอ (workingDaysLeft) — ตัวเลขอาจต่างจากหน้าจอเล็กน้อย จึงติดป้าย approx
--     คำขอ E-Service: document_requests ประเภทตาม BASE_DOCUMENT_TYPES (src/lib/documentTypes.js) + ค่าเก่า · ประเภทที่ อปท. เพิ่มเองรวมเป็น custom_or_unrecognized
--     หมวดคำร้อง: ชื่อหมวดจาก complaint_categories.label (แอดมินตั้ง ประชาชนเห็นอยู่แล้ว) · ไม่อยู่ในทะเบียนหมวด = unrecognized
--     ยานพาหนะ: fleet_trips (ไม่ใช่ fleet_bookings) · ระยะทางรวมเฉพาะเที่ยว completed (ตาม FleetReport) ของรถที่วัดเป็น กม. (meter_unit km + asset_kind vehicle)
--               น้ำมัน = coalesce(invoice_total, total_cost) ตามหน้ารายงาน FleetReport
--     รถผู้ป่วย: นับทั้ง patient_bookings เฉพาะ service_type = 'patient' (ไม่รวมรถรับ-ส่งชุมชน) และ patient_transport_requests — ยังไม่ยืนยันว่าชุดไหนใช้จริง
--     ผู้ใช้: profiles ตาม role ทุกช่วงเวลา (ไม่ใช่เฉพาะช่วง) ไม่นับ superadmin
--
-- ย้อนกลับ: DROP FUNCTION IF EXISTS public.advisor_system_overview(integer), public.advisor_small_cell(bigint);
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── ด่าน schema drift: ทุกคอลัมน์ที่ฟังก์ชันอ่านต้องมีจริง (pg_attribute ไม่ขึ้นกับสิทธิ์ผู้รัน) ──
DO $guard$
DECLARE
  need text[][] := ARRAY[
    ['municipalities', 'slug'], ['municipalities', 'name'], ['municipalities', 'org_type'], ['municipalities', 'is_active'],
    ['complaint_categories', 'municipality_id'], ['complaint_categories', 'value'], ['complaint_categories', 'label'],
    ['complaints', 'municipality_id'], ['complaints', 'status'], ['complaints', 'category'], ['complaints', 'created_at'],
    ['complaints', 'closed_at'], ['complaints', 'due_date'], ['complaints', 'channel'],
    ['document_requests', 'municipality_id'], ['document_requests', 'document_type'], ['document_requests', 'status'], ['document_requests', 'created_at'],
    ['fleet_trips', 'municipality_id'], ['fleet_trips', 'status'], ['fleet_trips', 'trip_date'], ['fleet_trips', 'distance_km'], ['fleet_trips', 'vehicle_id'],
    ['fleet_vehicles', 'id'], ['fleet_vehicles', 'meter_unit'], ['fleet_vehicles', 'asset_kind'],
    ['fleet_fuel_records', 'municipality_id'], ['fleet_fuel_records', 'filled_at'], ['fleet_fuel_records', 'liters'],
    ['fleet_fuel_records', 'total_cost'], ['fleet_fuel_records', 'invoice_total'],
    ['patient_bookings', 'municipality_id'], ['patient_bookings', 'status'], ['patient_bookings', 'created_at'], ['patient_bookings', 'service_type'],
    ['patient_transport_requests', 'municipality_id'], ['patient_transport_requests', 'workflow_status'], ['patient_transport_requests', 'created_at'],
    ['profiles', 'municipality_id'], ['profiles', 'role']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(need, 1) LOOP
    IF to_regclass('public.' || need[i][1]) IS NULL OR NOT EXISTS (
         SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || need[i][1])
            AND attname = need[i][2] AND attnum > 0 AND NOT attisdropped) THEN
      RAISE EXCEPTION 'Schema drift: ไม่พบ public.%.%', need[i][1], need[i][2];
    END IF;
  END LOOP;
  IF to_regprocedure('public.complaint_category_is_adhoc(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Schema drift: ไม่พบ public.complaint_category_is_adhoc(uuid, text)';
  END IF;
END $guard$;

-- จำนวน 1–4 → "<5" (0 คงเป็น 0 — "ไม่มีเลย" ไม่ระบุตัวใคร)
CREATE OR REPLACE FUNCTION public.advisor_small_cell(n bigint) RETURNS jsonb
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN n BETWEEN 1 AND 4 THEN to_jsonb('<5'::text) ELSE to_jsonb(coalesce(n, 0)) END
$$;

CREATE OR REPLACE FUNCTION public.advisor_system_overview(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_since timestamptz;
  v_since_date date;
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  -- ไม่รวม 2 ประเภทอ่อนไหว (รายงานแยกใน sensitive_types) · 4 ค่าท้ายคือค่าเก่าที่อาจยังอยู่ในข้อมูล
  c_doc_types constant text[] := ARRAY['tax_notice', 'waste_collection', 'waste_collection_request', 'waste_collection_cancel',
    'water_supply_request', 'water_meter_change', 'water_supply_cancel', 'asset_borrow_request', 'building_permit', 'cctv_footage_request',
    'residence_cert', 'personal_cert', 'conduct_cert', 'other'];
  c_doc_sensitive constant text[] := ARRAY['public_assistance_request', 'patient_transport_request'];
  c_doc_status constant text[] := ARRAY['pending', 'processing', 'completed', 'rejected'];
  c_trip_status constant text[] := ARRAY['draft', 'pending', 'waitlisted', 'approved', 'rejected', 'cancelled', 'in_progress', 'completed'];
  v_out jsonb;
BEGIN
  IF p_days IS NULL OR p_days NOT IN (30, 90) THEN
    RAISE EXCEPTION 'p_days ต้องเป็น 30 หรือ 90' USING ERRCODE = '22023';
  END IF;
  v_since_date := v_today - p_days;
  v_since := (v_since_date::timestamp) AT TIME ZONE 'Asia/Bangkok';

  SELECT jsonb_build_object(
    'generated_at', to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI:SS"+07:00"'),
    'period_days', p_days,
    'since', v_since_date,
    'notes', jsonb_build_array(
      'ตัวเลขรวมเท่านั้น ไม่มีข้อมูลรายบุคคล',
      'ค่า "<5" = มี 1–4 รายการ (ปิดตัวเลขจริงเพื่อไม่ให้ระบุตัวบุคคลได้)',
      'overdue_open_approx นับทุกเรื่องที่ยังไม่ปิดไม่จำกัดวันที่สร้าง และไม่หักวันหยุดนักขัตฤกษ์ — อาจต่างจากหน้าจอเล็กน้อย',
      'users_by_role นับทุกช่วงเวลา ส่วนตัวเลขอื่นนับเฉพาะช่วง period_days วันล่าสุด',
      'doc_requests ไม่รวมคำขอกลุ่มอ่อนไหว ซึ่งแยกไว้ใน sensitive_types'
    ),
    'municipalities', coalesce(jsonb_agg(t.obj ORDER BY t.name), '[]'::jsonb)
  )
  INTO v_out
  FROM (
    SELECT m.name, jsonb_build_object(
      'slug', m.slug,
      'name', m.name,
      'org_type', m.org_type,

      'complaints', (
        SELECT jsonb_build_object(
          'created', count(*),
          'open', count(*) FILTER (WHERE c.status IN ('new', 'pending', 'received')),
          'in_progress', count(*) FILTER (WHERE c.status = 'in_progress'),
          'resolved', count(*) FILTER (WHERE c.status IN ('done', 'closed', 'completed')),
          'rejected', count(*) FILTER (WHERE c.status = 'rejected'),
          'parked', count(*) FILTER (WHERE c.status = 'parked'),
          'avg_close_days', round((avg(extract(epoch FROM (c.closed_at - c.created_at)) / 86400.0)
                              FILTER (WHERE c.status IN ('done', 'closed', 'completed') AND c.closed_at IS NOT NULL))::numeric, 1),
          'by_channel', coalesce((SELECT jsonb_object_agg(coalesce(x.channel, 'unknown'), x.n) FROM (
              SELECT c2.channel, count(*) n FROM public.complaints c2
               WHERE c2.municipality_id = m.id AND c2.created_at >= v_since GROUP BY c2.channel) x), '{}'::jsonb),
          'top_categories', coalesce((SELECT jsonb_object_agg(x.category, x.n) FROM (
              SELECT coalesce(left(cc.label, 60), 'unrecognized') category, count(*) n FROM public.complaints c2
                LEFT JOIN public.complaint_categories cc ON cc.municipality_id = c2.municipality_id AND cc.value = c2.category
               WHERE c2.municipality_id = m.id AND c2.created_at >= v_since
               GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10) x), '{}'::jsonb)
        )
        FROM public.complaints c
        WHERE c.municipality_id = m.id AND c.created_at >= v_since
      )
      -- ค้างเกินกำหนดนับทุกเรื่องที่ยังไม่ปิด ไม่จำกัดช่วงวันที่สร้าง (เรื่องเก่าที่ค้างคือเรื่องที่ต้องเห็นที่สุด)
      || jsonb_build_object('overdue_open_approx', (
        SELECT count(*) FROM public.complaints c
         WHERE c.municipality_id = m.id
           AND c.status IN ('new', 'pending', 'received', 'in_progress')
           AND c.due_date IS NOT NULL AND c.due_date < v_today
           AND NOT coalesce(public.complaint_category_is_adhoc(c.municipality_id, c.category), false)
      )),

      'doc_requests', jsonb_build_object(
        'created', (SELECT count(*) FROM public.document_requests d WHERE d.municipality_id = m.id AND d.created_at >= v_since
                      AND coalesce(d.document_type <> ALL (c_doc_sensitive), true)),
        'by_status', coalesce((SELECT jsonb_object_agg(x.s, x.n) FROM (
            SELECT CASE WHEN d.status = ANY (c_doc_status) THEN d.status ELSE 'other' END s, count(*) n FROM public.document_requests d
             WHERE d.municipality_id = m.id AND d.created_at >= v_since AND coalesce(d.document_type <> ALL (c_doc_sensitive), true) GROUP BY 1) x), '{}'::jsonb),
        'by_type', coalesce((SELECT jsonb_object_agg(x.t, x.n) FROM (
            SELECT CASE WHEN d.document_type = ANY (c_doc_types) THEN d.document_type ELSE 'custom_or_unrecognized' END t, count(*) n FROM public.document_requests d
             WHERE d.municipality_id = m.id AND d.created_at >= v_since AND coalesce(d.document_type <> ALL (c_doc_sensitive), true) GROUP BY 1) x), '{}'::jsonb)
      ),
      'sensitive_types', jsonb_build_object(
        'public_assistance_request', public.advisor_small_cell((SELECT count(*) FROM public.document_requests d
           WHERE d.municipality_id = m.id AND d.created_at >= v_since AND d.document_type = 'public_assistance_request')),
        'patient_transport_request', public.advisor_small_cell((SELECT count(*) FROM public.document_requests d
           WHERE d.municipality_id = m.id AND d.created_at >= v_since AND d.document_type = 'patient_transport_request'))
      ),

      'fleet', jsonb_build_object(
        'trips', (SELECT count(*) FROM public.fleet_trips f WHERE f.municipality_id = m.id AND f.trip_date >= v_since_date),
        'trips_by_status', coalesce((SELECT jsonb_object_agg(x.s, x.n) FROM (
            SELECT CASE WHEN f.status = ANY (c_trip_status) THEN f.status ELSE 'other' END s, count(*) n FROM public.fleet_trips f
             WHERE f.municipality_id = m.id AND f.trip_date >= v_since_date GROUP BY 1) x), '{}'::jsonb),
        'distance_km', (SELECT coalesce(round(sum(f.distance_km)::numeric, 1), 0) FROM public.fleet_trips f
            JOIN public.fleet_vehicles v ON v.id = f.vehicle_id
           WHERE f.municipality_id = m.id AND f.trip_date >= v_since_date AND f.status = 'completed'
             AND v.meter_unit = 'km' AND v.asset_kind = 'vehicle'),
        'fuel_liters', (SELECT coalesce(round(sum(r.liters)::numeric, 1), 0) FROM public.fleet_fuel_records r
           WHERE r.municipality_id = m.id AND r.filled_at >= v_since_date),
        'fuel_baht', (SELECT coalesce(round(sum(coalesce(r.invoice_total, r.total_cost))::numeric, 2), 0) FROM public.fleet_fuel_records r
           WHERE r.municipality_id = m.id AND r.filled_at >= v_since_date)
      ),

      -- ไม่แตกตามสถานะ: ยอดรวมลบยอดย่อยจะได้เลขที่ปิดไว้กลับมา
      'patient_transport', jsonb_build_object(
        'bookings', public.advisor_small_cell((SELECT count(*) FROM public.patient_bookings b
           WHERE b.municipality_id = m.id AND b.created_at >= v_since AND b.service_type = 'patient')),
        'referrals', public.advisor_small_cell((SELECT count(*) FROM public.patient_transport_requests p
           WHERE p.municipality_id = m.id AND p.created_at >= v_since))
      ),

      'users_by_role', coalesce((SELECT jsonb_object_agg(coalesce(x.role, 'unknown'), x.n) FROM (
          SELECT pr.role, count(*) n FROM public.profiles pr
           WHERE pr.municipality_id = m.id AND pr.role IS DISTINCT FROM 'superadmin' GROUP BY pr.role) x), '{}'::jsonb)
    ) AS obj
    FROM public.municipalities m
    WHERE m.is_active IS TRUE AND m.slug IS DISTINCT FROM 'demo'
  ) t;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.advisor_small_cell(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advisor_system_overview(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advisor_system_overview(integer) TO service_role;

DO $verify$
BEGIN
  IF has_function_privilege('anon', 'public.advisor_system_overview(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.advisor_system_overview(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.advisor_system_overview(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.advisor_small_cell(bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.advisor_small_cell(bigint)', 'EXECUTE')
     OR (SELECT NOT prosecdef OR proowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
               OR NOT proconfig @> ARRAY['search_path=pg_catalog, public']
           FROM pg_proc WHERE oid = 'public.advisor_system_overview(integer)'::regprocedure) THEN
    RAISE EXCEPTION 'advisor_system_overview: สิทธิ์ไม่ตรงตามที่ออกแบบ (ผู้รันต้องเป็นเจ้าของ เช่น postgres)';
  END IF;
END $verify$;

COMMIT;
