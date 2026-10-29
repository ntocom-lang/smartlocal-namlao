// กระดิ่งรวมงานของฉัน my_notification_feed — รันบน PostgreSQL จำลอง (PGlite) ไม่ต่อ Supabase จริง
// รันด้วย: PATIENT_PGLITE_MODULE=<path>/@electric-sql/pglite/dist/index.js node tests/notification-feed-db.test.mjs
//   (PowerShell: $env:PATIENT_PGLITE_MODULE='D:/tmp/patient-booking-dbtest-20260918/node_modules/@electric-sql/pglite/dist/index.js')
//
// RLS ของ document_requests / event_assignments / events คัดจาก pg_policies ของระบบจริง 2569-10-29 ทั้งข้อความ
// ฟังก์ชันที่ฟีดเรียก (esign_*, ptb_role, patient_booking_*) เป็นตัวจำลองที่คืนค่าตามตารางทดสอบรายคน
// ⚠️ ทดสอบว่า "ฟีดเคารพ RLS และคัดหมวดถูก" ไม่ได้ทดสอบความถูกต้องของฟังก์ชันลงนาม/รถผู้ป่วยตัวจริง

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

if (!process.env.PATIENT_PGLITE_MODULE) {
  console.error('ต้องตั้ง PATIENT_PGLITE_MODULE ชี้ไปที่ @electric-sql/pglite/dist/index.js (ดู docs/ai/PATIENT_BOOKING_HANDOFF.md)')
  process.exit(1)
}
const { PGlite } = await import(pathToFileURL(process.env.PATIENT_PGLITE_MODULE).href)
const migration = (await readFile(new URL('../supabase/migrations/20261029110000_my_notification_feed.sql', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = id(1)
const B = id(2)
const D_ENG = id(31)
const D_CLERK = id(32)
const U = {
  admin: id(10), adminB: id(11), officerEng: id(12), staff: id(13), tech: id(14), citizen: id(15),
  super: id(16), signer: id(17), suspended: id(18), viewer: id(19), kamnan: id(20),
}

const db = new PGlite()
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, municipality_id uuid, department_id uuid);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT municipality_id FROM public.profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.is_my_department(p_muni uuid, p_dept uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND municipality_id = p_muni AND department_id = p_dept) $$;
CREATE FUNCTION public.asset_can_manage(p_muni uuid, p_dept uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.get_my_municipality_id(), public.is_my_department(uuid, uuid), public.asset_can_manage(uuid, uuid) TO anon, authenticated;

-- ตัวจำลองฟังก์ชันลงนาม/รถผู้ป่วย: คืนค่าตามตารางทดสอบของผู้เรียก
CREATE TABLE public.stub_signer (user_id uuid PRIMARY KEY, pin_set boolean, suspended boolean);
CREATE TABLE public.stub_pending (user_id uuid, trip_id uuid, slot text, slot_label text, decision text, planned_departure timestamptz);
CREATE TABLE public.stub_ptb (user_id uuid PRIMARY KEY, role text);
CREATE TABLE public.stub_patient (municipality_id uuid PRIMARY KEY, enabled boolean, pending int, driver int);
CREATE FUNCTION public.esign_my_signer_overview() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT jsonb_build_object('ok', true, 'pin_set', COALESCE(s.pin_set, false), 'suspended', COALESCE(s.suspended, false))
        FROM (SELECT 1) x LEFT JOIN public.stub_signer s ON s.user_id = auth.uid() $$;
CREATE FUNCTION public.esign_my_pending() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT jsonb_build_object('ok', true, 'items', COALESCE(jsonb_agg(jsonb_build_object('trip_id', trip_id, 'slot', slot, 'slot_label', slot_label,
          'decision', decision, 'planned_departure', planned_departure, 'requester_name', 'ชื่อผู้ขอ', 'destination', 'ปลายทางลับ', 'purpose', 'วัตถุประสงค์')), '[]'::jsonb))
        FROM public.stub_pending WHERE user_id = auth.uid() $$;
CREATE FUNCTION public.ptb_role(p_muni uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT COALESCE((SELECT role FROM public.stub_ptb WHERE user_id = auth.uid()), 'citizen') $$;
REVOKE ALL ON FUNCTION public.ptb_role(uuid) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.patient_booking_info(p_muni uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT jsonb_build_object('enabled', COALESCE((SELECT enabled FROM public.stub_patient WHERE municipality_id = p_muni), false)) $$;
CREATE FUNCTION public.patient_booking_staff_work_badge(p_muni uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT jsonb_build_object('pending', p.pending, 'driver', p.driver, 'total', p.pending + p.driver)
        FROM public.stub_patient p WHERE p.municipality_id = p_muni $$;
GRANT EXECUTE ON FUNCTION public.esign_my_signer_overview(), public.esign_my_pending(), public.patient_booking_info(uuid), public.patient_booking_staff_work_badge(uuid) TO authenticated;

CREATE TABLE public.events (id uuid PRIMARY KEY, municipality_id uuid, event_date date, end_date date, audiences text[] DEFAULT ARRAY['public']);
CREATE TABLE public.event_assignments (id uuid PRIMARY KEY, event_id uuid REFERENCES public.events(id), municipality_id uuid,
  profile_id uuid, task text, assigned_at timestamptz DEFAULT now());
CREATE TABLE public.document_requests (id uuid PRIMARY KEY, municipality_id uuid, document_type text, status text,
  user_id uuid, department_id uuid, assigned_to uuid, created_at timestamptz DEFAULT now(),
  requester_name text, requester_phone text, requester_address text, purpose text);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.events, public.event_assignments, public.document_requests TO anon, authenticated;
CREATE POLICY "events select by audience" ON public.events FOR SELECT TO public USING (((get_my_role() = 'superadmin'::text) OR ('public'::text = ANY (audiences)) OR ((get_my_role() = ANY (ARRAY['admin'::text, 'officer'::text, 'viewer'::text, 'council'::text, 'staff'::text, 'technician'::text, 'kamnan'::text])) AND (municipality_id = get_my_municipality_id()))));
CREATE POLICY "event assignments read internal" ON public.event_assignments FOR SELECT TO authenticated USING (((get_my_role() = 'superadmin'::text) OR ((get_my_role() = ANY (ARRAY['admin'::text, 'officer'::text, 'viewer'::text, 'council'::text, 'staff'::text, 'technician'::text])) AND (municipality_id = get_my_municipality_id()))));
CREATE POLICY "asset staff read asset_borrow requests" ON public.document_requests FOR SELECT TO authenticated USING (((document_type = 'asset_borrow_request'::text) AND asset_can_manage(municipality_id, department_id)));
CREATE POLICY "read document_requests" ON public.document_requests FOR SELECT TO public USING ((((user_id IS NOT NULL) AND (user_id = auth.uid())) OR (get_my_role() = 'superadmin'::text) OR ((get_my_role() = 'admin'::text) AND (municipality_id = get_my_municipality_id())) OR ((get_my_role() = 'officer'::text) AND is_my_department(municipality_id, department_id)) OR ((get_my_role() = 'staff'::text) AND (municipality_id = get_my_municipality_id()) AND (assigned_to = auth.uid()))));
`)

await db.query(`INSERT INTO public.profiles VALUES
  ($1,'admin',$12,NULL), ($2,'admin',$13,NULL), ($3,'officer',$12,$14), ($4,'staff',$12,$15), ($5,'technician',$12,$14),
  ($6,'citizen',$12,NULL), ($7,'superadmin',NULL,NULL), ($8,'officer',$12,$15), ($9,'officer',$12,$15), ($10,'viewer',$12,NULL), ($11,'kamnan',$12,NULL)`,
[U.admin, U.adminB, U.officerEng, U.staff, U.tech, U.citizen, U.super, U.signer, U.suspended, U.viewer, U.kamnan, A, B, D_ENG, D_CLERK])

const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
const shift = (days) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
await db.query(`INSERT INTO public.events VALUES ($1,$4,$5,NULL), ($2,$4,$6,NULL), ($3,$4,$7,$5)`,
  [id(41), id(42), id(43), A, shift(2), shift(-3), shift(-1)])
await db.query(`INSERT INTO public.event_assignments (id, event_id, municipality_id, profile_id, task) VALUES
  ($1,$4,$7,$8,'attend'), ($2,$5,$7,$8,'preside'), ($3,$6,$7,$8,'join'), ($9,$4,$7,$10,'attend')`,
[id(51), id(52), id(53), id(41), id(42), id(43), A, U.admin, id(54), U.tech])
await db.query(`INSERT INTO public.document_requests (id, municipality_id, document_type, status, user_id, department_id, assigned_to, requester_name, requester_phone) VALUES
  ($1,$7,'certificate','pending',$9,$10,NULL,'ชื่อประชาชน','0812345678'),
  ($2,$7,'waste_bin','pending',$9,$11,$12,'ชื่อประชาชน','0812345678'),
  ($3,$7,'certificate','completed',$9,$10,NULL,'ชื่อประชาชน','0812345678'),
  ($4,$8,'certificate','pending',$9,$10,NULL,'ชื่อประชาชน','0812345678'),
  ($5,$7,'certificate','pending',$13,$10,NULL,'แอดมินยื่นเอง','0800000000'),
  ($6,$7,'water','pending',NULL,$11,NULL,'รับแทนที่เคาน์เตอร์','0899999999')`,
[id(61), id(62), id(63), id(64), id(65), id(66), A, B, U.citizen, D_ENG, D_CLERK, U.staff, U.admin])
await db.query(`INSERT INTO public.stub_signer VALUES ($1, true, false), ($2, true, true), ($3, false, false)`, [U.signer, U.suspended, U.officerEng])
await db.query(`INSERT INTO public.stub_pending VALUES ($1,$2,'dept_head','ผอ.กอง','sign',now() + interval '1 day'), ($3,$2,'dept_head','ผอ.กอง','sign',now())`, [U.signer, id(71), U.suspended])
// ptb_role ตัวจริงคืน 'admin' ให้ superadmin ทุก อปท. — ตัวจำลองต้องตรงกัน ไม่งั้นเทสต์ "อปท. ที่ไม่เปิดบริการ" ผ่านลวง
await db.query(`INSERT INTO public.stub_ptb VALUES ($1,'admin'), ($2,'coordinator'), ($3,'driver'), ($4,'admin')`, [U.admin, U.officerEng, U.staff, U.super])
await db.query(`INSERT INTO public.stub_patient VALUES ($1, true, 2, 1), ($2, false, 5, 0)`, [A, B])

await db.exec(migration)
await db.exec(migration) // รันซ้ำได้ (CREATE OR REPLACE)

async function feed(user, muni = A) {
  await db.exec(`SET ROLE ${user ? 'authenticated' : 'anon'}`)
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [user ?? ''])
  try {
    return (await db.query('SELECT public.my_notification_feed($1) AS f', [muni])).rows[0].f
  } finally {
    await db.exec('RESET ROLE')
  }
}
const keysOf = (f, category) => f.items.filter((i) => i.category === category).map((i) => i.key).sort()

// ── ประชาชน / ไม่ล็อกอิน / ต่าง อปท. ───────────────────────────────────────────
assert.deepEqual(await feed(U.citizen), { ok: true, categories: [], items: [] }, 'ประชาชนไม่มีหมวดงาน')
await assert.rejects(feed(null), /permission denied/, 'anon เรียกไม่ได้')
assert.deepEqual(await feed(U.adminB, A), { ok: true, categories: [], items: [] }, 'แอดมิน อปท. อื่นเรียกแทน อปท. นี้ไม่ได้')

// ── แอดมิน: เห็นคำขอทั้ง อปท. (ยกเว้นใบที่ตัวเองยื่น) + กิจกรรมของตัวเองที่ยังไม่ผ่าน + รถผู้ป่วย ─────
const admin = await feed(U.admin)
assert.deepEqual(admin.categories, ['event', 'eservice', 'patient'], 'แอดมินไม่ได้ตั้งรหัสลงนาม จึงไม่มีหมวดรอลงนาม')
assert.deepEqual(keysOf(admin, 'eservice'), [`eservice:${id(61)}:pending`, `eservice:${id(62)}:pending`, `eservice:${id(66)}:pending`].sort())
assert.deepEqual(keysOf(admin, 'event'), [`event:${id(51)}`, `event:${id(53)}`].sort(), 'กิจกรรมที่ผ่านไปแล้วไม่ขึ้น · กิจกรรมหลายวันที่ยังจัดอยู่ขึ้น')
assert.deepEqual(admin.items.filter((i) => i.category === 'patient'), [{ category: 'patient', key: 'patient:2:1', ref: null, status: 'pending', detail: '3', at: admin.items.find((i) => i.category === 'patient').at }])

// ── หัวหน้ากอง: เฉพาะกองตัวเอง · ผู้ประสานงานรถผู้ป่วย · ยังไม่ตั้ง PIN จึงไม่มีหมวดรอลงนาม ─────────────
const officer = await feed(U.officerEng)
assert.deepEqual(officer.categories, ['event', 'eservice', 'patient'])
// ใบ 65 แอดมินยื่นในฐานะประชาชน (อยู่กองช่าง) — ตัดออกเฉพาะฝั่งผู้ยื่นเอง หัวหน้ากองช่างยังต้องเห็นเป็นงาน
assert.deepEqual(keysOf(officer, 'eservice'), [`eservice:${id(61)}:pending`, `eservice:${id(65)}:pending`], 'เฉพาะใบของกองช่าง')
// ── staff: เฉพาะใบที่มอบหมายให้ · คนขับรถผู้ป่วย ─────────────────────────────────
const staff = await feed(U.staff)
assert.deepEqual(keysOf(staff, 'eservice'), [`eservice:${id(62)}:pending`])
assert.ok(staff.categories.includes('patient'))
// ── ช่าง/ผู้ดูอย่างเดียว/กำนัน: ไม่มีหมวดคำขอ E-Service ───────────────────────────
const tech = await feed(U.tech)
assert.deepEqual(tech.categories, ['event'])
assert.deepEqual(keysOf(tech, 'event'), [`event:${id(54)}`])
assert.deepEqual((await feed(U.viewer)).categories, ['event'])
assert.deepEqual((await feed(U.kamnan)).categories, [], 'กำนันไม่อยู่ใน policy event_assignments จึงไม่โชว์หมวดกิจกรรม')

// ── ผู้ลงนาม: ตั้ง PIN แล้ว = มีหมวดรอลงนาม · ถูกระงับ = ไม่มี ───────────────────────
const signer = await feed(U.signer)
assert.ok(signer.categories.includes('esign'))
const esign = signer.items.filter((i) => i.category === 'esign')
assert.deepEqual(esign.map((i) => [i.key, i.status, i.detail]), [[`esign:${id(71)}:dept_head`, 'sign', 'ผอ.กอง']])
assert.equal((await feed(U.suspended)).categories.includes('esign'), false, 'ถูกระงับต้องไม่ขึ้นหมวดรอลงนาม')

// ── superadmin: ได้ทุก อปท. · รถผู้ป่วยของ อปท. ที่ปิดบริการไม่ขึ้น ─────────────────────
const superA = await feed(U.super, A)
assert.ok(superA.categories.includes('eservice'))
assert.ok(superA.categories.includes('patient'), 'อปท. ที่เปิดบริการรถผู้ป่วย superadmin เห็นหมวดนี้')
const superB = await feed(U.super, B)
assert.equal(superB.categories.includes('patient'), false, 'อปท. ที่ไม่ได้เปิดบริการรถผู้ป่วยไม่ขึ้นหมวดนี้')
assert.deepEqual(keysOf(superB, 'eservice'), [`eservice:${id(64)}:pending`])

// ── ไม่คืนข้อมูลส่วนบุคคลหรือรายละเอียดที่ไม่จำเป็น ─────────────────────────────────
for (const f of [admin, officer, staff, signer, superB]) {
  for (const item of f.items) {
    assert.deepEqual(Object.keys(item).sort(), ['at', 'category', 'detail', 'key', 'ref', 'status'], 'คืนแค่ฟิลด์ที่กำหนด')
    assert.ok(item.key.length <= 80, 'key ต้องเก็บใน notification_reads ได้ (≤80 ตัวอักษร)')
  }
  assert.doesNotMatch(JSON.stringify(f), /ชื่อประชาชน|0812345678|ปลายทางลับ|วัตถุประสงค์|ชื่อผู้ขอ|รับแทนที่เคาน์เตอร์/, 'ห้ามมีชื่อ/เบอร์/ปลายทาง/วัตถุประสงค์')
}

// ── ฟีดต้องเป็น SECURITY INVOKER (อ่านผ่าน RLS ของผู้เรียก) และห้ามเรียก ptb_role ตรงได้ ─────────────
const fnInfo = (await db.query(`SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('my_notification_feed', 'my_patient_transport_role') ORDER BY proname`)).rows
assert.deepEqual(fnInfo, [{ proname: 'my_notification_feed', prosecdef: false }, { proname: 'my_patient_transport_role', prosecdef: true }])
const canRole = (await db.query(`SELECT has_function_privilege('authenticated', 'public.ptb_role(uuid)', 'EXECUTE') AS ok`)).rows[0].ok
assert.equal(canRole, false, 'ptb_role ยังเรียกตรงไม่ได้เหมือนเดิม')

console.log('✓ notification-feed-db: ผ่านทุกข้อ')
