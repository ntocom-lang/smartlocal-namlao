-- 20261116100000_exec_review_fixes.sql
--
-- ห้องผู้บริหาร E2.1 — แก้ 2 ข้อจาก code review ของ PR #685
-- เขียนทับฟังก์ชันเดิม 2 ตัวด้วย CREATE OR REPLACE "เนื้อเต็มทั้งตัว" (ข้อ 5 NOTES.md) — ชื่อ/อาร์กิวเมนต์/ชนิดผลลัพธ์เดิม หน้าเว็บไม่ต้องแก้
--
-- 1) exec_village_label (เดิมใน 20261115100100)
--    เดิม: รูปแบบเลขหมู่รับเฉพาะ "หมู่3 / หมู่ 3 / หมู่ที่ 3 / ม.3" — ข้อความต่อไปนี้ตกเป็น "ไม่อยู่ในทะเบียน" ทั้งที่เป็นเลขหมู่ล้วน
--          - "หมู่ ที่ 3" (เว้นวรรคก่อน "ที่")
--          - สระอู/ไม้เอก หรือ สระอี/ไม้เอก พิมพ์สลับลำดับ (แสดงผลเหมือนกันทุกตัวอักษร แต่เป็นคนละรหัส)
--          - มีอักขระล่องหนติดมา (ZWSP/ZWJ/ZWNJ/BOM จากการคัดลอกข้อความ, NBSP)
--          - "ม 3" (ไม่มีจุด)
--          และถ้าทะเบียนตั้งชื่อ "หมู่ที่ 1" ไว้ คำร้องที่พิมพ์ "หมู่ที่ 1" ได้ป้าย "หมู่ที่ 1" แต่ที่พิมพ์ "หมู่ 1" ได้ "หมู่ 1" → หมู่เดียวแตก 2 กลุ่ม
--    ใหม่: ตัดอักขระล่องหนก่อน (ทั้งข้อความคำร้องและชื่อในทะเบียน — ค่าที่เลือกจากรายการต้องยังตรงกับทะเบียน)
--          → รูปแบบเลขหมู่ล้วนเป็น 'หมู่ N' ก่อนเทียบทะเบียน → ชื่อในทะเบียน → ที่เหลือ '' (นับเป็นตัวเลขอย่างเดียว)
--    ความปลอดภัยเดิมคงอยู่: คืนเฉพาะชื่อในทะเบียนที่แอดมินตั้ง หรือ 'หมู่ ' + ตัวเลข ไม่มีทางคืนข้อความที่ผู้แจ้งพิมพ์เอง
--
-- 2) exec_summary_fleet (เดิมใน 20261115100200)
--    เดิม: รอบ = next_service_date ของบันทึกล่าสุด "ที่ตั้งรอบไว้" (ทุกประเภทปนกัน) แล้วล้างรอบถ้ามีบันทึกใดๆ ลงวันที่ ≥ วันรอบ
--          - บันทึกประเภทอื่น (ซ่อมแซม/ยาง/แบตเตอรี่) หลังวันรอบ ล้างรอบบำรุงรักษาทิ้ง → ไม่เตือน
--          - แถวที่ตั้งวันรอบ ≤ วันที่ซ่อมของตัวเอง ชนกับตัวเอง → ไม่เตือน
--          - บันทึกประเภทอื่นที่ตั้งรอบไว้ทีหลัง (เช่น ยาง ตั้งรอบปีหน้า) กลายเป็น "รอบของรถ" แทน → รอบบำรุงรักษาที่ใกล้กว่าหาย
--          - บำรุงรักษาก่อนถึงรอบโดยไม่ตั้งรอบใหม่ ไม่ล้างรอบเดิม → เตือนเกินจริง
--    ใหม่: นับรอบแยก "รถ × ประเภทงาน" (maintenance_type) — ดูบันทึกล่าสุดของประเภทนั้น
--          ตั้ง next_service_date ไว้ = รอบที่ยังค้าง · ไม่ได้ตั้ง = ทำรอบนั้นแล้ว (ไม่มีรอบค้างของประเภทนี้)
--          บันทึกประเภทอื่นไม่ล้างรอบ · ไม่มีการเทียบกับตัวเอง (ไม่มี NOT EXISTS แล้ว)
--          overdue / due_soon นับเป็น "คัน" (คันเดียวเลยหลายประเภทนับ 1) · due_soon ไม่นับคันที่เลยกำหนดอยู่แล้ว (สองตัวเลขไม่ซ้อนกัน)
--          ใช้วันที่อย่างเดียว ไม่ใช้เลขไมล์ (เลขไมล์พิมพ์ผิดลามได้ #170) — เหมือนเดิม
--    กรณีระบบตัดสินผิดที่ยังเหลือ: เจ้าหน้าที่บันทึกรอบถัดไปเป็นคนละประเภทกับรอบเดิม (ตั้งรอบไว้ที่ "บำรุงรักษา" แต่ลงงานจริงเป็น
--          "เปลี่ยนถ่ายน้ำมัน") → ยังขึ้นเลยกำหนด · ผู้บริหารเห็น → งานยานพาหนะเปิดบันทึกเดิมแล้วลบ "วันซ่อมถัดไป" ออก (แก้ได้ในหน้าเดิม)
--          เลือกให้ผิดทาง "เตือนเกิน" ที่แก้ได้ ดีกว่า "ไม่เตือน" ที่ไม่มีใครเห็น
--
-- ไม่มี ADD COLUMN / CREATE TABLE (ข้อ 3 NOTES.md) · สิทธิ์: CREATE OR REPLACE ไม่แตะ ACL เดิม + REVOKE ซ้ำท้ายไฟล์กันพลาด
-- ด่านหัวไฟล์: เนื้อฟังก์ชันบนฐานต้องเป็นรุ่นใน 20261115100100/100200 หรือรุ่นในไฟล์นี้ (รันซ้ำได้) — ไม่ตรง = หยุด ห้ามเขียนทับ (ข้อ 5 NOTES.md)
--   ลายนิ้วมือ = md5(replace(prosrc, E'\r', '')) — ตัด \r เพราะไฟล์ที่ apply จากเครื่อง Windows อาจเป็น CRLF
-- ย้อนกลับ: รันส่วน CREATE OR REPLACE ของ exec_village_label จาก 20261115100100 และ exec_summary_fleet จาก 20261115100200 ซ้ำ
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT public.exec_village_label(NULL, v) FROM (VALUES ('หมู่ ที่ 3'), ('ม 3'), ('หมู่ 3 บ้านนายดำ')) AS t(v);  → 'หมู่ 3', 'หมู่ 3', ''
--   SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
--   FROM pg_proc p WHERE p.oid IN ('public.exec_village_label(uuid,text)'::regprocedure, 'public.exec_summary_fleet(uuid,date,date)'::regprocedure);
--   → false / false ทั้งสองแถว

DO $$
DECLARE
  v_bad text;
BEGIN
  IF to_regprocedure('public.exec_village_label(uuid,text)') IS NULL
     OR to_regprocedure('public.exec_summary_fleet(uuid,date,date)') IS NULL
     OR to_regprocedure('public.executive_overview(uuid,date,date,text[])') IS NULL THEN
    RAISE EXCEPTION 'exec_review_fixes: ต้อง apply 20261115100000–20261115100200 ก่อน';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = 'fleet_maintenance' AND c.column_name = 'maintenance_type'
  ) THEN
    RAISE EXCEPTION 'exec_review_fixes: ไม่พบคอลัมน์ fleet_maintenance.maintenance_type';
  END IF;

  -- ลายนิ้วมือ: [รุ่นเดิมจาก PR #685, รุ่นในไฟล์นี้] — ค่าที่ 2 ตรวจกับเทสต์ PGlite (tests/executive-summary-db.test.mjs)
  SELECT string_agg(x.fn || ' (' || md5(replace(p.prosrc, E'\r', '')) || ')', ', ')
    INTO v_bad
  FROM (VALUES
    ('exec_village_label', 'public.exec_village_label(uuid,text)', '4b0062db0add791a7e9b243a3b1cb184', 'fcefeb5fdad4aee4517724bffc65a49b'),
    ('exec_summary_fleet', 'public.exec_summary_fleet(uuid,date,date)', '64c51ced51b1054d6f951c31508f4d06', 'a212d7e5a3034e64d753e94b5cec2c92')
  ) AS x(fn, sig, md5_old, md5_new)
  JOIN pg_proc AS p ON p.oid = to_regprocedure(x.sig)
  WHERE md5(replace(p.prosrc, E'\r', '')) NOT IN (x.md5_old, x.md5_new);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'exec_review_fixes: เนื้อฟังก์ชันบนฐานไม่ตรงกับรุ่นในรีโป (มีคนแก้ทับ?) — หยุดหาสาเหตุก่อน: %', v_bad;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- ชื่อหมู่บ้านที่ "ปลอดภัยพอจะแสดง" ของคำร้อง (SECURITY INVOKER — เรียกจาก exec_summary_complaints ซึ่งรันเป็นเจ้าของ)
-- ══════════════════════════════════════════════════════════════════════════════════
-- complaints.village เป็นข้อความที่ผู้แจ้งพิมพ์เองได้ถึง 250 ตัวอักษร (CitizenForm.jsx: อปท. ที่ยังไม่ตั้งทะเบียนสถานที่
-- หรือผู้แจ้งเลือก "ไม่อยู่ในรายการ") อาจมีชื่อคน/บ้านเลขที่/เบอร์
--   ขั้น 0  ตัดอักขระล่องหน (U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM) · NBSP (U+00A0) เป็นช่องว่าง · ตัดช่องว่างหัวท้าย
--   ขั้น 1  ทั้งช่องเป็นเลขหมู่ล้วน → 'หมู่ N' (N เลขอารบิก ตัดศูนย์นำหน้า) — ไม่มีข้อความอื่นปน จึงไม่มีข้อมูลส่วนบุคคล
--           คำนำรับ: หมู่ / หมู่ที่ / หมู่ ที่ / ม. / ม  (สระอู–ไม้เอก และ สระอี–ไม้เอก รับทั้งสองลำดับการพิมพ์)
--           ตัวเลข 1–2 หลัก อารบิกหรือไทย
--   ขั้น 2  ตรงกับชื่อในทะเบียน locations ของ อปท. นี้ (ผ่านขั้น 0 ทั้งสองฝั่ง) → ชื่อนั้น
--   ไม่เข้าเงื่อนไข → '' (หน้าจอนับเป็น "ไม่อยู่ในทะเบียน" เป็นตัวเลขอย่างเดียว) · ว่าง → NULL
-- รหัสสระ/วรรณยุกต์เขียนเป็น \uXXXX ใน regex เพื่อไม่ให้ลำดับการพิมพ์ในไฟล์นี้เองเพี้ยน:
--   U+0E39 สระอู · U+0E35 สระอี · U+0E48 ไม้เอก
CREATE OR REPLACE FUNCTION public.exec_village_label(_municipality_id uuid, _village text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN s.v IS NULL THEN NULL
    WHEN s.v ~ '^(หม(\u0E39\u0E48|\u0E48\u0E39)(\s*ท(\u0E35\u0E48|\u0E48\u0E35))?|ม\.?)\s*[0-9๐-๙]{1,2}$' THEN
      -- ::int::text ให้ "หมู่ 03" กับ "หมู่ 3" เป็นกลุ่มเดียวกัน (1–2 หลักตาม regex ข้างบน แปลงได้เสมอ)
      'หมู่ ' || translate(substring(s.v FROM '[0-9๐-๙]{1,2}$'), '๐๑๒๓๔๕๖๗๘๙', '0123456789')::int::text
    WHEN EXISTS (
      SELECT 1 FROM public.locations AS l
      WHERE l.municipality_id = _municipality_id
        AND btrim(regexp_replace(regexp_replace(l.name, '[\u200B\u200C\u200D\uFEFF]', '', 'g'), '\u00A0', ' ', 'g')) = s.v
    ) THEN s.v
    ELSE ''
  END
  FROM (
    SELECT NULLIF(btrim(regexp_replace(regexp_replace(_village, '[\u200B\u200C\u200D\uFEFF]', '', 'g'), '\u00A0', ' ', 'g')), '') AS v
  ) AS s
$$;

-- ══════════════════════════════════════════════════════════════════════════════════
-- ยานพาหนะ
-- ══════════════════════════════════════════════════════════════════════════════════
-- maintenance: เฉพาะรถ status active · รอบนับแยก (รถ, maintenance_type) จากบันทึกล่าสุดของประเภทนั้น
--   (เรียง service_date → created_at → id ล่าสุดก่อน) — ตั้ง next_service_date = รอบค้าง · ไม่ตั้ง = ทำรอบแล้ว
--   overdue       = จำนวนคันที่มีรอบค้างก่อนวันนี้อย่างน้อย 1 ประเภท
--   oldest_due_on = วันรอบที่ค้างนานสุดในบรรดารอบที่เลยกำหนด
--   due_soon      = จำนวนคันที่มีรอบค้างในวันนี้ถึงอีก 14 วัน และไม่มีรอบที่เลยกำหนดแล้ว (ไม่นับซ้อนกับ overdue)
--   ใช้วันที่อย่างเดียว ไม่ใช้เลขไมล์ (เลขไมล์พิมพ์ผิดลามได้ #170 — ใช้ตัดสินเตือนไม่ได้)
-- incidents: เหตุที่เกิด (incident_date หรือวันรับแจ้งถ้าไม่ระบุวันเกิด) ในช่วงที่เลือก แยก damage (เสียหาย) / loss (สูญหาย)
CREATE OR REPLACE FUNCTION public.exec_summary_fleet(_municipality_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Bangkok')::date;
  v_maint jsonb;
  v_inc   jsonb;
BEGIN
  PERFORM public.exec_assert_viewer(_municipality_id);
  IF _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 400 วัน)' USING ERRCODE = '22023';
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (m.vehicle_id, COALESCE(m.maintenance_type, 'routine'))
           m.vehicle_id, m.next_service_date
    FROM public.fleet_maintenance AS m
    JOIN public.fleet_vehicles AS v ON v.id = m.vehicle_id
    WHERE m.municipality_id = _municipality_id
      AND v.municipality_id = _municipality_id
      AND v.status = 'active'
    ORDER BY m.vehicle_id, COALESCE(m.maintenance_type, 'routine'), m.service_date DESC, m.created_at DESC, m.id DESC
  ), per_vehicle AS (
    SELECT l.vehicle_id,
           min(l.next_service_date) FILTER (WHERE l.next_service_date < v_today) AS overdue_since,
           COALESCE(bool_or(l.next_service_date BETWEEN v_today AND v_today + 14), false) AS soon
    FROM latest AS l
    WHERE l.next_service_date IS NOT NULL
    GROUP BY l.vehicle_id
  )
  SELECT jsonb_build_object(
           'overdue',       count(*) FILTER (WHERE p.overdue_since IS NOT NULL),
           'oldest_due_on', min(p.overdue_since),
           'due_soon',      count(*) FILTER (WHERE p.overdue_since IS NULL AND p.soon)
         )
    INTO v_maint
  FROM per_vehicle AS p;

  SELECT jsonb_build_object(
           'damage', count(*) FILTER (WHERE i.incident_kind = 'damage'),
           'loss',   count(*) FILTER (WHERE i.incident_kind = 'loss')
         )
    INTO v_inc
  FROM public.fleet_incidents AS i
  WHERE i.municipality_id = _municipality_id
    AND COALESCE(i.incident_date, i.report_date) BETWEEN _from AND _to;

  RETURN jsonb_build_object('maintenance', v_maint, 'incidents', v_inc);
END;
$$;

-- ── สิทธิ์: เหมือนเดิม — ตัวช่วย/ฟังก์ชันย่อยเรียกผ่าน executive_overview() เท่านั้น ──────────────
REVOKE ALL ON FUNCTION public.exec_village_label(uuid, text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exec_summary_fleet(uuid, date, date)   FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.exec_village_label(uuid, text) IS
  'ห้องผู้บริหาร (ภายใน): ชื่อหมู่ที่แสดงได้ — เลขหมู่ล้วน (หมู่/หมู่ที่/หมู่ ที่/ม./ม + 1–2 หลัก, สระ-วรรณยุกต์สลับลำดับได้, ตัดอักขระล่องหน) '
  'เป็น ''หมู่ N'' ก่อน แล้วจึงชื่อในทะเบียน locations · ข้อความอื่น = '''' · ไม่คืนข้อความที่ผู้แจ้งพิมพ์เอง (E2.1)';
COMMENT ON FUNCTION public.exec_summary_fleet(uuid, date, date) IS
  'ห้องผู้บริหาร: ยานพาหนะ — เลยรอบซ่อมบำรุง (นับแยกรถ×ประเภทงานจากบันทึกล่าสุดของประเภทนั้น ตามวันที่) '
  '+ เหตุเสียหาย/สูญหายในช่วง · ไม่มีงบน้ำมัน (#501) (E2.1)';

-- ด่านท้ายไฟล์: เจ้าของต้องเดียวกับ executive_overview (เหตุผลดูท้ายไฟล์ 20261115100100)
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.proname || ' (' || p.proowner::regrole::text || ')', ', ')
    INTO v_bad
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'exec\_%'
    AND p.proowner <> (SELECT o.proowner FROM pg_proc AS o
                       WHERE o.oid = 'public.executive_overview(uuid,date,date,text[])'::regprocedure);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'exec_review_fixes: เจ้าของฟังก์ชันไม่ตรงกับ executive_overview: %', v_bad;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
