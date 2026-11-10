// ห้องผู้บริหาร เฟส E2 — executive_overview() + exec_summary_*() · รัน migration จริง 3 ไฟล์ + ไฟล์แก้ E2.1 อีก 2 ไฟล์ใน PGlite ไม่ใช้เน็ต ไม่แตะข้อมูลจริง
//   ในเครื่อง: node tests/executive-summary-db.test.mjs --pglite <temp>/node_modules/@electric-sql/pglite/dist/index.js
//   CI (patient-module-tests.yml): อ่าน path จาก env PATIENT_PGLITE_MODULE (PGlite 0.5.8 ติดตั้งนอก repo) ไม่ต้องส่ง --pglite
// ตารางจำลองมีเฉพาะคอลัมน์ที่ฟังก์ชันอ่าน + คอลัมน์ข้อมูลส่วนบุคคลปลอม เพื่อตรวจว่า "ไม่หลุดออกมา"
// ตัวเลขคาดหวังทุกตัวคิดมือจากข้อมูลตัวอย่างด้านล่าง (คอมเมนต์กำกับแต่ละแถว) — T = วันนี้ตามเวลาไทย
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const argIndex = process.argv.indexOf('--pglite')
const modulePath = (argIndex >= 0 ? process.argv[argIndex + 1] : null) || process.env.PATIENT_PGLITE_MODULE
assert.ok(modulePath, 'ต้องระบุ --pglite <path ของ pglite/dist/index.js> หรือ env PATIENT_PGLITE_MODULE')
const { PGlite } = await import(pathToFileURL(modulePath).href)
const files = [
  '20261115100000_exec_access_overview.sql',
  '20261115100100_exec_summary_service.sql',
  '20261115100200_exec_summary_operations.sql',
]
// E2.1 (code review PR #685) — ลงหลังข้อมูลทดสอบ เพื่อยืนยันก่อนว่ารุ่นเดิมพลาดกับข้อมูลชุดนี้จริง แล้วค่อยตรวจรุ่นใหม่
const fixFiles = [
  '20261116100000_exec_review_fixes.sql',
  '20261116100100_list_events_for_staff_between.sql',
]
const migration = (f) => readFile(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MA = id(1), MB = id(2)
const U = {
  viewerA: id(101), paladA: id(102), officerA: id(103), citizenA: id(104), viewerB: id(105),
  superadmin: id(106), adminA: id(107), councilA: id(108), paladStaffA: id(109), citizenNoMuni: id(110),
  officerNoPos: id(111), staffNoPos: id(112),
}
const P_TOP = id(201), P_HEAD = id(202)
const D1 = id(301), D2 = id(302), D3 = id(303), D4 = id(304)
const PII = { name: 'สมชาย ทดสอบปลอม', phone: '0812345678', patient: 'ผู้ป่วยปลอม นามสมมติ' }

const db = new PGlite()
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE evil;
GRANT USAGE ON SCHEMA public TO anon, authenticated, evil;
GRANT CREATE ON SCHEMA public TO evil;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE TABLE public.positions (id uuid PRIMARY KEY, category text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, municipality_id uuid, position_id uuid, department_id uuid, full_name text);
CREATE TABLE public.departments (id uuid PRIMARY KEY, municipality_id uuid, name text, short_name text, code text, sort_order int, is_active boolean);
CREATE TABLE public.locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, name text);
CREATE TABLE public.complaint_categories (municipality_id uuid, value text, label text, is_adhoc boolean NOT NULL DEFAULT false,
  requires_manual_intake boolean NOT NULL DEFAULT false);
CREATE TABLE public.complaints (id uuid PRIMARY KEY, municipality_id uuid, status text, created_at timestamptz, closed_at timestamptz,
  due_date date, assigned_to uuid, resolved_by uuid, department_id uuid, channel text DEFAULT 'citizen_online', village text,
  category text, parked_reason text, rating smallint, user_id uuid, reporter_name text, phone text, department text);
CREATE TABLE public.complaint_timeline (complaint_id uuid, status text, created_at timestamptz);
CREATE TABLE public.document_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, document_type text,
  status text, created_at timestamptz, issued_at timestamptz, due_date date, department_id uuid, created_by_uid uuid, requester_name text);
CREATE TABLE public.satisfaction_ratings (municipality_id uuid, complaint_id uuid, rating smallint, is_verified boolean DEFAULT false,
  via_link boolean DEFAULT false, rated_by_proxy boolean DEFAULT false, created_at timestamptz, comment text);
CREATE TABLE public.patient_booking_trips (id uuid PRIMARY KEY, municipality_id uuid, state text, booking_ids uuid[] NOT NULL);
CREATE TABLE public.patient_bookings (id uuid PRIMARY KEY, municipality_id uuid, service_type text, status text, appointment_at timestamptz, trip_id uuid, patient_name text);
CREATE TABLE public.fleet_vehicles (id uuid PRIMARY KEY, municipality_id uuid, status text);
CREATE TABLE public.fleet_maintenance (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), municipality_id uuid, vehicle_id uuid,
  service_date date, maintenance_type text NOT NULL DEFAULT 'routine', next_service_date date, created_at timestamptz DEFAULT now());
CREATE TABLE public.fleet_incidents (municipality_id uuid, incident_kind text, incident_date date, report_date date);
CREATE TABLE public.asset_borrow_requests (municipality_id uuid, workflow_status text, created_at timestamptz, return_due_date date);
CREATE TABLE public.civil_projects (id uuid PRIMARY KEY, municipality_id uuid, stage text, end_date date);
CREATE TABLE public.civil_project_contracts (project_id uuid PRIMARY KEY, extended_until date, notice_to_proceed_date date, finish_within_days int);
CREATE TABLE public.civil_project_changes (project_id uuid, kind text, decision text, new_end_date date, created_at timestamptz);
CREATE TABLE public.civil_weekly_reports (project_id uuid, status text, frozen jsonb, period_end date, week_no int);
CREATE TABLE public.local_op_plans (municipality_id uuid, status text, kind text, fiscal_year smallint, published_on date);
CREATE TABLE public.local_dev_plans (municipality_id uuid, status text);
CREATE TABLE public.water_announcements (municipality_id uuid, status text, drafted_at timestamptz, event_id uuid);
CREATE TABLE public.water_events (id uuid PRIMARY KEY, municipality_id uuid, opened_at timestamptz, closed_at timestamptz);
CREATE TABLE public.water_announcement_settings (municipality_id uuid PRIMARY KEY, enabled boolean NOT NULL DEFAULT false);

-- ปฏิทินกิจกรรม: จำลองรูปร่างคำตอบของ list_events_for_staff ตัวจริง (to_jsonb ของแถว + คีย์เสริม) กับด่านแบบย่อ (อปท. เดียวกัน/superadmin)
-- กติกาการมองเห็นจริงตรวจกับตัวจริงใน tests/event-assignments-db.test.mjs (ตัวห่อเรียกตัวจริงเสมอ ไม่มีกติกาของตัวเอง)
CREATE TABLE public.events (id uuid PRIMARY KEY, municipality_id uuid, title text, description text, event_date date NOT NULL,
  end_date date, event_time time, attachment_urls text[] NOT NULL DEFAULT '{}');
CREATE FUNCTION public.list_events_for_staff(p_municipality_id uuid) RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public AS $$
  SELECT to_jsonb(e) || jsonb_build_object('can_view_detail', true, 'has_attachment', cardinality(e.attachment_urls) > 0,
           'creator', jsonb_build_object('full_name', 'ผู้สร้างปลอม'), 'assignments', '[]'::jsonb)
  FROM public.events AS e JOIN public.profiles AS a ON a.id = auth.uid()
  WHERE e.municipality_id = p_municipality_id AND (a.role = 'superadmin' OR a.municipality_id = p_municipality_id)
  ORDER BY e.event_date, e.event_time NULLS LAST $$;
REVOKE ALL ON FUNCTION public.list_events_for_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_events_for_staff(uuid) TO authenticated;

-- ตัวช่วยวันที่: T = วันนี้เวลาไทย · ts(d) = 10:00 น. ของวัน T−d · dt(d) = วัน T−d (d ติดลบ = อนาคต)
CREATE FUNCTION public.t0() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date $$;
CREATE FUNCTION public.ts(d int) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT ((public.t0() - d)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Bangkok' $$;
CREATE FUNCTION public.dt(d int) RETURNS date LANGUAGE sql STABLE AS $$ SELECT public.t0() - d $$;
`)

for (const f of files) {
  await db.exec(await migration(f))
}

const C = n => id(1000 + n)
const EV = n => id(7000 + n)
const V = n => id(2000 + n)
const PR = n => id(3000 + n)
const TR = n => id(4000 + n)
const B = n => id(5000 + n)
await db.exec(`
INSERT INTO public.positions VALUES ('${P_TOP}', 'top_admin'), ('${P_HEAD}', 'dept_head');
INSERT INTO public.profiles VALUES
  ('${U.viewerA}', 'viewer', '${MA}', NULL, NULL, 'นายกปลอม'),
  ('${U.paladA}', 'officer', '${MA}', '${P_TOP}', NULL, 'ปลัดปลอม'),
  ('${U.officerA}', 'officer', '${MA}', '${P_HEAD}', '${D1}', 'ผอ.ปลอม'),
  ('${U.citizenA}', 'citizen', '${MA}', NULL, NULL, '${PII.name}'),
  ('${U.viewerB}', 'viewer', '${MB}', NULL, NULL, 'นายก B'),
  ('${U.superadmin}', 'superadmin', NULL, NULL, NULL, 'เจ้าของระบบ'),
  ('${U.adminA}', 'admin', '${MA}', NULL, NULL, 'แอดมิน'),
  ('${U.councilA}', 'council', '${MA}', NULL, NULL, 'สท.ปลอม'),
  ('${U.paladStaffA}', 'staff', '${MA}', '${P_TOP}', NULL, 'รองปลัด role staff'),
  ('${U.citizenNoMuni}', 'citizen', NULL, '${P_TOP}', NULL, 'ประชาชนที่ตำแหน่งเพี้ยน'),
  -- ถดถอย: ไม่มีตำแหน่ง (category NULL) เคยหลุดด่านเพราะ NOT (false OR NULL) = NULL
  ('${U.officerNoPos}', 'officer', '${MA}', NULL, '${D1}', 'officer ไม่มีตำแหน่ง'),
  ('${U.staffNoPos}', 'staff', '${MA}', NULL, NULL, 'staff ไม่มีตำแหน่ง');
INSERT INTO public.departments VALUES
  ('${D1}', '${MA}', 'กองช่าง', 'ช่าง', 'engineering', 1, true), ('${D2}', '${MA}', 'สำนักปลัด', 'ปลัด', 'palad', 2, true),
  ('${D3}', '${MA}', 'กองเก่า', 'เก่า', 'old', 9, false), ('${D4}', '${MA}', 'กองคลัง', 'คลัง', 'finance', 3, true);
-- ทะเบียนสถานที่ที่แอดมินตั้ง (ไม่มี unique บนชื่อในของจริง — ใส่ชื่อซ้ำไว้ตรวจว่าไม่นับซ้ำ)
INSERT INTO public.locations (municipality_id, name) VALUES ('${MA}', 'หมู่ 1'), ('${MA}', 'หมู่ 1'), ('${MA}', 'บ้านดอน'), ('${MB}', 'หน้าบ้านนายสมชาย ทดสอบปลอม 0812345678'),
  -- E2.1: ทะเบียนตั้งชื่อแบบ "หมู่ที่ 9" · ชื่อมีอักขระล่องหนติดมาจากการคัดลอก (ZWSP)
  ('${MA}', 'หมู่ที่ 9'), ('${MA}', 'บ้านนาเลา'), ('${MA}', 'บ้านห้วย\u200Bหลวง');
INSERT INTO public.complaint_categories (municipality_id, value, label, is_adhoc, requires_manual_intake) VALUES
  ('${MA}', 'road', 'ถนนชำรุด', false, false), ('${MA}', 'light', 'ไฟฟ้าดับ', false, false),
  ('${MA}', 'odor', 'กลิ่นเหม็น', true, false), ('${MA}', 'corrupt', 'ร้องเรียนเจ้าหน้าที่', false, true);

-- คำร้อง อปท. A (ช่วงทดสอบ = T−30 .. T)
INSERT INTO public.complaints (id, municipality_id, status, created_at, closed_at, due_date, assigned_to, resolved_by, department_id,
  channel, village, category, parked_reason, rating, user_id, reporter_name, phone) VALUES
  ('${C(1)}', '${MA}', 'in_progress', ts(10), NULL, dt(3), '${U.officerA}', NULL, '${D1}', 'citizen_online', 'หมู่ 1', 'road', NULL, NULL, '${U.citizenA}', '${PII.name}', '${PII.phone}'),
  ('${C(2)}', '${MA}', 'closed', ts(8), ts(2), dt(1), '${U.officerA}', '${U.officerA}', '${D1}', 'citizen_online', 'หมู่ 1', 'road', NULL, 5, '${U.citizenA}', '${PII.name}', '${PII.phone}'),
  ('${C(3)}', '${MA}', 'closed', ts(9), ts(1), dt(4), '${U.officerA}', '${U.officerA}', '${D1}', 'citizen_online', 'หมู่ 1', 'road', NULL, NULL, '${U.councilA}', 'x', 'x'),
  ('${C(4)}', '${MA}', 'pending', ts(5), NULL, dt(2), NULL, NULL, '${D2}', 'oss_counter', 'หมู่ที่ ๒', 'light', NULL, NULL, NULL, 'x', 'x'),
  ('${C(5)}', '${MA}', 'pending', ts(3), NULL, dt(5), NULL, NULL, '${D2}', 'citizen_online', 'หมู่ 1', 'odor', NULL, NULL, NULL, 'x', 'x'),
  ('${C(6)}', '${MA}', 'received', ts(4), NULL, dt(1), '${U.officerA}', NULL, '${D2}', 'citizen_online', 'หมู่ 1', 'corrupt', NULL, NULL, NULL, 'x', 'x'),
  ('${C(7)}', '${MA}', 'parked', ts(20), NULL, dt(10), NULL, NULL, '${D1}', 'citizen_online', 'หมู่ 1', 'road', 'budget', NULL, NULL, 'x', 'x'),
  ('${C(8)}', '${MA}', 'rejected', ts(6), NULL, dt(4), NULL, NULL, '${D1}', 'citizen_online', 'หมู่ 1', 'road', NULL, NULL, NULL, 'x', 'x'),
  ('${C(9)}', '${MA}', 'done', ts(12), ts(1), dt(6), '${U.officerA}', NULL, '${D1}', 'citizen_online', ' หมู่ 1 ', 'road', NULL, 3, NULL, 'x', 'x'),
  ('${C(10)}', '${MA}', 'closed', ts(100), ts(90), dt(95), NULL, '${U.officerA}', '${D1}', 'citizen_online', 'หมู่ 3', 'road', NULL, NULL, NULL, 'x', 'x'),
  ('${C(11)}', '${MA}', 'received', ts(200), NULL, dt(150), NULL, NULL, NULL, 'citizen_online', 'หมู่ 2', 'road', NULL, NULL, NULL, 'x', 'x'),
  ('${C(12)}', '${MB}', 'in_progress', ts(3), NULL, dt(1), NULL, NULL, NULL, 'citizen_online', 'หมู่ 1', 'road', NULL, NULL, NULL, 'x', 'x'),
  -- c13: ช่องสถานที่พิมพ์เองมีชื่อคน+เบอร์ (ไม่อยู่ในทะเบียนของ อปท. นี้) → ต้องนับเป็นตัวเลข ไม่หลุดข้อความ
  ('${C(13)}', '${MA}', 'new', ts(2), NULL, dt(-1), NULL, NULL, '${D2}', 'citizen_online', 'หน้าบ้านนายสมชาย ทดสอบปลอม 0812345678', 'road', NULL, NULL, NULL, 'x', 'x');
-- c14: แถวเก่าไม่มี department_id มีแต่ชื่อกองเป็นข้อความ → ต้องตกที่กองช่าง (D1) ไม่ใช่ "ไม่ระบุกอง"
INSERT INTO public.complaints (id, municipality_id, status, created_at, due_date, assigned_to, village, category, department)
  VALUES ('${C(14)}', '${MA}', 'in_progress', ts(3), dt(1), '${U.officerA}', 'บ้านดอน', 'road', ' กองช่าง ');
-- c9 ปิดแบบเก่า (resolved_by ว่าง): วันเสร็จ = timeline done แรก (T−7) ไม่ใช่ closed_at (T−1 = วันที่แอดมินรับงาน)
INSERT INTO public.complaint_timeline VALUES ('${C(9)}', 'done', ts(7)), ('${C(9)}', 'closed', ts(1));

INSERT INTO public.satisfaction_ratings (municipality_id, complaint_id, rating, is_verified, via_link, rated_by_proxy, created_at, comment) VALUES
  ('${MA}', '${C(2)}', 5, true,  false, false, ts(1), '${PII.phone} ขอบคุณ'),
  ('${MA}', '${C(3)}', 2, false, true,  false, ts(1), 'ช้า'),
  ('${MA}', '${C(3)}', 4, false, false, true,  ts(1), 'สท.บันทึกแทน'),
  ('${MA}', NULL,      1, false, false, false, ts(3), 'ภาพรวม'),
  ('${MA}', '${C(10)}', 1, true, false, false, ts(85), 'นอกช่วง'),
  ('${MB}', NULL,      1, false, false, false, ts(2), 'อปท.อื่น');

INSERT INTO public.document_requests (municipality_id, document_type, status, created_at, issued_at, due_date, department_id, created_by_uid, requester_name) VALUES
  ('${MA}', 'waste_collection', 'pending',    ts(5),  NULL,    dt(1),  '${D2}', '${U.citizenA}', '${PII.name}'),
  ('${MA}', 'waste_collection', 'completed',  ts(6),  ts(2),   dt(3),  '${D2}', '${U.adminA}',   'x'),
  ('${MA}', 'building_permit',  'processing', ts(3),  NULL,    dt(-5), '${D1}', '${U.councilA}', 'x'),
  ('${MA}', 'building_permit',  'completed',  ts(10), ts(8),   dt(7),  '${D1}', NULL,            'x'),
  ('${MA}', 'building_permit',  'rejected',   ts(4),  NULL,    dt(1),  '${D1}', '${U.citizenA}', 'x'),
  ('${MA}', 'tax_notice',       'completed',  ts(100), ts(95), dt(90), '${D2}', NULL,            'x'),
  ('${MB}', 'waste_collection', 'pending',    ts(2),  NULL,    dt(5),  NULL,    NULL,            'x');

INSERT INTO public.patient_booking_trips VALUES
  ('${TR(1)}', '${MA}', 'completed', ARRAY['${B(1)}', '${B(2)}']::uuid[]), ('${TR(2)}', '${MA}', 'completed', ARRAY['${B(4)}']::uuid[]),
  ('${TR(3)}', '${MA}', 'outbound', ARRAY['${B(5)}']::uuid[]),
  -- เที่ยวที่ยกเลิก: การคืนคิวล้าง patient_bookings.trip_id เป็น NULL แต่ booking_ids ของเที่ยวยังอยู่ → ต้องนับ cancelled
  ('${TR(4)}', '${MA}', 'cancelled', ARRAY['${B(3)}']::uuid[]);
INSERT INTO public.patient_bookings VALUES
  ('${B(1)}', '${MA}', 'patient',   'completed', ts(2),  '${TR(1)}', '${PII.patient}'),
  ('${B(2)}', '${MA}', 'patient',   'completed', ts(2),  '${TR(1)}', 'x'),
  ('${B(3)}', '${MA}', 'patient',   'cancelled', ts(1),  NULL,       'x'),
  ('${B(4)}', '${MA}', 'community', 'completed', ts(3),  '${TR(2)}', 'x'),
  ('${B(5)}', '${MA}', 'patient',   'submitted', ts(-3), '${TR(3)}', 'x');

INSERT INTO public.fleet_vehicles VALUES ('${V(1)}', '${MA}', 'active'), ('${V(2)}', '${MA}', 'active'), ('${V(3)}', '${MA}', 'retired'), ('${V(4)}', '${MA}', 'active'),
  ('${V(5)}', '${MA}', 'active'), ('${V(6)}', '${MA}', 'active'), ('${V(7)}', '${MA}', 'active'), ('${V(8)}', '${MA}', 'active'),
  ('${V(9)}', '${MA}', 'active'), ('${V(10)}', '${MA}', 'active');
-- รอบนับแยก (รถ, ประเภทงาน) จากบันทึกล่าสุดของประเภทนั้น (E2.1) · คอมเมนต์ "เดิม" = ผลของรุ่น PR #685
INSERT INTO public.fleet_maintenance (municipality_id, vehicle_id, service_date, next_service_date, maintenance_type) VALUES
  ('${MA}', '${V(1)}', dt(200), dt(10),   'routine'),     -- เลยรอบ ยังไม่มีบันทึกบำรุงรักษาหลังจากนั้น → เลยกำหนด
  ('${MA}', '${V(2)}', dt(100), dt(20),   'routine'),     -- บำรุงรักษาแล้ว T−15 (ไม่ตั้งรอบใหม่) → ไม่นับ
  ('${MA}', '${V(2)}', dt(15),  NULL,     'routine'),
  ('${MA}', '${V(3)}', dt(90),  dt(50),   'routine'),     -- รถปลดระวาง → ไม่นับ
  ('${MA}', '${V(4)}', dt(30),  dt(-7),   'routine'),     -- ถึงรอบใน 7 วัน → ใกล้ครบ
  ('${MA}', '${V(5)}', dt(60),  dt(10),   'routine'),     -- งานซ่อมแซม T−5 ต้องไม่ล้างรอบบำรุงรักษา → เลยกำหนด (เดิม: ถูกล้าง)
  ('${MA}', '${V(5)}', dt(5),   NULL,     'repair'),
  ('${MA}', '${V(6)}', dt(20),  dt(25),   'routine'),     -- ตั้งวันรอบก่อนวันซ่อมของตัวเอง (พิมพ์ผิด) → เลยกำหนด (เดิม: ชนแถวตัวเอง)
  ('${MA}', '${V(7)}', dt(200), dt(3),    'routine'),     -- รอบยางปีหน้าต้องไม่บังรอบบำรุงรักษาที่เลยแล้ว → เลยกำหนด (เดิม: หาย)
  ('${MA}', '${V(7)}', dt(50),  dt(-300), 'tire'),
  ('${MA}', '${V(8)}', dt(100), dt(5),    'routine'),     -- บำรุงรักษาก่อนถึงรอบ 3 วัน → ทำรอบแล้ว (เดิม: เตือนเกิน)
  ('${MA}', '${V(8)}', dt(8),   NULL,     'routine'),
  ('${MA}', '${V(9)}', dt(90),  dt(2),    'routine'),     -- เลยกำหนด + ประเภทอื่นใกล้ครบ → นับเลยกำหนดคันเดียว ไม่ซ้อนใน due_soon
  ('${MA}', '${V(9)}', dt(170), dt(-5),   'emission'),
  ('${MA}', '${V(10)}', dt(40), NULL,     'routine'),     -- ใกล้ครบจากรอบเปลี่ยนถ่ายน้ำมัน → ใกล้ครบ
  ('${MA}', '${V(10)}', dt(30), dt(-10),  'oil_change');
INSERT INTO public.fleet_incidents VALUES ('${MA}', 'damage', dt(5), dt(4)), ('${MA}', 'loss', NULL, dt(2)), ('${MA}', 'damage', dt(60), dt(60));

INSERT INTO public.asset_borrow_requests VALUES
  ('${MA}', 'submitted', ts(4), dt(-10)), ('${MA}', 'submitted', ts(1), dt(-10)), ('${MA}', 'issued', ts(20), dt(3)),
  ('${MA}', 'issued', ts(5), dt(-5)), ('${MA}', 'settlement', ts(30), dt(10)), ('${MA}', 'approved', ts(2), dt(-3)),
  ('${MB}', 'submitted', ts(1), dt(-1));

INSERT INTO public.civil_projects VALUES
  ('${PR(1)}', '${MA}', 'construction', dt(-10)), ('${PR(2)}', '${MA}', 'construction', dt(5)), ('${PR(3)}', '${MA}', 'started', NULL),
  ('${PR(4)}', '${MA}', 'contracted', dt(2)), ('${PR(5)}', '${MA}', 'suspended', dt(1)), ('${PR(6)}', '${MA}', 'closed', dt(100)),
  ('${PR(7)}', '${MA}', 'budgeted', NULL), ('${PR(8)}', '${MB}', 'construction', dt(1));
INSERT INTO public.civil_project_contracts VALUES ('${PR(2)}', dt(-30), NULL, NULL), ('${PR(3)}', NULL, dt(50), 40);
INSERT INTO public.civil_project_changes VALUES
  ('${PR(4)}', 'extend_time', 'approved', dt(-12), ts(10)),
  ('${PR(4)}', 'waive_fine', NULL, NULL, ts(6)),
  ('${PR(6)}', 'amend_contract', NULL, NULL, ts(30)),   -- โครงการปิดแล้ว → ไม่ใช่เรื่องรอตัดสิน
  ('${PR(8)}', 'extend_time', NULL, NULL, ts(3));
INSERT INTO public.civil_weekly_reports VALUES
  ('${PR(1)}', 'final', '{"version":1,"overall":{"label":{"key":"behind","text":"ช้า -3.0%"}}}', dt(5), 1),
  ('${PR(1)}', 'draft', '{}', dt(-2), 2),
  ('${PR(2)}', 'final', '{"version":1,"overall":{"label":{"key":"on_track","text":"ตามแผน"}}}', dt(20), 3);

INSERT INTO public.local_op_plans VALUES
  ('${MA}', 'published', 'main', (extract(year FROM t0())::int + 543 + CASE WHEN extract(month FROM t0()) >= 10 THEN 1 ELSE 0 END), dt(40)),
  ('${MA}', 'draft', 'supplement', 2570, NULL), ('${MA}', 'draft', 'amendment', 2570, NULL), ('${MB}', 'draft', 'main', 2570, NULL);
INSERT INTO public.local_dev_plans VALUES ('${MA}', 'draft'), ('${MA}', 'published');
INSERT INTO public.water_events VALUES ('${id(6001)}', '${MA}', ts(2), NULL), ('${id(6002)}', '${MA}', ts(10), ts(8)), ('${id(6003)}', '${MB}', ts(1), NULL);
INSERT INTO public.water_announcement_settings VALUES ('${MA}', true), ('${MB}', false);
INSERT INTO public.water_announcements VALUES
  ('${MA}', 'draft', now() - interval '1 hour', '${id(6001)}'),    -- รอยืนยันจริง
  ('${MA}', 'draft', ts(1), '${id(6001)}'),                        -- ร่างเกิน 3 ชม. (tick ยังไม่เปลี่ยนเป็น lapsed) → ไม่นับ
  ('${MA}', 'draft', now() - interval '1 hour', '${id(6002)}'),    -- เหตุการณ์ปิดแล้ว → ไม่นับ
  ('${MA}', 'published', ts(5), '${id(6001)}'),
  ('${MB}', 'draft', now() - interval '1 hour', '${id(6003)}');

-- ปฏิทิน: ช่วงทดสอบ T .. T+7
INSERT INTO public.events (id, municipality_id, title, description, event_date, end_date, event_time, attachment_urls) VALUES
  ('${EV(1)}', '${MA}', 'ประชุมประจำเดือน', 'วาระลับ ${PII.phone}', dt(0), NULL, '09:30', ARRAY['https://example.invalid/secret.pdf']),
  ('${EV(2)}', '${MA}', 'อบรมสามวัน', NULL, dt(3), dt(-1), NULL, '{}'),     -- เริ่มก่อนช่วง จบในช่วง → นับ
  ('${EV(3)}', '${MA}', 'งานที่จบแล้ว', NULL, dt(2), NULL, NULL, '{}'),     -- จบก่อนช่วง → ไม่นับ
  ('${EV(4)}', '${MA}', 'วันสุดท้ายของช่วง', NULL, dt(-7), NULL, '13:00', '{}'),
  ('${EV(5)}', '${MA}', 'เลยช่วง', NULL, dt(-8), NULL, NULL, '{}'),
  ('${EV(6)}', '${MB}', 'ของ อปท. อื่น', NULL, dt(0), NULL, NULL, '{}');
`)

const { rows: [{ t }] } = await db.query("SELECT to_char(public.t0(), 'YYYY-MM-DD') AS t")
const day = d => {
  const x = new Date(`${t}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() - d)
  return x.toISOString().slice(0, 10)
}
const FROM = day(30), TO = day(0)

async function as(alias) {
  await db.exec('RESET ROLE')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [alias === 'anon' ? '' : U[alias]])
  await db.exec(`SET ROLE ${alias === 'anon' ? 'anon' : 'authenticated'}`)
}
async function overview(alias, muni = MA, keys = null, from = FROM, to = TO) {
  await as(alias)
  try {
    const { rows } = await db.query('SELECT public.executive_overview($1, $2::date, $3::date, $4::text[]) AS r', [muni, from, to, keys])
    return rows[0].r
  } finally {
    await db.exec('RESET ROLE')
  }
}
async function rejects(fn, code, label) {
  await assert.rejects(fn, (e) => {
    assert.equal(e.code, code, `${label}: ได้ ${e.code} ${e.message}`)
    return true
  })
}

const KEYS = ['complaints', 'doc_requests', 'satisfaction', 'departments', 'patient_transport',
  'fleet', 'borrowable_assets', 'projects', 'local_plan', 'water']
let passed = 0
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`) }
const label = async (v, m = MA) => {
  await db.exec('RESET ROLE')
  return (await db.query('SELECT public.exec_village_label($1, $2) AS l', [m, v])).rows[0].l
}

// ───────────────────────── รุ่นเดิม (PR #685) → ลงไฟล์แก้ E2.1 ─────────────────────────
await test('รุ่นเดิมพลาดตามที่ code review ชี้ — ข้อมูลชุดนี้ชนบั๊กจริง (ก่อนลงไฟล์แก้)', async () => {
  const f = (await overview('viewerA', MA, ['fleet'])).summaries.fleet.data.maintenance
  // เดิม: V5 ถูกงานซ่อมล้างรอบ · V6 ชนแถวตัวเอง · V7 รอบยางบังรอบบำรุงรักษา (3 คันนี้หาย) · V8 บำรุงรักษาก่อนรอบยังขึ้นเลยกำหนด
  assert.deepEqual(f, { overdue: 3, oldest_due_on: day(10), due_soon: 2 })
  assert.equal(await label('หมู่ ที่ 3'), '', 'เดิม: เว้นวรรคก่อน "ที่" ตกเป็นไม่อยู่ในทะเบียน')
  assert.equal(await label('หมู่ที่ 9'), 'หมู่ที่ 9', 'เดิม: ทะเบียนชื่อ "หมู่ที่ 9" แยกกลุ่มกับ "หมู่ 9"')
})

const fixSql = await migration(fixFiles[0])
for (const f of fixFiles) {
  await db.exec('RESET ROLE')
  await db.exec(await migration(f))
}

// ───────────────────────── สิทธิ์ ─────────────────────────
await test('นายก (viewer) / ปลัด (officer top_admin) / รองปลัด (staff top_admin) / admin / superadmin เรียกได้ ครบ 10 คีย์ ok', async () => {
  for (const who of ['viewerA', 'paladA', 'paladStaffA', 'adminA', 'superadmin']) {
    const r = await overview(who)
    assert.deepEqual(Object.keys(r.summaries).sort(), [...KEYS].sort(), who)
    for (const k of KEYS) assert.equal(r.summaries[k].ok, true, `${who} ${k}: ${JSON.stringify(r.summaries[k])}`)
    assert.equal(r.today, t)
  }
})

await test('เจ้าหน้าที่ทั่วไป / ไม่มีตำแหน่ง / ประชาชน / สท. / ผู้ไม่ล็อกอิน / ประชาชนที่ตำแหน่งเพี้ยน → 42501', async () => {
  for (const who of ['officerA', 'officerNoPos', 'staffNoPos', 'citizenA', 'councilA', 'citizenNoMuni']) {
    await rejects(() => overview(who), '42501', who)
  }
  // anon ไม่มีสิทธิ์ EXECUTE เลย (ถอนจาก PUBLIC + anon)
  await rejects(() => overview('anon'), '42501', 'anon')
})

await test('ผู้บริหาร อปท. B ดูของ อปท. A ไม่ได้ (42501) แต่ดูของตัวเองได้', async () => {
  await rejects(() => overview('viewerB', MA), '42501', 'viewerB→MA')
  const r = await overview('viewerB', MB, ['complaints'])
  assert.equal(r.summaries.complaints.ok, true)
  assert.equal(r.summaries.complaints.data.period.total, 1)
})

await test('ฟังก์ชันย่อย + ด่านสิทธิ์เรียกตรงไม่ได้ (authenticated/anon ไม่มี EXECUTE) · ตัวรวบ authenticated เท่านั้น', async () => {
  await db.exec('RESET ROLE')
  const { rows } = await db.query(`
    SELECT p.proname,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
           p.prosecdef, p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (p.proname LIKE 'exec\\_%' OR p.proname = 'executive_overview')`)
  assert.equal(rows.length, 14)
  const helpers = ['exec_village_label', 'exec_complaint_dept']   // SECURITY INVOKER — รันเป็นเจ้าของเมื่อถูกเรียกจากฟังก์ชัน DEFINER
  for (const r of rows) {
    assert.equal(r.prosecdef, !helpers.includes(r.proname), r.proname)
    assert.ok((r.proconfig ?? []).some((c) => c === 'search_path=""' || c === 'search_path='), `${r.proname} search_path: ${r.proconfig}`)
    assert.equal(r.anon_exec, false, `${r.proname} anon`)
    assert.equal(r.auth_exec, r.proname === 'executive_overview', `${r.proname} authenticated`)
  }
  await as('viewerA')
  await rejects(() => db.query('SELECT public.exec_summary_complaints($1, $2::date, $3::date)', [MA, FROM, TO]), '42501', 'เรียกตรง')
  await db.exec('RESET ROLE')
})

await test('ช่วงวันที่ผิด / ยาวเกิน 400 วัน / คีย์เกิน 40 → 22023', async () => {
  await rejects(() => overview('viewerA', MA, null, TO, FROM), '22023', 'from>to')
  await rejects(() => overview('viewerA', MA, null, day(500), TO), '22023', '>400')
  await rejects(() => overview('viewerA', MA, Array.from({ length: 41 }, (_, i) => `k${i}`)), '22023', 'keys>40')
})

await test('คีย์ไม่รู้จัก = unknown_key · คีย์รูปแบบผิดถูกตัดทิ้ง ไม่สะท้อนกลับ · คีย์ซ้ำนับครั้งเดียว', async () => {
  const r = await overview('viewerA', MA, ['nope', 'Complaints;drop', 'water', 'water', null])
  assert.deepEqual(Object.keys(r.summaries).sort(), ['nope', 'water'])
  assert.deepEqual(r.summaries.nope, { ok: false, error: 'unknown_key' })
})

await test('ฟังก์ชันย่อยพัง = ok:false เฉพาะคีย์นั้น · ฟังก์ชันชื่อ exec_summary_* ของเจ้าของอื่นไม่ถูกเรียก', async () => {
  await db.exec('RESET ROLE')
  await db.exec(`
    CREATE FUNCTION public.exec_summary_zz_broken(uuid, date, date) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RETURN to_jsonb(1 / 0); END $$;
    CREATE FUNCTION public.exec_summary_zz_evil(uuid, date, date) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"pwned":true}'::jsonb $$;
    ALTER FUNCTION public.exec_summary_zz_evil(uuid, date, date) OWNER TO evil;
    GRANT EXECUTE ON FUNCTION public.exec_summary_zz_evil(uuid, date, date) TO PUBLIC;`)
  const r = await overview('viewerA', MA, ['complaints', 'zz_broken', 'zz_evil'])
  assert.equal(r.summaries.complaints.ok, true)
  assert.deepEqual(r.summaries.zz_broken, { ok: false, error: '22012' })
  assert.deepEqual(r.summaries.zz_evil, { ok: false, error: 'unknown_key' })
  const all = await overview('viewerA')
  assert.ok(!('zz_evil' in all.summaries), 'ไม่ค้นเจอฟังก์ชันของเจ้าของอื่น')
  assert.equal(all.summaries.zz_broken.ok, false)
  await db.exec('RESET ROLE')
  await db.exec('DROP FUNCTION public.exec_summary_zz_broken(uuid, date, date); DROP FUNCTION public.exec_summary_zz_evil(uuid, date, date);')
})

// ───────────────────────── ตัวเลข ─────────────────────────
const all = await overview('viewerA')
const S = Object.fromEntries(KEYS.map((k) => [k, all.summaries[k].data]))

await test('ไม่มีข้อมูลส่วนบุคคล/ข้อความอิสระ/id รายเรื่องหลุดออกมา', async () => {
  const text = JSON.stringify(all)
  for (const v of [PII.name, PII.phone, PII.patient, 'หน้าบ้าน', 'ขอบคุณ', 'สท.บันทึกแทน', 'นายกปลอม', 'ผอ.ปลอม', ...Object.values(U), ...Array.from({ length: 14 }, (_, i) => C(i + 1))]) {
    assert.ok(!text.includes(v), `หลุด: ${v}`)
  }
})

await test('คำร้อง: ช่องทาง / หมวดพิเศษ / หมู่บ้าน — ชื่อจากทะเบียนหรือ "หมู่ N" ล้วนเท่านั้น ข้อความพิมพ์เองนับเป็นตัวเลข', async () => {
  assert.deepEqual(S.complaints.period, { total: 11, citizen_online: 10, oss_counter: 1, confidential: 1, adhoc: 1 })
  // หมู่ 1 (ทะเบียน ชื่อซ้ำ 2 แถวไม่นับซ้ำ · ' หมู่ 1 ' ตัดช่องว่าง) · 'หมู่ที่ ๒' → 'หมู่ 2' · บ้านดอน (ทะเบียน) · c13 พิมพ์เอง → unlisted
  const v = [...S.complaints.villages].sort((a, b) => b.n - a.n || a.village.localeCompare(b.village))
  assert.deepEqual(v, [{ village: 'หมู่ 1', n: 6 }, { village: 'บ้านดอน', n: 1 }, { village: 'หมู่ 2', n: 1 }].sort((a, b) => b.n - a.n || a.village.localeCompare(b.village)))
  assert.equal(S.complaints.villages_unlisted, 1)
})

await test('exec_village_label: ทะเบียน / รูปแบบเลขหมู่ล้วน / ข้อความอื่น / ว่าง', async () => {
  await db.exec('RESET ROLE')
  const label = async (v, m = MA) => (await db.query('SELECT public.exec_village_label($1, $2) AS l', [m, v])).rows[0].l
  assert.equal(await label('หมู่ 1'), 'หมู่ 1')
  assert.equal(await label('  บ้านดอน '), 'บ้านดอน')
  assert.equal(await label('หมู่ที่ ๑๒'), 'หมู่ 12')
  assert.equal(await label('ม.3'), 'หมู่ 3')
  assert.equal(await label('หมู่ 03'), 'หมู่ 3', 'เลขนำหน้าศูนย์รวมกลุ่มเดียวกัน')
  assert.equal(await label('หมู่ที่ ๐๗'), 'หมู่ 7')
  assert.equal(await label('หมู่ 3 บ้านนายดำ'), '', 'มีข้อความอื่นปน')
  assert.equal(await label('หน้าบ้านนายสมชาย ทดสอบปลอม 0812345678'), '', 'ทะเบียนของ อปท. อื่นไม่นับ')
  assert.equal(await label('   '), null)
  assert.equal(await label(null), null)
})

await test('คำร้อง: ทันกำหนด = สูตรผลการปฏิบัติงาน (วันเสร็จแบบเก่าใช้ timeline done แรก)', async () => {
  // c2 ทัน · c3 เกิน · c9 ทัน (เสร็จ T−7 ≤ กำหนด T−6) · ค้างเลยกำหนด c1 + c11 · ไม่นับ c4 (pending) c5 (เฉพาะกิจ) c6 (อ่อนไหว) c7 (parked)
  // + c14 (กำลังดำเนินการ กำหนด T−1) เป็นค้างเลยกำหนดเรื่องที่ 3
  assert.deepEqual(S.complaints.on_time, { completed: 3, on_time: 2, late: 1, no_due: 0, open_past_due: 3, undated: 0, as_of: TO })
})

await test('คำร้อง: ค้างตอนนี้ (คอขวด) / รอดำเนินการ / ปัญหาซ้ำซาก', async () => {
  const b = S.complaints.backlog
  assert.equal(b.reduce((s, r) => s + r.n, 0), 6)
  assert.deepEqual(b.filter((r) => r.s === 'new'), [
    { s: 'new', due: day(2), c: day(5), u: true, n: 1 },
    { s: 'new', due: day(-1), c: day(2), u: true, n: 1 },
  ])
  assert.deepEqual(b.filter((r) => r.s === 'received').map((r) => [r.due, r.u]).sort(), [[day(150), true], [day(1), false]].sort())
  assert.deepEqual(b.filter((r) => r.s === 'in_progress').map((r) => r.due).sort(), [day(3), day(1)].sort())
  assert.deepEqual(S.complaints.parked, { n: 1, by_reason: { budget: 1 } })
  // ถนน + หมู่ 1 ใน 90 วัน: c1 c2 c3 c7 c9 (c8 rejected ไม่นับ, c5 เฉพาะกิจ, c6 อ่อนไหว)
  assert.deepEqual(S.complaints.repeat, { days: 90, min: 3, groups: [{ category: 'road', label: 'ถนนชำรุด', village: 'หมู่ 1', n: 5 }] })
})

await test('คำขอ: แยกประเภท / ทันกำหนด / ค้าง / ผู้กรอก', async () => {
  assert.deepEqual(S.doc_requests.by_type, [
    { t: 'building_permit', total: 3, pending: 0, processing: 1, completed: 1, rejected: 1, avg_days: 2 },
    { t: 'waste_collection', total: 2, pending: 1, processing: 0, completed: 1, rejected: 0, avg_days: 4 },
  ])
  assert.deepEqual(S.doc_requests.on_time, {
    as_of: TO,
    by_type: [
      { t: 'building_permit', completed: 1, on_time: 1, late: 0, no_due: 0, open_past_due: 0, undated: 0 },
      { t: 'waste_collection', completed: 1, on_time: 0, late: 1, no_due: 0, open_past_due: 1, undated: 0 },
    ],
  })
  assert.equal(S.doc_requests.backlog.length, 2)
  assert.deepEqual(S.doc_requests.entered, { citizen: 2, council: 1, staff: 1, unknown: 1 })
})

await test('ความพึงพอใจ: สูตร #681 (ที่มา/เสียงจริง/legacy ไม่นับซ้ำ) + คะแนนต่ำ + รายกอง', async () => {
  const s = S.satisfaction
  assert.equal(s.closed, 2)
  assert.deepEqual(s.submitters, { citizen: 1, council: 1 })
  assert.deepEqual(s.sources, {
    verified: { complaints: 1, sum: 5, cnt: 1 },
    via_link: { complaints: 1, sum: 2, cnt: 1 },
    proxy: { complaints: 1, sum: 4, cnt: 1 },
  })
  assert.deepEqual(s.genuine, { complaints: 2, sum: 7, cnt: 2 })
  assert.equal(s.any_rated, 2)
  assert.deepEqual(s.general, { n: 1, sum: 1 })
  assert.deepEqual(s.low, { via_link: 1, general: 1 })
  assert.deepEqual(s.by_dept, [{ dept: D1, closed: 2, genuine_sum: 7, genuine_cnt: 2, all_sum: 11, all_cnt: 3 }])
})

await test('รายกอง: ค้าง/เลยกำหนด/เสร็จในช่วง · กองปิดใช้งานที่ไม่มีเรื่องไม่แสดง · ไม่ระบุกองอยู่ท้าย', async () => {
  const rows = S.departments.departments
  assert.deepEqual(rows.map((r) => r.id), [D1, D2, D4, null])
  // D1 ได้ c14 จากชื่อกองข้อความเดิม (' กองช่าง ') ด้วย
  assert.deepEqual(rows[0], { id: D1, name: 'กองช่าง', short_name: 'ช่าง',
    complaints: { open: 2, overdue: 2, parked: 1, done: 3 }, docs: { open: 1, overdue: 0, done: 1 } })
  assert.deepEqual(rows[1].complaints, { open: 3, overdue: 2, parked: 0, done: 0 })
  assert.deepEqual(rows[1].docs, { open: 1, overdue: 1, done: 1 })
  assert.deepEqual(rows[2].complaints, { open: 0, overdue: 0, parked: 0, done: 0 })
  assert.deepEqual(rows[3].complaints, { open: 1, overdue: 1, parked: 0, done: 0 })
})

await test('รถรับ-ส่ง: ยอดจองตามวันนัด + เที่ยวที่ออกรถจริง แยกผู้ป่วย/ชุมชน', async () => {
  assert.deepEqual(S.patient_transport.bookings, {
    patient: { total: 3, submitted: 0, confirmed: 0, completed: 2, cancelled: 1 },
    community: { total: 1, submitted: 0, confirmed: 0, completed: 1, cancelled: 0 },
  })
  assert.deepEqual(S.patient_transport.trips, {
    patient: { ran: 1, completed: 1, waiting: 0, issue: 0, cancelled: 1 },
    community: { ran: 1, completed: 1, waiting: 0, issue: 0, cancelled: 0 },
  })
})

await test('ยานพาหนะ: เลยรอบซ่อมบำรุง นับแยกรถ×ประเภทงาน (E2.1) + เหตุในช่วง', async () => {
  // เลยกำหนด V1 V5 V6 V7 V9 (5 คัน) · เก่าสุด = V6 (T−25) · ใกล้ครบ V4 V10 (V9 เลยกำหนดแล้ว ไม่นับซ้อน) · V2 V8 ทำรอบแล้ว · V3 ปลดระวาง
  assert.deepEqual(S.fleet, { maintenance: { overdue: 5, oldest_due_on: day(25), due_soon: 2 }, incidents: { damage: 1, loss: 1 } })
})

await test('E2.1 exec_village_label: เว้นวรรคก่อน "ที่" / สระ–วรรณยุกต์สลับลำดับ / ม ไม่มีจุด / อักขระล่องหน / เลขหมู่มาก่อนทะเบียน', async () => {
  const UU = '\u0E39', EE = '\u0E35', MAI_EK = '\u0E48'
  assert.equal(await label('หมู่ ที่ 3'), 'หมู่ 3')
  assert.equal(await label('หมู่  ที่๓'), 'หมู่ 3')
  assert.equal(await label(`หม${MAI_EK}${UU} 4`), 'หมู่ 4', 'ไม้เอกพิมพ์ก่อนสระอู')
  assert.equal(await label(`หม${UU}${MAI_EK}ท${MAI_EK}${EE} 5`), 'หมู่ 5', 'ไม้เอกพิมพ์ก่อนสระอี')
  assert.equal(await label('ม 6'), 'หมู่ 6')
  assert.equal(await label('ม6'), 'หมู่ 6')
  assert.equal(await label('หมู่\u200B 7'), 'หมู่ 7', 'ZWSP')
  assert.equal(await label('\uFEFFหมู่\u00A08\u200D'), 'หมู่ 8', 'BOM/NBSP/ZWJ')
  assert.equal(await label('หมู่ที่ 9'), 'หมู่ 9', 'ทะเบียนชื่อ "หมู่ที่ 9" ยังรวมกลุ่มเดียวกับ "หมู่ 9"')
  assert.equal(await label('บ้านนา\u200Bเลา'), 'บ้านนาเลา', 'ข้อความมีอักขระล่องหน ตรงกับทะเบียนหลังตัด')
  assert.equal(await label('บ้านห้วย\u200Bหลวง'), 'บ้านห้วยหลวง', 'เลือกจากรายการ (ชื่อทะเบียนมี ZWSP เหมือนกัน) ยังตรง')
  assert.equal(await label('บ้านห้วยหลวง'), 'บ้านห้วยหลวง', 'พิมพ์เองไม่มี ZWSP ตรงกับทะเบียนที่มี ZWSP')
  // ยังปิดข้อความอิสระเหมือนเดิม
  for (const v of ['หมู่ 123', 'ม 0812345678', 'หมู่บ้าน 3', 'มหาชัย 3', 'ที่ 3', 'หมู่ 3 บ้านนายดำ', 'หมู่ 3 0812345678', 'ม.ค. 3']) {
    assert.equal(await label(v), '', v)
  }
  assert.equal(await label('\u200B \u00A0'), null, 'มีแต่อักขระล่องหน = ว่าง')
})

await test('E2.1 list_events_for_staff_between: เฉพาะช่วง (รวมหลายวันที่คาบเกี่ยว) · 5 ช่อง · ด่านของตัวเดิม · INVOKER', async () => {
  const between = async (who, muni, from, to) => {
    await as(who)
    try {
      return (await db.query('SELECT v FROM public.list_events_for_staff_between($1, $2::date, $3::date) AS v', [muni, from, to])).rows.map((r) => r.v)
    } finally {
      await db.exec('RESET ROLE')
    }
  }
  const rows = await between('viewerA', MA, day(0), day(-7))
  assert.deepEqual(rows.map((r) => r.id), [EV(2), EV(1), EV(4)], 'เรียงตามวันเริ่ม · EV3 จบก่อนช่วง · EV5 เลยช่วง · EV6 อปท. อื่น')
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['end_date', 'event_date', 'event_time', 'id', 'title'])
  assert.deepEqual(rows[0], { id: EV(2), title: 'อบรมสามวัน', event_date: day(3), end_date: day(-1), event_time: null })
  assert.equal(rows[1].event_time, '09:30:00')
  const text = JSON.stringify(rows)
  for (const v of [PII.phone, 'secret.pdf', 'ผู้สร้างปลอม', 'can_view_detail']) assert.ok(!text.includes(v), `หลุด: ${v}`)
  assert.deepEqual(await between('viewerA', MB, day(0), day(-7)), [], 'อปท. อื่น — ด่านของ list_events_for_staff')
  assert.deepEqual((await between('superadmin', MB, day(0), day(0))).map((r) => r.id), [EV(6)])
  await rejects(() => between('viewerA', MA, day(-7), day(0)), '22023', 'from>to')
  await rejects(() => between('viewerA', MA, day(0), day(-401)), '22023', '>400 วัน')
  await rejects(() => between('viewerA', MA, null, day(0)), '22023', 'null')
  await rejects(() => between('anon', MA, day(0), day(-7)), '42501', 'anon')
  await db.exec('RESET ROLE')
  const { rows: [p] } = await db.query(`
    SELECT p.prosecdef, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec, p.proconfig
    FROM pg_proc p WHERE p.oid = 'public.list_events_for_staff_between(uuid,date,date)'::regprocedure`)
  assert.deepEqual([p.prosecdef, p.auth_exec, p.anon_exec], [false, true, false])
  assert.ok((p.proconfig ?? []).some((c) => c === 'search_path=""' || c === 'search_path='), `search_path: ${p.proconfig}`)
})

await test('E2.1 ด่านหัวไฟล์: รันซ้ำได้ · เนื้อฟังก์ชันบนฐานไม่ตรงรุ่นในรีโป → หยุดก่อนเขียนทับ', async () => {
  await db.exec('RESET ROLE')
  await db.exec(fixSql)   // รุ่นใหม่ลงแล้ว รันซ้ำต้องผ่าน (ลายนิ้วมือค่าที่ 2)
  await db.exec(`CREATE OR REPLACE FUNCTION public.exec_summary_fleet(_municipality_id uuid, _from date, _to date)
    RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT '{"tampered":true}'::jsonb $$`)
  await assert.rejects(() => db.exec(fixSql), /ไม่ตรงกับรุ่นในรีโป/)
  const src = (await db.query("SELECT prosrc FROM pg_proc WHERE oid = 'public.exec_summary_fleet(uuid,date,date)'::regprocedure")).rows[0].prosrc
  assert.match(src, /tampered/, 'ด่านหยุดก่อนเขียนทับ — ของบนฐานยังเป็นของเดิม')
  // คืนสภาพ: รุ่น PR #685 → ไฟล์แก้ แล้วตัวเลขต้องกลับเป็นรุ่นใหม่
  await db.exec(await migration(files[2]))
  await db.exec(fixSql)
  const again = await overview('viewerA', MA, ['fleet'])
  assert.deepEqual(again.summaries.fleet.data.maintenance, { overdue: 5, oldest_due_on: day(25), due_soon: 2 })
})

await test('ใบยืมพัสดุ', async () => {
  assert.deepEqual(S.borrowable_assets, {
    submitted: 2, oldest_submitted_on: day(4), approved: 1, issued: 2, overdue_return: 1, oldest_return_due: day(3), settlement: 1,
  })
})

await test('โครงการ: ตามขั้น / ขอเปลี่ยนแปลง / ป้ายรายงาน final / วันสิ้นสุดสัญญาที่มีผล', async () => {
  const p = S.projects
  assert.deepEqual(p.by_stage, { budgeted: 1, construction: 2, contracted: 1, started: 1, suspended: 1 })
  assert.equal(p.suspended, 1)
  assert.deepEqual(p.change_pending, { n: 1, by_kind: { waive_fine: 1 }, oldest_on: day(6) })
  assert.deepEqual(p.schedule, { projects: 4, behind: 1, on_track: 1, ahead: 0, unknown: 0, no_report: 2, stale_report: 1 })
  // p1 สิ้นสุด T+10 (ใกล้หมด) · p2 ต่อสัญญาถึง T+30 · p3 = สั่งเริ่ม T−50 + 40 วัน = T−10 (เลย) · p4 ขยายเวลาอนุมัติถึง T+12 (ใกล้หมด)
  assert.deepEqual(p.contract, { ending_soon: 2, past_end: 1, no_end: 0 })
})

await test('แผน: ฉบับร่าง + ปีงบปัจจุบันประกาศแล้ว', async () => {
  const fy = Number(t.slice(0, 4)) + 543 + (Number(t.slice(5, 7)) >= 10 ? 1 : 0)
  assert.deepEqual(S.local_plan, {
    op_drafts: { n: 2, by_kind: { amendment: 1, supplement: 1 } },
    dev_drafts: 1,
    current_fy: { fiscal_year: fy, published_main: true, latest_published_on: day(40) },
  })
})

await test('น้ำ-ฝน: ประกาศรอยืนยัน + เหตุการณ์เปิดอยู่', async () => {
  assert.equal(S.water.announce_pending.n, 1)
  assert.equal(S.water.open_events.n, 1)
})

await test('อปท. ว่าง (ไม่มีข้อมูลเลย) ทุกคีย์ยัง ok และได้ค่าศูนย์ ไม่ใช่ null พัง', async () => {
  const empty = id(9)
  const r = await overview('superadmin', empty)
  for (const k of KEYS) assert.equal(r.summaries[k].ok, true, k)
  assert.equal(r.summaries.complaints.data.period.total, 0)
  assert.deepEqual(r.summaries.complaints.data.backlog, [])
  assert.equal(r.summaries.satisfaction.data.closed, 0)
  assert.deepEqual(r.summaries.departments.data.departments, [])
})

console.log(`\n${passed} tests passed`)
