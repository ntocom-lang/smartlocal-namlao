-- ข้อ 3 ตั้งค่าแจ้งเตือน (เจ้าของระบบอนุมัติ 2569-10-29): กระดิ่งรวม "งานของฉัน" หลายหมวด
--
-- my_notification_feed(p_municipality_id) คืน
--   categories = หมวดที่ผู้เรียก "ได้รับจริง" (หน้าตั้งค่าโชว์สวิตช์ปิดเสียงเฉพาะหมวดเหล่านี้)
--   items      = งานรอของแต่ละหมวด (คำร้องหน้าเว็บดึงเองเหมือนเดิม ไม่อยู่ในนี้)
--
-- ⚠️ SECURITY INVOKER โดยเจตนา: document_requests / event_assignments / events อ่านผ่าน RLS เดิมของผู้เรียก
--    ไม่เขียนกติกาสิทธิ์ชุดที่สอง · หมวดลงนามกับรถผู้ป่วยเรียก RPC เดิมที่ตัดสินสิทธิ์เอง
--    (esign_my_signer_overview / esign_my_pending / patient_booking_info / patient_booking_staff_work_badge)
-- ข้อมูลที่คืน: รหัส สถานะ วันเวลา รหัสประเภทเอกสาร ชื่อช่องลงนาม — ไม่มีชื่อ เบอร์ ที่อยู่ ข้อความที่ประชาชนพิมพ์
-- ปลายทาง/วัตถุประสงค์ของรถ (ป๊อปอัปขึ้นกลางจอ คนข้างๆ เห็นได้)

BEGIN;

-- บทบาทงานรถรับ-ส่งผู้ป่วยของ "ผู้เรียกเอง" — ptb_role ไม่เปิดให้เรียกตรง จึงห่อไว้คืนแค่ของตัวเอง
-- (ptb_role อ่าน auth.uid() เอง ไม่รับรหัสผู้ใช้จากภายนอก)
CREATE OR REPLACE FUNCTION public.my_patient_transport_role(p_municipality_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT public.ptb_role(p_municipality_id) $$;

REVOKE ALL ON FUNCTION public.my_patient_transport_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_patient_transport_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_notification_feed(p_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_role       text := public.get_my_role();
  v_muni       uuid := public.get_my_municipality_id();
  v_today      date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_categories jsonb := '[]'::jsonb;
  v_items      jsonb := '[]'::jsonb;
  v_signer     jsonb;
  v_pending    jsonb;
  v_badge      jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  -- บุคลากรของ อปท. นี้เท่านั้น (superadmin ได้ทุก อปท.) — ประชาชนมีแค่คำร้อง ซึ่งหน้าเว็บดึงเอง
  IF p_municipality_id IS NULL OR NOT (
    v_role = 'superadmin'
    OR (v_role IN ('admin', 'officer', 'staff', 'technician', 'viewer', 'council', 'kamnan') AND v_muni = p_municipality_id)
  ) THEN
    RETURN jsonb_build_object('ok', true, 'categories', v_categories, 'items', v_items);
  END IF;

  -- 1) รอลงนามของฉัน — เฉพาะคนที่ตั้งรหัสลงนามแล้วและไม่ถูกระงับ · ถึงคิวใครตัดสินโดย esign_my_pending
  v_signer := public.esign_my_signer_overview();
  IF COALESCE((v_signer ->> 'pin_set')::boolean, false) AND NOT COALESCE((v_signer ->> 'suspended')::boolean, false) THEN
    v_categories := v_categories || to_jsonb('esign'::text);
    v_pending := public.esign_my_pending();
    SELECT v_items || COALESCE(jsonb_agg(jsonb_build_object(
      'category', 'esign',
      'key', 'esign:' || (i ->> 'trip_id') || ':' || (i ->> 'slot'),
      'ref', i ->> 'trip_id',
      'status', i ->> 'decision',
      'detail', i ->> 'slot_label',
      'at', i ->> 'planned_departure'
    )), '[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(COALESCE(v_pending -> 'items', '[]'::jsonb)) AS i;
  END IF;

  -- 2) กิจกรรมที่มอบหมายให้ฉัน (ยังไม่ผ่านไป) — บทบาทชุดเดียวกับ policy "event assignments read internal"
  --    (รายการจริงกรองด้วย RLS อีกชั้น ชุดบทบาทนี้ใช้แค่ตัดสินว่าโชว์สวิตช์ปิดเสียงหมวดนี้ไหม)
  IF v_role IN ('superadmin', 'admin', 'officer', 'viewer', 'council', 'staff', 'technician') THEN
    v_categories := v_categories || to_jsonb('event'::text);
    SELECT v_items || COALESCE(jsonb_agg(jsonb_build_object(
      'category', 'event',
      'key', 'event:' || ea.id,
      'ref', e.id,
      'status', ea.task,
      'detail', to_char(e.event_date, 'YYYY-MM-DD'),
      'at', ea.assigned_at
    ) ORDER BY e.event_date, ea.assigned_at), '[]'::jsonb)
    INTO v_items
    FROM public.event_assignments ea
    JOIN public.events e ON e.id = ea.event_id
    WHERE ea.profile_id = v_uid
      AND ea.municipality_id = p_municipality_id
      AND COALESCE(e.end_date, e.event_date) >= v_today;
  END IF;

  -- 3) คำขอ E-Service รอรับเรื่อง — RLS "read document_requests" ตัดสินว่าเห็นใบไหน
  --    (แอดมิน = ทั้ง อปท. · หัวหน้ากอง = กองตัวเอง · staff = ใบที่มอบหมายให้ · พัสดุ = ใบยืมของกอง)
  --    ไม่นับใบที่ตัวเองยื่นในฐานะประชาชน
  IF v_role IN ('superadmin', 'admin', 'officer', 'staff') THEN
    v_categories := v_categories || to_jsonb('eservice'::text);
    SELECT v_items || COALESCE(jsonb_agg(jsonb_build_object(
      'category', 'eservice',
      'key', 'eservice:' || r.id || ':' || r.status,
      'ref', r.id,
      'status', r.status,
      'detail', r.document_type,
      'at', r.created_at
    ) ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT d.id, d.status, d.document_type, d.created_at
      FROM public.document_requests d
      WHERE d.municipality_id = p_municipality_id
        AND d.status = 'pending'
        AND d.user_id IS DISTINCT FROM v_uid
      ORDER BY d.created_at DESC
      LIMIT 30
    ) r;
  END IF;

  -- 4) รถรับ-ส่งผู้ป่วย — เฉพาะแอดมิน/ผู้ประสานงาน/คนขับของ อปท. ที่เปิดใช้บริการ · ตารางไม่เปิด RLS ให้อ่านตรง
  --    จึงได้แค่จำนวนงานจาก RPC เดิม (key รวมจำนวนไว้ หน้าเว็บเด้งเฉพาะตอนจำนวนเพิ่ม)
  IF public.my_patient_transport_role(p_municipality_id) IN ('admin', 'coordinator', 'driver')
     AND COALESCE((public.patient_booking_info(p_municipality_id) ->> 'enabled')::boolean, false) THEN
    v_categories := v_categories || to_jsonb('patient'::text);
    v_badge := public.patient_booking_staff_work_badge(p_municipality_id);
    IF COALESCE((v_badge ->> 'total')::int, 0) > 0 THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'category', 'patient',
        'key', 'patient:' || (v_badge ->> 'pending') || ':' || (v_badge ->> 'driver'),
        'ref', NULL,
        'status', 'pending',
        'detail', v_badge ->> 'total',
        'at', now()
      ));
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'categories', v_categories, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.my_notification_feed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_notification_feed(uuid) TO authenticated;

COMMENT ON FUNCTION public.my_notification_feed(uuid) IS
  'กระดิ่งรวมงานของฉัน (รอลงนาม/กิจกรรมที่มอบหมาย/คำขอ E-Service/รถผู้ป่วย) — SECURITY INVOKER อ่านผ่าน RLS เดิม ไม่คืนข้อมูลส่วนบุคคล';

COMMIT;
