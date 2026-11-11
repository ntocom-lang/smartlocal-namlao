-- 20261118100100_exec_digest_functions.sql
--
-- ห้องผู้บริหาร เฟส E3-3 — ไฟล์ 2/3: ฟังก์ชันสรุปเช้า + แจ้งคะแนนต่ำ + รอลงนามเกิน 2 วันทำการ
-- ต้อง apply หลัง 20261118100000 (หมวด dm_muted ใหม่) และไฟล์ E3-2 (20261117100000/100100) — guard หัวไฟล์ตรวจให้
--
-- แผนที่เจ้าของระบบอนุมัติ (2026-11-10/11):
--   สรุปเช้า 07:30 วันทำการ ทาง Telegram ส่วนตัวถึงผู้บริหาร: เรื่องใหม่เมื่อวาน / เลยกำหนด / รอลงนาม / กำหนดการวันนี้
--     + ความเคลื่อนไหวของเรื่องที่ติดตาม (ติดตาม = แจ้งในสรุปเช้าอย่างเดียว · เรื่องเสร็จ = เลิกติดตามเอง)
--     + บรรทัดเด่น: เลยกำหนดเกิน 5 วันทำการ / รอลงนามเกิน 2 วันทำการ
--   แจ้งทันทีเฉพาะคะแนนประเมินคำร้อง ≤ 2 (cron ทุก 30 นาที)
--   exec_digest_for(user) ให้ service_role เรียกได้อย่างเดียว · หมวด exec_digest/exec_alert ใน dm_muted ค่าเริ่มต้น = รับ
--
-- ฟังก์ชันที่ authenticated เรียกได้:
--   exec_my_esign_waiting(m)      การ์ด "รอลงนามเกิน 2 วันทำการ" ในห้องผู้บริหาร (ของผู้เรียกเอง) — ด่าน exec_assert_viewer
--   set_my_telegram_dm_muted(arr) (เดิม) รับหมวดใหม่ exec_digest / exec_alert เพิ่ม — เขียนทับทั้งฟังก์ชัน ตัวเนื้อเดิมคงไว้ครบ
-- ฟังก์ชันที่ service_role เท่านั้นเรียกได้ (Edge Function exec-digest-notify):
--   exec_digest_recipients(category)  ผู้รับ: ผู้บริหารที่ผูก Telegram และไม่ได้ปิดหมวดนั้น + วันนี้เป็นวันทำการของ อปท. ไหม
--   exec_digest_for(user, m)          เนื้อสรุปเช้าของผู้รับ 1 คน (คำนวณ "ในนามผู้รับ" — ดูหัวข้อด้านล่าง)
--   exec_digest_ack(user, m, items)   หลังส่งสำเร็จ: จดสถานะที่แจ้งแล้ว + เลิกติดตามเรื่องที่เสร็จ/หายไป
--   exec_low_ratings_pending(since)   คะแนนคำร้อง ≤ 2 ที่ยังอยู่ในหน้าต่างแจ้ง (ไม่มีความเห็น/ชื่อผู้ประเมิน)
-- ภายในเท่านั้น:
--   exec_digest_eligible(user, m), exec_working_days_after(from, to, m), exec_esign_waiting_core(m)
--
-- ผู้รับ (exec_digest_eligible) = ชุดเดียวกับ "ผู้สั่งเร่ง" exec_assert_actor ของ E3-2 แต่ไม่รวม superadmin
--   viewer (นายก/รองนายก/ที่ปรึกษา/เลขาฯ) หรือตำแหน่งหมวด top_admin (ปลัด/รองปลัด) ของ อปท. นั้น
--   ไม่รวม admin (ไอที ไม่ใช่ผู้บริหาร) · ไม่รวม superadmin (ไม่มีสังกัด จะได้สรุปทุก อปท. ทุกเช้า)
--   ⇒ ผู้รับทุกคนเปิดห้องผู้บริหารเองได้อยู่แล้ว (exec_assert_viewer กว้างกว่า) — สรุปเช้าไม่เปิดข้อมูลเกินหน้าเว็บ
--
-- ⚠️ "คำนวณในนามผู้รับ" (exec_digest_for) — จุดที่ต้องรีวิว:
--   ตัวเลขทุกส่วนมาจากฟังก์ชันเดียวกับหน้าห้องผู้บริหาร (exec_overdue_items / exec_my_follows / esign_my_pending /
--   list_events_for_staff_between) ซึ่งทุกตัวตรวจสิทธิ์และเลือกข้อมูลจาก auth.uid() ของผู้เรียก
--   cron เรียกด้วย service_role (auth.uid() ว่าง) จึงตั้ง request.jwt.claims เป็นของผู้รับแบบ is_local ชั่วคราว
--   แล้วคืนค่าเดิมก่อนออก (ทั้งทางปกติและทาง error) — ดีกว่าเขียนกติกา "ใครเห็นอะไร" ซ้ำอีกชุดแล้วเพี้ยนจากหน้าเว็บ
--   รั้วกันใช้ผิด:
--     1) EXECUTE ให้ service_role เท่านั้น (ด่านท้ายไฟล์ยืนยัน) + ผู้เรียกต้องไม่มี auth.uid() (บัญชีผู้ใช้เรียกตรงไม่ได้แม้สิทธิ์หลุด)
--     2) สวมได้เฉพาะบัญชีที่ผ่าน exec_digest_eligible ของ อปท. นั้น — สวมเป็นใครก็ได้ไม่ได้
--     3) ฟังก์ชันที่เรียกในนามผู้รับเป็นแบบอ่านอย่างเดียวทั้งหมด (STABLE) ไม่มีการเขียนใดๆ ระหว่างสวม
--     4) คืนเฉพาะ จำนวน / เลขที่ / หมวด / กอง / สถานะ / วันที่ / ชื่อกิจกรรม — ไม่มีชื่อผู้ร้อง รายละเอียด เบอร์ ที่อยู่
--        ไม่มีชื่อผู้ขอใช้รถ ปลายทาง หรือวัตถุประสงค์ (esign_my_pending คืนมาแต่ฟังก์ชันนี้ตัดทิ้ง เหลือแค่จำนวน)
--
-- รอลงนามเกิน 2 วันทำการ (exec_esign_waiting_core — ใช้ร่วมการ์ดหน้าเว็บและสรุปเช้า สูตรเดียว):
--   คิวของฉัน = esign_my_pending().items (กติกา "ถึงคิวใคร" ที่เดียว ไม่เขียนซ้ำ — ปัจจุบันครอบเฉพาะใบขอใช้รถ)
--   เวลาที่ถึงคิว (ประมาณ) = ความเคลื่อนไหวล่าสุดของใบ: สร้างใบ / ลงนามช่องใดก็ได้ / ถอนลายเซ็น / ส่งคืน-ส่งกลับ
--     ช่อง sk1 (หลังเดินทาง) นับเวลาแก้ไขล่าสุดของใบด้วย (ใบจบทริปแล้วจึงถึงคิว)
--   เกิน 2 วันทำการ = add_working_days(วันที่ถึงคิว, 2, อปท.) < วันนี้ (เวลาไทย) — ถึงคิววันจันทร์ ขึ้นเตือนเช้าวันพฤหัส
--   ⚠️ เป็นค่าประมาณ ส่วนใหญ่เอียงไปทาง "เตือนช้า" (เหตุการณ์ใดๆ บนใบรีเซ็ตนาฬิกา) ยกเว้นกรณีเดียวที่เตือนเร็วเกินจริง:
--      ผู้ลงนามที่คาดไว้เปลี่ยนคน (แต่งตั้งใหม่/แก้ทะเบียนผู้ลงนาม/รักษาการ) ใบโผล่ในคิวคนใหม่พร้อมเวลาถึงคิวของคนเก่า
--      ⇒ ขึ้น over_2wd ทันที — ยอมรับได้ (นานๆ ครั้ง และใบนั้นค้างนานจริง)
--
-- เลยกำหนดเกิน 5 วันทำการ = จำนวนวันทำการในช่วง (due_date, วันนี้] > 5 — หลักเดียวกับ workingDaysBetween ของหน้า
--   รายการเลยกำหนด (execFollowNudgeHelpers.groupByDept / EXEC_OVERDUE_WD) ตัวเลขจึงตรงกับหน้าเว็บ
--
-- เรื่องใหม่เมื่อวาน = ตั้งแต่ 00:00 ของ "วันทำการก่อนหน้า" ถึง 00:00 วันนี้ (เวลาไทย) — เช้าวันจันทร์ครอบ ศ.–อา.
--   คำร้อง: ไม่รวมหมวดเฉพาะกิจ (นิยามเดียวกับ E2) รวมหมวดอ่อนไหวแต่เป็นแค่ตัวเลข · คำขอ: ทุกประเภท
--
-- คะแนนต่ำ (exec_low_ratings_pending):
--   เฉพาะคะแนนที่ผูกคำร้อง (complaint_id ไม่ว่าง) — แบบประเมินภาพรวมไม่ผูกคำร้อง ไม่แจ้งทันที
--   เพราะผู้ไม่ล็อกอินส่งได้ไม่จำกัด ใครก็ยิงคะแนน 1 ให้ DM ท่วมโทรศัพท์นายกได้ (ดูยอดรวมได้ที่หน้าห้องผู้บริหาร)
--   ไม่คืนความเห็น (ข้อความที่ผู้ประเมินพิมพ์เอง) · หมวดอ่อนไหว = ไม่มีเลขที่/หมวด เหลือกอง + คะแนน
--   ย้อนหลังไม่เกิน 7 วัน (ช่วงหยุดยาว/cron ล่ม) · กันส่งซ้ำรายคนรายคะแนนที่ notification_deliveries (Edge Function)
--
-- ไม่สร้างตาราง/คอลัมน์ · ไม่แตะ RLS/GRANT ของตาราง · เขียนได้ตารางเดียวคือ exec_follows (exec_digest_ack)
--
-- ย้อนกลับ:
--   DROP FUNCTION public.exec_low_ratings_pending(timestamptz), public.exec_digest_ack(uuid,uuid,jsonb),
--     public.exec_digest_for(uuid,uuid), public.exec_digest_recipients(text), public.exec_my_esign_waiting(uuid),
--     public.exec_esign_waiting_core(uuid), public.exec_working_days_after(date,date,uuid), public.exec_digest_eligible(uuid,uuid);
--   + คืน set_my_telegram_dm_muted ตามไฟล์ 20261030100100 (ชุดหมวดเดิม 3 หมวด)
--
-- ⚠️ เตือนผู้แก้ฟังก์ชันปลายทางในอนาคต: exec_overdue_items / exec_my_follows / esign_my_pending / list_events_for_staff(_between)
--    ถูกเรียก "ในนามผู้รับ" จาก exec_digest_for — ถ้าวันหน้าใส่การเขียนข้อมูลลงไป (เช่น นับ rate limit / จดการเปิดอ่าน)
--    การเขียนนั้นจะเกิดในนามผู้บริหารทุกเช้าโดยที่เขาไม่ได้เปิดหน้าเว็บ — ป้าย STABLE ของตัวเรียกไม่ได้กันฟังก์ชันที่ถูกเรียกต่อ

BEGIN;
--
-- ตรวจหลัง apply (อ่านอย่างเดียว) — คาด: f,t,f,f,t,f,t,f,t,f,t,f
--   SELECT has_function_privilege('anon',          'public.exec_my_esign_waiting(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_my_esign_waiting(uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_digest_for(uuid,uuid)', 'EXECUTE'),
--          has_function_privilege('anon',          'public.exec_digest_for(uuid,uuid)', 'EXECUTE'),
--          has_function_privilege('service_role',  'public.exec_digest_for(uuid,uuid)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_digest_recipients(text)', 'EXECUTE'),
--          has_function_privilege('service_role',  'public.exec_digest_recipients(text)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_digest_ack(uuid,uuid,jsonb)', 'EXECUTE'),
--          has_function_privilege('service_role',  'public.exec_digest_ack(uuid,uuid,jsonb)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_low_ratings_pending(timestamptz)', 'EXECUTE'),
--          has_function_privilege('service_role',  'public.exec_low_ratings_pending(timestamptz)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.exec_esign_waiting_core(uuid)', 'EXECUTE');

DO $$
DECLARE
  v_missing text;
BEGIN
  IF to_regclass('public.exec_follows') IS NULL THEN
    RAISE EXCEPTION 'exec_digest_functions: ต้อง apply 20261117100000_exec_follow_nudge_tables.sql ก่อน';
  END IF;
  IF to_regprocedure('public.exec_overdue_items(uuid)') IS NULL
     OR to_regprocedure('public.exec_my_follows(uuid)') IS NULL THEN
    RAISE EXCEPTION 'exec_digest_functions: ต้อง apply 20261117100100_exec_follow_nudge_functions.sql ก่อน';
  END IF;
  IF to_regprocedure('public.exec_assert_viewer(uuid)') IS NULL
     OR to_regprocedure('public.exec_complaint_dept(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'exec_digest_functions: ต้อง apply ไฟล์เฟส E2 (20261115100000/100100) ก่อน';
  END IF;
  IF to_regprocedure('public.esign_my_pending()') IS NULL
     OR to_regprocedure('public.list_events_for_staff_between(uuid,date,date)') IS NULL
     OR to_regprocedure('public.add_working_days(date,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'exec_digest_functions: ไม่พบ esign_my_pending / list_events_for_staff_between / add_working_days';
  END IF;
  -- ไฟล์ 1 ต้องมาก่อน: set_my_telegram_dm_muted ด้านล่างรับหมวดใหม่ ถ้า CHECK ยังเป็นชุดเดิม ผู้ใช้กดปิดแล้วได้ 23514
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'telegram_user_links_dm_muted_check'
      AND pg_get_constraintdef(oid) LIKE '%exec_digest%'
      AND pg_get_constraintdef(oid) LIKE '%exec_alert%'
  ) THEN
    RAISE EXCEPTION 'exec_digest_functions: ต้อง apply 20261118100000_exec_digest_dm_categories.sql ก่อน';
  END IF;

  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('telegram_user_links', 'user_id'), ('telegram_user_links', 'chat_id'), ('telegram_user_links', 'dm_muted'),
    ('profiles', 'role'), ('profiles', 'position_id'), ('profiles', 'municipality_id'),
    ('positions', 'category'), ('municipalities', 'slug'), ('municipalities', 'name'), ('municipalities', 'is_active'),
    ('fleet_trips', 'created_at'), ('fleet_trips', 'updated_at'), ('fleet_trips', 'municipality_id'),
    ('esign_signatures', 'doc_type'), ('esign_signatures', 'doc_id'), ('esign_signatures', 'signed_at'),
    ('esign_revocations', 'signature_id'), ('esign_revocations', 'revoked_at'),
    ('esign_trip_returns', 'doc_type'), ('esign_trip_returns', 'doc_id'), ('esign_trip_returns', 'created_at'),
    ('complaints', 'created_at'), ('complaints', 'category'), ('complaints', 'ref_no'),
    ('document_requests', 'created_at'),
    ('satisfaction_ratings', 'complaint_id'), ('satisfaction_ratings', 'rating'), ('satisfaction_ratings', 'created_at'),
    ('satisfaction_ratings', 'is_verified'), ('satisfaction_ratings', 'via_link'), ('satisfaction_ratings', 'rated_by_proxy'),
    ('satisfaction_ratings', 'municipality_id'),
    ('complaint_categories', 'requires_manual_intake'), ('complaint_categories', 'is_adhoc'),
    ('exec_follows', 'last_seen_status'), ('exec_follows', 'ended_reason')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'exec_digest_functions: ไม่พบคอลัมน์ %', v_missing;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- set_my_telegram_dm_muted — เขียนทับทั้งตัว (เนื้อเดิมจาก 20261030100100 เพิ่มแค่ 2 หมวด)
-- ══════════════════════════════════════════════════════════════════════════════════
-- ไม่ตรวจว่าเป็นผู้บริหารหรือไม่: หมวดผู้บริหารที่คนทั่วไปปิดไว้ไม่มีผลอะไร (ไม่ใช่ผู้รับอยู่แล้ว)
-- หน้าเว็บโชว์สวิตช์สองหมวดนี้เฉพาะผู้บริหาร
CREATE OR REPLACE FUNCTION public.set_my_telegram_dm_muted(p_muted text[])
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_muted text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT k ORDER BY k), '{}')
    INTO v_muted
    FROM unnest(COALESCE(p_muted, '{}')) AS k
   WHERE k IN ('complaint', 'event', 'esign', 'exec_digest', 'exec_alert');

  UPDATE public.telegram_user_links
     SET dm_muted = v_muted
   WHERE user_id = v_uid
  RETURNING dm_muted INTO v_muted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'telegram is not linked' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_muted;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_telegram_dm_muted(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_telegram_dm_muted(text[]) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════
-- ภายใน: ใครได้รับสรุปเช้า/แจ้งทันที
-- ══════════════════════════════════════════════════════════════════════════════════
-- ปิดตายเมื่อไม่แน่ใจ: คืน true เฉพาะเมื่อทุกเงื่อนไขเป็น true (IS TRUE) — NULL ใดๆ = false
CREATE OR REPLACE FUNCTION public.exec_digest_eligible(_user_id uuid, _municipality_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT (
      _municipality_id IS NOT NULL
      AND p.municipality_id IS NOT DISTINCT FROM _municipality_id
      AND (
        p.role = 'viewer'
        OR (pos.category IS NOT DISTINCT FROM 'top_admin'
            AND p.role IN ('officer', 'staff', 'council', 'technician', 'admin'))
      )
    ) IS TRUE
    FROM public.profiles AS p
    LEFT JOIN public.positions AS pos ON pos.id = p.position_id
    WHERE p.id = _user_id
  ), false)
$$;

REVOKE ALL ON FUNCTION public.exec_digest_eligible(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════════
-- ภายใน: จำนวนวันทำการในช่วง (_from, _to] — หลักเดียวกับ workingDaysBetween (ไม่รวมวันตั้งต้น รวมวันปลายทาง)
-- ══════════════════════════════════════════════════════════════════════════════════
-- วันหยุด: แถวของ อปท. ชนะแถวทั่วประเทศ (ลำดับเดียวกับ add_working_days) · เพดาน 400 วัน (เกินคืน 400)
-- _to ก่อน _from หรือค่าว่าง = 0 (ใช้นับ "เลยมาแล้ว" ไม่ติดลบ)
CREATE OR REPLACE FUNCTION public.exec_working_days_after(_from date, _to date, _municipality_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(count(*)::int, 0)
  FROM generate_series(_from + 1, LEAST(_to, _from + 400), interval '1 day') AS g(ts)
  CROSS JOIN LATERAL (SELECT g.ts::date AS d) AS x
  WHERE _from IS NOT NULL AND _to IS NOT NULL AND _to > _from
    AND extract(isodow FROM x.d) < 6
    AND COALESCE((
      SELECT NOT h.is_working_day
      FROM public.public_holidays AS h
      WHERE h.holiday_date = x.d
        AND (h.municipality_id = _municipality_id OR h.municipality_id IS NULL)
      ORDER BY (h.municipality_id IS NULL)
      LIMIT 1
    ), false) = false
$$;

REVOKE ALL ON FUNCTION public.exec_working_days_after(date, date, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════════
-- ภายใน: เอกสารรอฉันลงนาม + เกิน 2 วันทำการ (ของ auth.uid() ปัจจุบัน)
-- ══════════════════════════════════════════════════════════════════════════════════
-- คืน {count, over_2wd, oldest_at} — ไม่มีชื่อผู้ขอ/ปลายทาง/วัตถุประสงค์ (esign_my_pending คืนมา แต่ตัดทิ้งที่นี่)
-- count = จำนวนรายการเดียวกับการ์ด "เอกสารรอท่านลงนาม" (esign_my_pending().count)
CREATE OR REPLACE FUNCTION public.exec_esign_waiting_core(_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today   date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_pending jsonb;
  v_out     jsonb;
BEGIN
  v_pending := public.esign_my_pending();
  IF COALESCE((v_pending ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('count', 0, 'over_2wd', 0, 'oldest_at', NULL);
  END IF;

  SELECT jsonb_build_object(
           'count', count(*)::int,
           'over_2wd', count(*) FILTER (
             WHERE public.add_working_days((x.reached AT TIME ZONE 'Asia/Bangkok')::date, 2, _municipality_id) < v_today
           )::int,
           'oldest_at', min(x.reached))
    INTO v_out
  FROM jsonb_array_elements(COALESCE(v_pending -> 'items', '[]'::jsonb)) AS e(item)
  JOIN public.fleet_trips AS t
    ON t.id = (e.item ->> 'trip_id')::uuid
   AND t.municipality_id = _municipality_id
  CROSS JOIN LATERAL (
    SELECT GREATEST(
             t.created_at,
             (SELECT max(s.signed_at) FROM public.esign_signatures AS s
               WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = t.id),
             (SELECT max(rv.revoked_at) FROM public.esign_revocations AS rv
               JOIN public.esign_signatures AS s2 ON s2.id = rv.signature_id
               WHERE s2.doc_type = 'fleet_trip_request' AND s2.doc_id = t.id),
             (SELECT max(r.created_at) FROM public.esign_trip_returns AS r
               WHERE r.doc_type = 'fleet_trip_request' AND r.doc_id = t.id),
             CASE WHEN e.item ->> 'slot' = 'sk1' THEN t.updated_at END
           ) AS reached
  ) AS x;

  RETURN COALESCE(v_out, jsonb_build_object('count', 0, 'over_2wd', 0, 'oldest_at', NULL));
END;
$$;

REVOKE ALL ON FUNCTION public.exec_esign_waiting_core(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- การ์ด "รอลงนามเกิน 2 วันทำการ" (src:esign → waiting_2wd) ของผู้เรียกเอง
CREATE OR REPLACE FUNCTION public.exec_my_esign_waiting(_municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  RETURN public.exec_esign_waiting_core(_municipality_id);
END;
$$;

REVOKE ALL ON FUNCTION public.exec_my_esign_waiting(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_my_esign_waiting(uuid) TO authenticated;

COMMENT ON FUNCTION public.exec_my_esign_waiting(uuid) IS
  'ห้องผู้บริหาร E3-3: เอกสารรอผู้เรียกลงนาม + จำนวนที่ถึงคิวมาเกิน 2 วันทำการ (นับจากความเคลื่อนไหวล่าสุดของใบ) — ตัวเลขเท่านั้น';

-- ══════════════════════════════════════════════════════════════════════════════════
-- service_role: ผู้รับ
-- ══════════════════════════════════════════════════════════════════════════════════
-- _category = 'exec_digest' (สรุปเช้า) | 'exec_alert' (คะแนนต่ำแจ้งทันที) — ตัดคนที่ปิดหมวดนั้นไว้ออก
-- is_working_day = วันนี้ (เวลาไทย) เป็นวันทำการของ อปท. นั้น (เสาร์-อาทิตย์/วันหยุดของ อปท. หรือทั่วประเทศ = false)
-- chat_id คืนให้ Edge Function ส่งข้อความ (ข้อมูลส่วนบุคคล — ฟังก์ชันนี้ service_role เท่านั้น)
CREATE OR REPLACE FUNCTION public.exec_digest_recipients(_category text)
RETURNS TABLE (
  municipality_id   uuid,
  slug              text,
  municipality_name text,
  user_id           uuid,
  chat_id           bigint,
  is_working_day    boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'ใช้ได้เฉพาะงานอัตโนมัติของระบบ' USING ERRCODE = '42501';
  END IF;
  IF _category IS NULL OR _category NOT IN ('exec_digest', 'exec_alert') THEN
    RAISE EXCEPTION 'หมวดไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT m.id, m.slug, m.name, l.user_id, l.chat_id,
         public.add_working_days(v_today - 1, 1, m.id) = v_today
  FROM public.telegram_user_links AS l
  JOIN public.profiles AS p ON p.id = l.user_id
  JOIN public.municipalities AS m ON m.id = p.municipality_id
  WHERE m.is_active IS TRUE
    AND NOT (_category = ANY (COALESCE(l.dm_muted, '{}'::text[])))
    AND public.exec_digest_eligible(l.user_id, m.id)
  ORDER BY m.slug, l.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_digest_recipients(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_digest_recipients(text) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════════
-- service_role: เนื้อสรุปเช้าของผู้รับ 1 คน
-- ══════════════════════════════════════════════════════════════════════════════════
-- คืน (ok:true) {
--   as_of, municipality_id,
--   window: {from, to}                         ช่วง "เรื่องใหม่เมื่อวาน" (to ไม่รวม)
--   new: {complaints, requests}
--   overdue: {total, sensitive, over5, top:[{k, ref, cat, cat_label, dept, due, wd}]}   top = เกิน 5 วันทำการ เก่าสุดก่อน ≤ 5 แถว
--   esign: {count, over_2wd, oldest_at}
--   follows: {active, items:[{k, id, ref, state, from, to}], more}   state = changed | done | gone · ≤ 20 แถว
--   events: {items:[{title, event_date, end_date, event_time}], more}   กิจกรรมวันนี้ ≤ 8 แถว
--   ack: [{k, id, s, end}]                     ส่งกลับเข้า exec_digest_ack หลังส่ง Telegram สำเร็จเท่านั้น
-- }
-- (ok:false) {reason:'not_eligible'} — ผู้รับเปลี่ยนตำแหน่ง/ย้าย อปท. ระหว่างรอบ
-- ชื่อกิจกรรมเป็นสิ่งที่ผู้รับเห็นในปฏิทินของตัวเองอยู่แล้ว (กติกาเดียวกับ list_events_for_staff)
-- ⚠️ ไม่มีรายการส่วนตัว 🔒 (personal_events) — list_events_for_staff ไม่ได้อ่าน หน้าเว็บเติมเองใน useExecExtras.js
--    จึงต่างจากการ์ด "กำหนดการ 7 วัน" ในห้องผู้บริหาร · ตั้งใจไม่ส่งรายการส่วนตัวออกไป Telegram (PDPA)
CREATE OR REPLACE FUNCTION public.exec_digest_for(_user_id uuid, _municipality_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today        date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_prev_day     date;
  v_prev_claims  text;
  v_prev_sub     text;
  v_overdue      jsonb;
  v_follows      jsonb;
  v_esign        jsonb;
  v_events       jsonb;
  v_events_n     int;
  v_new_c        int;
  v_new_r        int;
  v_over         jsonb;
  v_fol_items    jsonb;
  v_fol_more     int;
  v_fol_active   int;
  v_ack          jsonb;
  v_i            int;
BEGIN
  -- รั้ว 1: บัญชีผู้ใช้เรียกตรงไม่ได้ แม้สิทธิ์ EXECUTE จะหลุด (service_role ไม่มี sub ⇒ auth.uid() ว่าง)
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'ใช้ได้เฉพาะงานอัตโนมัติของระบบ' USING ERRCODE = '42501';
  END IF;
  IF _user_id IS NULL OR _municipality_id IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุผู้รับและหน่วยงาน' USING ERRCODE = '22023';
  END IF;
  -- รั้ว 2: สวมได้เฉพาะผู้บริหารของ อปท. นั้น
  IF public.exec_digest_eligible(_user_id, _municipality_id) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_eligible');
  END IF;

  -- วันทำการก่อนหน้า (ถอยไม่เกิน 30 วัน — สงกรานต์+เสาร์อาทิตย์ยาวสุดราว 6 วัน)
  v_prev_day := v_today - 1;
  FOR v_i IN 1..30 LOOP
    EXIT WHEN public.add_working_days(v_prev_day - 1, 1, _municipality_id) = v_prev_day;
    v_prev_day := v_prev_day - 1;
  END LOOP;

  -- เรื่องใหม่ (ตัวเลขล้วน ไม่ต้องสวม — อ่านด้วยสิทธิ์เจ้าของฟังก์ชัน ตัวเลขเท่ากันทุกผู้บริหาร)
  SELECT count(*)::int INTO v_new_c
  FROM public.complaints AS c
  LEFT JOIN public.complaint_categories AS cat
    ON cat.municipality_id = c.municipality_id AND cat.value = c.category
  WHERE c.municipality_id = _municipality_id
    AND NOT COALESCE(cat.is_adhoc, false)
    AND c.created_at >= (v_prev_day::timestamp AT TIME ZONE 'Asia/Bangkok')
    AND c.created_at <  (v_today::timestamp AT TIME ZONE 'Asia/Bangkok');

  SELECT count(*)::int INTO v_new_r
  FROM public.document_requests AS r
  WHERE r.municipality_id = _municipality_id
    AND r.created_at >= (v_prev_day::timestamp AT TIME ZONE 'Asia/Bangkok')
    AND r.created_at <  (v_today::timestamp AT TIME ZONE 'Asia/Bangkok');

  -- ── สวมเป็นผู้รับ (is_local = เฉพาะ transaction นี้) แล้วคืนค่าเดิมทั้งทางปกติและทาง error ──
  v_prev_claims := current_setting('request.jwt.claims', true);
  v_prev_sub    := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claims',
                     jsonb_build_object('sub', _user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _user_id::text, true);

  BEGIN
    -- ยืนยันว่าสวมติดจริง ก่อนใช้ผลใดๆ (auth.uid() ของ Supabase อ่านจากสองค่านี้)
    IF auth.uid() IS DISTINCT FROM _user_id THEN
      RAISE EXCEPTION 'exec_digest_for: สวมผู้รับไม่สำเร็จ' USING ERRCODE = '42501';
    END IF;

    v_overdue := public.exec_overdue_items(_municipality_id);
    v_follows := public.exec_my_follows(_municipality_id);
    v_esign   := public.exec_esign_waiting_core(_municipality_id);

    SELECT COALESCE(jsonb_agg(ev.j ORDER BY ev.j ->> 'event_time' NULLS FIRST, ev.j ->> 'title')
                    FILTER (WHERE ev.rn <= 8), '[]'::jsonb),
           count(*)::int
      INTO v_events, v_events_n
    FROM (
      SELECT jsonb_build_object(
               'title', left(btrim(COALESCE(x.e ->> 'title', '')), 120),
               'event_date', x.e ->> 'event_date',
               'end_date', x.e ->> 'end_date',
               'event_time', x.e ->> 'event_time') AS j,
             row_number() OVER (ORDER BY x.e ->> 'event_time' NULLS FIRST, x.e ->> 'title') AS rn
      FROM public.list_events_for_staff_between(_municipality_id, v_today, v_today) AS x(e)
    ) AS ev;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claims', COALESCE(v_prev_claims, ''), true);
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
    RAISE;
  END;

  PERFORM set_config('request.jwt.claims', COALESCE(v_prev_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
  -- ── จบช่วงสวม ──

  -- เลยกำหนด: เกิน 5 วันทำการ (หลักเดียวกับหน้า) · หมวดอ่อนไหวเป็นยอดรวมเท่านั้น (exec_overdue_items ตัดเลขที่ไว้แล้ว)
  -- ⚠️ items ถูกตัดที่ 300 แถว (truncated) — over5 นับจากแถวที่ได้ ถ้า truncated ให้ Edge Function เขียน "อย่างน้อย"
  WITH it AS (
    SELECT i.item AS j,
           public.exec_working_days_after((i.item ->> 'due')::date, v_today, _municipality_id) AS wd
    FROM jsonb_array_elements(COALESCE(v_overdue -> 'items', '[]'::jsonb)) AS i(item)
  ), hot AS (
    SELECT it.j, it.wd, row_number() OVER (ORDER BY it.j ->> 'due', it.j ->> 'ref') AS rn
    FROM it WHERE it.wd > 5
  )
  SELECT jsonb_build_object(
           'total', COALESCE((v_overdue ->> 'total')::int, 0),
           'truncated', COALESCE((v_overdue ->> 'truncated')::boolean, false),
           'sensitive', (SELECT COALESCE(sum((s.item ->> 'n')::int), 0)::int
                         FROM jsonb_array_elements(COALESCE(v_overdue -> 'sensitive', '[]'::jsonb)) AS s(item)),
           'over5', (SELECT count(*)::int FROM hot),
           'top', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'k', h.j ->> 'k', 'ref', h.j ->> 'ref', 'cat', h.j ->> 'cat', 'cat_label', h.j ->> 'cat_label',
                            'dept', h.j ->> 'dept', 'due', h.j ->> 'due', 'wd', h.wd) ORDER BY h.rn), '[]'::jsonb)
                   FROM hot AS h WHERE h.rn <= 5))
    INTO v_over;

  -- เรื่องที่ติดตาม: แจ้งเฉพาะที่ขยับ (สถานะเปลี่ยน / เสร็จหรือปิด / หายไป) · from = สถานะที่แจ้งไปแล้วล่าสุด
  -- hidden (ถูกย้ายเข้าหมวดอ่อนไหวหลังกดติดตาม): ไม่แจ้งในข้อความเลย (ไม่บอกเลขที่ซ้ำ)
  --   แต่ถ้าเรื่องปิดแล้ว (hidden_done) เลิกติดตามเงียบๆ ผ่าน ack — ไม่งั้นค้างกินเพดาน 50 เรื่อง/คนตลอดไป
  --   สถานะอ่านจาก exec_item_snapshot ในนามเจ้าของฟังก์ชัน (ไม่ออกไปกับผลลัพธ์ ใช้ตัดสินเท่านั้น)
  WITH f AS (
    SELECT x.item AS j,
           fl.last_seen_status AS seen,
           sn.status AS hidden_status,
           CASE
             WHEN (x.item ->> 'gone')::boolean IS TRUE THEN 'gone'
             WHEN (x.item ->> 'hidden')::boolean IS TRUE THEN
               CASE WHEN sn.item_ref IS NOT NULL AND sn.is_open IS NOT TRUE THEN 'hidden_done' END
             WHEN (x.item ->> 'open')::boolean IS NOT TRUE THEN 'done'
             WHEN (x.item ->> 'changed')::boolean IS TRUE THEN 'changed'
           END AS state,
           fl.created_at
    FROM jsonb_array_elements(COALESCE(v_follows -> 'follows', '[]'::jsonb)) AS x(item)
    JOIN public.exec_follows AS fl
      ON fl.user_id = _user_id AND fl.municipality_id = _municipality_id AND fl.ended_at IS NULL
     AND fl.item_kind = x.item ->> 'k' AND fl.item_id = (x.item ->> 'id')::uuid
    LEFT JOIN LATERAL public.exec_item_snapshot(_municipality_id, fl.item_kind, fl.item_id) AS sn
      ON (x.item ->> 'hidden')::boolean IS TRUE
  ), moved AS (
    SELECT f.*, row_number() OVER (
             ORDER BY CASE f.state WHEN 'done' THEN 0 WHEN 'changed' THEN 1 ELSE 2 END, f.created_at) AS rn
    FROM f WHERE f.state IN ('done', 'changed', 'gone')
  )
  SELECT (SELECT count(*)::int FROM f),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'k', m.j ->> 'k', 'id', m.j ->> 'id', 'ref', m.j ->> 'ref', 'state', m.state,
                     'from', m.seen, 'to', m.j ->> 's') ORDER BY m.rn)
                   FROM moved AS m WHERE m.rn <= 20), '[]'::jsonb),
         GREATEST((SELECT count(*)::int FROM moved) - 20, 0),
         -- ack = แถวที่แสดงในข้อความ (≤ 20) + hidden_done ทั้งหมด (เงียบ) — ไม่เกิน 70 แถว (เพดานติดตาม 50)
         COALESCE((SELECT jsonb_agg(a.j) FROM (
                     SELECT jsonb_build_object(
                              'k', m.j ->> 'k', 'id', m.j ->> 'id', 's', m.j ->> 's',
                              'end', CASE m.state WHEN 'done' THEN 'done' WHEN 'gone' THEN 'gone' END) AS j
                     FROM moved AS m WHERE m.rn <= 20
                     UNION ALL
                     SELECT jsonb_build_object('k', h.j ->> 'k', 'id', h.j ->> 'id', 's', h.hidden_status, 'end', 'done')
                     FROM f AS h WHERE h.state = 'hidden_done') AS a), '[]'::jsonb)
    INTO v_fol_active, v_fol_items, v_fol_more, v_ack;

  RETURN jsonb_build_object(
    'ok', true,
    'as_of', v_today,
    'municipality_id', _municipality_id,
    'window', jsonb_build_object('from', v_prev_day, 'to', v_today),
    'new', jsonb_build_object('complaints', COALESCE(v_new_c, 0), 'requests', COALESCE(v_new_r, 0)),
    'overdue', v_over,
    'esign', v_esign,
    'follows', jsonb_build_object('active', v_fol_active, 'items', v_fol_items, 'more', v_fol_more),
    'events', jsonb_build_object('items', v_events, 'more', GREATEST(v_events_n - 8, 0)),
    'ack', v_ack
  );
END;
$$;

REVOKE ALL ON FUNCTION public.exec_digest_for(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_digest_for(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.exec_digest_for(uuid, uuid) IS
  'ห้องผู้บริหาร E3-3: เนื้อสรุปเช้าของผู้บริหาร 1 คน — คำนวณในนามผู้รับด้วยฟังก์ชันชุดเดียวกับหน้าห้องผู้บริหาร (service_role เท่านั้น)';

-- ══════════════════════════════════════════════════════════════════════════════════
-- service_role: จดว่าแจ้งแล้ว (เรียกหลังส่ง Telegram สำเร็จเท่านั้น — ส่งพลาดพรุ่งนี้แจ้งซ้ำ ไม่หาย)
-- ══════════════════════════════════════════════════════════════════════════════════
-- _items = ack จาก exec_digest_for: [{k, id, s, end}] ≤ 100 แถว
--   s   = สถานะที่แจ้งไป → last_seen_status (gone ไม่มี s = คงค่าเดิม)
--   end = 'done' | 'gone' → เลิกติดตามเอง (ended_reason) · null = ยังติดตามต่อ
-- จดเป็น "สถานะที่แจ้งไปจริง" ไม่ใช่สถานะปัจจุบัน — ถ้าเรื่องขยับอีกระหว่างส่ง พรุ่งนี้จะแจ้งต่อ
-- ข้ามแถวที่รูปแบบผิดเงียบๆ (ไม่ล้มทั้งชุด) · คืนจำนวนแถวที่จด
CREATE OR REPLACE FUNCTION public.exec_digest_ack(_user_id uuid, _municipality_id uuid, _items jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_kind text;
  v_id   uuid;
  v_s    text;
  v_end  text;
  v_n    int := 0;
  v_one  int;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'ใช้ได้เฉพาะงานอัตโนมัติของระบบ' USING ERRCODE = '42501';
  END IF;
  IF _user_id IS NULL OR _municipality_id IS NULL OR _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'ข้อมูลไม่ครบ' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(_items) > 100 THEN
    RAISE EXCEPTION 'รายการเกิน 100' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT x FROM jsonb_array_elements(_items) AS x LOOP
    CONTINUE WHEN jsonb_typeof(v_item) <> 'object';
    v_kind := v_item ->> 'k';
    CONTINUE WHEN v_kind IS NULL OR v_kind NOT IN ('complaint', 'document_request');
    CONTINUE WHEN COALESCE(v_item ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    v_id  := (v_item ->> 'id')::uuid;
    v_s   := left(NULLIF(btrim(COALESCE(v_item ->> 's', '')), ''), 30);
    v_end := v_item ->> 'end';
    CONTINUE WHEN v_end IS NOT NULL AND v_end NOT IN ('done', 'gone');

    UPDATE public.exec_follows AS f
       SET last_seen_status = COALESCE(v_s, f.last_seen_status),
           last_seen_at     = now(),
           ended_at         = CASE WHEN v_end IS NOT NULL THEN now() END,
           ended_reason     = v_end
     WHERE f.user_id = _user_id
       AND f.municipality_id = _municipality_id
       AND f.item_kind = v_kind
       AND f.item_id = v_id
       AND f.ended_at IS NULL;
    GET DIAGNOSTICS v_one = ROW_COUNT;
    v_n := v_n + v_one;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_digest_ack(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_digest_ack(uuid, uuid, jsonb) TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════════
-- service_role: คะแนนคำร้อง ≤ 2 ที่ยังอยู่ในหน้าต่างแจ้ง
-- ══════════════════════════════════════════════════════════════════════════════════
-- คืนแถวเรียงเก่าสุดก่อน ≤ 500 · ย้อนไม่เกิน 7 วัน (since เก่ากว่านั้นถูกตัด)
-- source = proxy (สท. บันทึกแทน) | verified (ผู้ยื่นล็อกอินประเมินเอง) | via_link (ผู้ถือลิงก์ติดตาม) | linked_anon
--          ลำดับเดียวกับ exec_summary_satisfaction (E2)
-- หมวดอ่อนไหว: ref/cat/cat_label = NULL (เหลือกอง + คะแนน) · ไม่มี comment ไม่มีชื่อผู้ประเมิน
CREATE OR REPLACE FUNCTION public.exec_low_ratings_pending(_since timestamptz)
RETURNS TABLE (
  municipality_id uuid,
  rating_id       uuid,
  rating          smallint,
  source          text,
  rated_at        timestamptz,
  sensitive       boolean,
  ref             text,
  cat_label       text,
  dept            text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'ใช้ได้เฉพาะงานอัตโนมัติของระบบ' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.municipality_id,
         s.id,
         s.rating::smallint,
         CASE
           WHEN COALESCE(s.rated_by_proxy, false) THEN 'proxy'
           WHEN COALESCE(s.is_verified, false) THEN 'verified'
           WHEN COALESCE(s.via_link, false) THEN 'via_link'
           ELSE 'linked_anon'
         END,
         s.created_at,
         COALESCE(cat.requires_manual_intake, false) IS NOT FALSE,
         CASE WHEN COALESCE(cat.requires_manual_intake, false) IS NOT FALSE THEN NULL
              ELSE COALESCE(NULLIF(btrim(c.ref_no), ''), upper(left(c.id::text, 8))) END,
         CASE WHEN COALESCE(cat.requires_manual_intake, false) IS NOT FALSE THEN NULL ELSE cat.label END,
         COALESCE(NULLIF(btrim(dp.short_name), ''), dp.name)
  FROM public.satisfaction_ratings AS s
  JOIN public.complaints AS c
    ON c.id = s.complaint_id AND c.municipality_id = s.municipality_id
  LEFT JOIN public.complaint_categories AS cat
    ON cat.municipality_id = c.municipality_id AND cat.value = c.category
  LEFT JOIN public.departments AS dp
    ON dp.id = public.exec_complaint_dept(c.municipality_id, c.department_id, c.department)
   AND dp.municipality_id = c.municipality_id
  WHERE s.complaint_id IS NOT NULL
    AND s.rating <= 2
    AND s.created_at >= GREATEST(COALESCE(_since, now() - interval '7 days'), now() - interval '7 days')
  ORDER BY s.created_at, s.id
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_low_ratings_pending(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_low_ratings_pending(timestamptz) TO service_role;

-- ── ด่านท้ายไฟล์ (ล้ม = ย้อนกลับทั้งไฟล์) ──────────────────────────────────────────────
-- 1) เจ้าของต้องเดียวกับ executive_overview (บทเรียน E3-2: apply คนละ role แล้ว DEFINER เรียกฟังก์ชันภายในไม่ได้)
-- 2) สิทธิ์ EXECUTE ต้องตรงตามแผน — REVOKE ที่ grantor ไม่ตรงผ่านเงียบๆ แต่สิทธิ์ยังอยู่
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.proname || ' (' || p.proowner::regrole::text || ')', ', ')
    INTO v_bad
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (p.proname LIKE 'exec\_%' OR p.proname = 'set_my_telegram_dm_muted')
    AND p.proowner <> (SELECT o.proowner FROM pg_proc AS o
                       WHERE o.oid = 'public.executive_overview(uuid,date,date,text[])'::regprocedure);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'exec_digest_functions: เจ้าของฟังก์ชันไม่ตรงกับ executive_overview: %', v_bad;
  END IF;

  SELECT string_agg(x.fn || ':' || x.rol, ', ')
    INTO v_bad
  FROM (VALUES
    ('public.exec_my_esign_waiting(uuid)',               'anon',          false),
    ('public.exec_my_esign_waiting(uuid)',               'authenticated', true),
    ('public.exec_digest_recipients(text)',              'anon',          false),
    ('public.exec_digest_recipients(text)',              'authenticated', false),
    ('public.exec_digest_recipients(text)',              'service_role',  true),
    ('public.exec_digest_for(uuid,uuid)',                'anon',          false),
    ('public.exec_digest_for(uuid,uuid)',                'authenticated', false),
    ('public.exec_digest_for(uuid,uuid)',                'service_role',  true),
    ('public.exec_digest_ack(uuid,uuid,jsonb)',          'anon',          false),
    ('public.exec_digest_ack(uuid,uuid,jsonb)',          'authenticated', false),
    ('public.exec_digest_ack(uuid,uuid,jsonb)',          'service_role',  true),
    ('public.exec_low_ratings_pending(timestamptz)',     'anon',          false),
    ('public.exec_low_ratings_pending(timestamptz)',     'authenticated', false),
    ('public.exec_low_ratings_pending(timestamptz)',     'service_role',  true),
    ('public.exec_esign_waiting_core(uuid)',             'anon',          false),
    ('public.exec_esign_waiting_core(uuid)',             'authenticated', false),
    ('public.exec_esign_waiting_core(uuid)',             'service_role',  false),
    ('public.exec_digest_eligible(uuid,uuid)',           'anon',          false),
    ('public.exec_digest_eligible(uuid,uuid)',           'authenticated', false),
    ('public.exec_digest_eligible(uuid,uuid)',           'service_role',  false),
    ('public.exec_working_days_after(date,date,uuid)',   'anon',          false),
    ('public.exec_working_days_after(date,date,uuid)',   'authenticated', false),
    ('public.exec_working_days_after(date,date,uuid)',   'service_role',  false),
    ('public.set_my_telegram_dm_muted(text[])',          'anon',          false),
    ('public.set_my_telegram_dm_muted(text[])',          'authenticated', true)
  ) AS x(fn, rol, want)
  WHERE has_function_privilege(x.rol, x.fn, 'EXECUTE') IS DISTINCT FROM x.want;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'exec_digest_functions: สิทธิ์ EXECUTE ไม่ตรงแผน: %', v_bad;
  END IF;

  -- 3) เจ้าของ (ผู้รันฟังก์ชัน DEFINER) ต้องเรียกฟังก์ชันปลายทางได้ — add_working_days ถูกถอนจาก PUBLIC ไว้
  --    และไม่เคยมี exec_* ตัวไหนเรียกมาก่อน ถ้าไม่ได้ จะล้ม 42501 ตอนใช้งานจริง ไม่ใช่ตอน apply
  SELECT string_agg(d, ', ')
    INTO v_bad
  FROM unnest(ARRAY[
    'public.add_working_days(date,integer,uuid)', 'public.esign_my_pending()',
    'public.list_events_for_staff_between(uuid,date,date)', 'public.list_events_for_staff(uuid)'
  ]) AS d
  WHERE NOT has_function_privilege(
    (SELECT o.proowner FROM pg_proc AS o WHERE o.oid = 'public.executive_overview(uuid,date,date,text[])'::regprocedure),
    d, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'exec_digest_functions: เจ้าของเรียก % ไม่ได้', v_bad;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
