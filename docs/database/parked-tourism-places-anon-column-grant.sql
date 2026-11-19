-- ⏸ ร่างที่พักไว้ — ยังไม่ใช่ migration ห้ามรัน (เจ้าของระบบตัดสิน 2026-11-19)
--   เหตุ: ฐานจริงตรวจ 2026-11-19 พบ anon อ่าน uuid ผู้ใช้ได้อีก ~36 คอลัมน์ใน ~25 ตาราง (posts/events/fleet_*/data_center_entries ฯลฯ)
--   ไฟล์นี้ปิดได้จุดเดียว ส่วนช่องปลอมผู้อนุมัติปิดแล้วด้วย 20261218100000 ⇒ ทำรวมในงานกวาด uuid ทั้งระบบทีเดียว
--   ตอนจะใช้: คัดลอกเป็น supabase/migrations/<เลขเวลาใหม่>_... + ตรวจรายชื่อคอลัมน์ฐานจริงใหม่ + ส่ง migration-reviewer
--   หน้าเว็บสาธารณะเลิก select('*') ไว้แล้ว (src/lib/tourismPlaceColumns.js) จึงรันทีหลังได้โดยไม่ต้องแก้หน้าเว็บอีก
--   แต่ยังต้องทำตามลำดับ: ตรวจทุก chunk production ที่มี "tourism_places" + edge_logs ของ anon ที่ select=*/ไม่ใส่ select ก่อนรัน
--
-- (ชื่อเดิมตอนร่าง: 20261215100100_tourism_places_anon_column_grant.sql)
-- ซ่อน tourism_places.created_by (uuid เจ้าหน้าที่ผู้สร้างร้าน) จากผู้ไม่ล็อกอิน
--
-- ⛔ รันหลัง deploy หน้าเว็บที่เลิก select('*') แล้วเท่านั้น (ทำแล้วใน PR ที่ร่างไฟล์นี้: src/lib/tourismPlaceColumns.js)
--    PostgreSQL ซ่อนคอลัมน์ด้วย RLS ไม่ได้ ⇒ ต้องถอน SELECT ทั้งตารางแล้วให้รายคอลัมน์
--    anon ที่ยังยิง select=* จะได้ 42501 ทั้งคำสั่ง ⇒ หน้าท่องเที่ยว/หน้าแรก/หน้ารายละเอียดร้านว่างทุก อปท.
--    ตรวจก่อนรัน: chunk ของ TourismPage / TourismSection / TourismDetailPage บน production ไม่มี select=* ของตารางนี้
--
-- เหตุผล: uuid เจ้าหน้าที่เป็นวัตถุดิบของการปลอมผู้อนุมัติ (ช่อง INSERT ของ business_registrations ปิดแล้วใน 20261218100000
--   แต่ไม่ควรแจก uuid ให้ใครก็ได้ไปลองช่องถัดไป) · ผู้ล็อกอินแล้ว (authenticated) ยังอ่านได้ — หน้าจัดการของเจ้าหน้าที่
--   ใช้ select('*') และ policy "department manage tourism_places" อ้างคอลัมน์นี้ (เจ้าของระบบรับทราบ 2026-11-19)
--
-- ⚠️ กับดักแบบ municipalities (docs/ai/NOTES.md): ADD COLUMN ใน tourism_places ทีหลัง anon จะไม่ได้สิทธิ์อัตโนมัติ
--    ต้อง GRANT SELECT (<col>) ... TO anon เอง + เพิ่มชื่อใน TOURISM_PLACE_PUBLIC_COLUMNS ไม่งั้นหน้าท่องเที่ยวว่าง (42501)
--    เขียนเป็น migration ไฟล์ใหม่ ห้ามแก้ไฟล์นี้ (รันบนฐานจริงไปแล้ว)
--
-- ย้อนกลับ (ถ้าหน้าท่องเที่ยวว่างหลังรัน — ย้อนได้ครบ ไม่มีข้อมูลหาย):
--   GRANT SELECT ON public.tourism_places TO anon; NOTIFY pgrst, 'reload schema';
-- smoke หลังรัน: anon GET /rest/v1/tourism_places?select=id,name&limit=1 = 200 · ?select=* = 401/42501
--   + เปิด /tourism และหน้าแรกแบบไม่ล็อกอิน ทุก tenant ที่ใช้งานจริง
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ด่านก่อนรัน: โครงตารางต้องตรงกับรายชื่อที่ไล่มา (29 คอลัมน์ ณ 2026-11-19) — มีคอลัมน์ใหม่ที่ไม่รู้จัก = หยุด
-- ให้คนตัดสินว่าคอลัมน์นั้นสาธารณะไหม แทนที่จะซ่อนเงียบ/เปิดเงียบ
DO $pre$
DECLARE
  v_expected text[] := ARRAY['id', 'municipality_id', 'name', 'category', 'image_url', 'description', 'is_active',
    'display_order', 'created_at', 'address', 'maps_url', 'gallery', 'phone', 'service_type', 'online_service',
    'online_url', 'has_delivery', 'department_id', 'created_by', 'latitude', 'longitude', 'opening_hours', 'hours_note',
    'facebook_url', 'line_id', 'is_featured', 'village_no', 'price_range', 'updated_at'];
  v_actual text[];
BEGIN
  IF to_regclass('public.tourism_places') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง public.tourism_places';
  END IF;
  SELECT array_agg(attname::text ORDER BY attname) INTO v_actual
    FROM pg_attribute WHERE attrelid = 'public.tourism_places'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_actual IS DISTINCT FROM (SELECT array_agg(c ORDER BY c) FROM unnest(v_expected) c) THEN
    RAISE EXCEPTION 'คอลัมน์ tourism_places ไม่ตรงรายชื่อที่คาด — เกิน: % / ขาด: %',
      (SELECT array_agg(c) FROM unnest(v_actual) c WHERE c <> ALL (v_expected)),
      (SELECT array_agg(c) FROM unnest(v_expected) c WHERE c <> ALL (v_actual));
  END IF;
END
$pre$;

REVOKE SELECT ON public.tourism_places FROM anon;
-- ต้องตรงกับ src/lib/tourismPlaceColumns.js (TOURISM_PLACE_PUBLIC_COLUMNS) — เทสต์ business-registrations-rls-db เทียบให้
GRANT SELECT (id, municipality_id, name, category, image_url, description, is_active, display_order, created_at,
              address, maps_url, gallery, phone, service_type, online_service, online_url, has_delivery, department_id,
              latitude, longitude, opening_hours, hours_note, facebook_url, line_id, is_featured, village_no,
              price_range, updated_at)
  ON public.tourism_places TO anon;

DO $post$
BEGIN
  IF has_table_privilege('anon', 'public.tourism_places', 'SELECT') THEN
    RAISE EXCEPTION 'anon ยังมี SELECT ทั้งตาราง tourism_places';
  END IF;
  IF has_column_privilege('anon', 'public.tourism_places', 'created_by', 'SELECT') THEN
    RAISE EXCEPTION 'anon ยังอ่าน tourism_places.created_by ได้';
  END IF;
  IF NOT has_column_privilege('anon', 'public.tourism_places', 'name', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.tourism_places', 'updated_at', 'SELECT') THEN
    RAISE EXCEPTION 'anon อ่านคอลัมน์สาธารณะของ tourism_places ไม่ได้';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.tourism_places', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated เสียสิทธิ์ SELECT tourism_places (ไม่ควรเกิด)';
  END IF;
END
$post$;

COMMIT;

NOTIFY pgrst, 'reload schema';
