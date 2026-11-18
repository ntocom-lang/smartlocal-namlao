-- ตลาดชาวบ้าน (แผนเทียบคู่แข่ง ขั้น 1A) ไฟล์ 1/2 — สร้างตาราง + ปิดประตูทันที
--   ไฟล์ 2 (20261214100100) ใส่ RLS / GRANT / RPC / ผูกเจ้าของย้อนหลัง / เปิดโมดูลให้ demo — แยกไฟล์ตามกติกา "1 ไฟล์ = 1 เฟส"
--
-- market_shop_owners  ผูก "ร้าน" (tourism_places) กับบัญชีเจ้าของร้าน 1 ร้าน = 1 เจ้าของ
--                     แยกเป็นตารางของตัวเอง ไม่เพิ่มคอลัมน์ใน tourism_places เพราะตารางนั้นอ่านสาธารณะ
--                     (ใส่ไว้ที่นั่น = เปิด user id ของเจ้าของร้านให้ทุกคนเห็น · PDPA)
--                     เดิมตอนอนุมัติคำขอ BusinessRegistrationAdmin คัดลอกข้อมูลไป tourism_places โดยไม่เก็บทางกลับ
--                     ⇒ เจ้าของร้านแก้อะไรเองไม่ได้เลย ตารางนี้คือทางกลับนั้น
-- market_products     สินค้าของร้าน เจ้าของร้านเพิ่ม/แก้เอง ขึ้นทันที (เจ้าของระบบเลือก 2026-11-19 "ตามแนะนำ")
--                     เจ้าหน้าที่ซ่อนทีหลังได้ผ่าน RPC (บันทึกผู้ซ่อน/เวลา/เหตุผลไว้ย้อนตรวจ) · เพดาน 30 รายการต่อร้าน
-- market_product_moderation_log  สมุดบันทึกการซ่อน/ลบสินค้าของเจ้าหน้าที่ (ระบบเขียนเองใน RPC/trigger)
-- tourism_favorites   ร้าน/สถานที่โปรดของประชาชน (ระดับร้าน ไม่ใช่รายสินค้า — เจ้าของระบบเลือก 2026-11-19)
--                     ใช้ได้ทั้งร้านค้าและสถานที่ท่องเที่ยว · เจ้าของรายการเห็นคนเดียว เจ้าหน้าที่ไม่เห็น
--
-- ไม่มีตะกร้า/สั่งซื้อ/รับเงินในระบบ ปุ่มติดต่อร้านใช้ช่องทางเดิมของร้าน ⇒ อปท. ไม่เป็นคนกลางซื้อขาย
-- ทำทีหลัง (จดไว้): ผูกเจ้าของด้วยการเลือกบัญชีเอง · รายการโปรดรายสินค้า · แจ้งเตือนร้านเมื่อถูกซ่อนสินค้า
--   · merge_duplicate_profile ยังไม่ย้ายคอลัมน์ user ของ 3 ตารางนี้ (ปัญหาเดิมของฟังก์ชันนั้น ~60 คอลัมน์ · จดเข้า backlog)
--     รวมบัญชีแล้วความเป็นเจ้าของร้าน/รายการโปรดหาย — เจ้าหน้าที่ผูกคืนได้ (merge ย้าย business_registrations.user_id ให้แล้ว)
--
-- ⚠️ ห้ามรันไฟล์นี้ซ้ำหลังไฟล์ 2: REVOKE ท้ายไฟล์จะถอนสิทธิ์ที่ไฟล์ 2 ให้ไว้ทั้งหมด (ต้องรันไฟล์ 2 ซ้ำตาม)
-- ⚠️ CREATE TABLE IF NOT EXISTS: ถ้ามีตารางชื่อนี้อยู่ก่อนจะข้ามเงียบ — ตรวจด้วย SELECT ก่อนรัน (ต้องไม่มี 4 ชื่อนี้)
--
-- ย้อนกลับ (ไม่มีตารางเดิมถูกแก้โครง · ข้อมูลที่หายมีแค่ของใหม่):
--   DROP TABLE public.market_products, public.market_shop_owners, public.market_product_moderation_log,
--              public.tourism_favorites CASCADE;  แล้วรันส่วนย้อนกลับของไฟล์ 2
BEGIN;
SET LOCAL lock_timeout = '5s'; -- FK ไป auth.users / tourism_places ถือ lock จน COMMIT — มี session ค้างให้ล้มเร็ว

DO $guard$
BEGIN
  -- tourism_places ไม่มี CREATE TABLE ใน migrations ของ repo (สร้างก่อนยุค migration) ⇒ ตรวจชนิดคอลัมน์ก่อนอ้าง FK
  IF to_regclass('public.tourism_places') IS NULL OR to_regclass('public.business_registrations') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตาราง tourism_places / business_registrations';
  END IF;
  IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
      WHERE a.attrelid = 'public.tourism_places'::regclass AND a.attname = 'id' AND NOT a.attisdropped) IS DISTINCT FROM 'uuid'
     OR (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = 'public.tourism_places'::regclass AND NOT a.attisdropped
           AND a.attname IN ('municipality_id', 'department_id', 'is_active', 'name', 'created_by')) <> 5 THEN
    RAISE EXCEPTION 'tourism_places ไม่ตรงโครงที่คาด (id uuid + municipality_id/department_id/is_active/name/created_by)';
  END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS public.market_shop_owners (
  place_id         uuid PRIMARY KEY REFERENCES public.tourism_places(id) ON DELETE CASCADE,
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  registration_id  uuid REFERENCES public.business_registrations(id) ON DELETE SET NULL, -- คำขอ 1 ใบผูกได้ร้านเดียว (index ด้านล่าง)
  linked_by        uuid, -- รอยตรวจสอบ ไม่ใส่ FK (บทเรียน #658) · NULL = ผูกย้อนหลังโดย migration
  linked_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_shop_owners_user_idx ON public.market_shop_owners (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS market_shop_owners_registration_uidx
  ON public.market_shop_owners (registration_id) WHERE registration_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.market_products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  place_id         uuid NOT NULL REFERENCES public.tourism_places(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description      text CHECK (description IS NULL OR length(description) <= 500),
  price            numeric(12, 2) CHECK (price IS NULL OR price BETWEEN 0 AND 10000000), -- NULL = "สอบถามราคา"
  unit             text CHECK (unit IS NULL OR length(unit) <= 30),
  -- รูป 1 ใบ: รับเฉพาะไฟล์ที่อัปโหลดผ่านระบบเอง (Drive ผ่าน drive-file / Storage สาธารณะ ของโปรเจกต์นี้)
  -- ไม่รับโฮสต์อื่น: รูปจากเซิร์ฟเวอร์ภายนอกส่ง IP/User-Agent ของผู้เปิดหน้าให้บุคคลที่สาม (PDPA)
  -- และเจ้าของสลับเนื้อรูปที่ URL เดิมได้หลังเจ้าหน้าที่ตรวจแล้ว · edgeImageUrl ไม่ proxy โฮสต์ภายนอก
  -- ⚠️ ผูกกับ project ref umxssfahtuprnztlytdd — ย้ายโปรเจกต์ Supabase ต้องแก้ CHECK นี้ด้วย
  -- !~ '/\.' กัน ../ (เบราว์เซอร์ยุบ path แล้ว <img> จะ GET ไปนอก bucket ได้)
  image_url        text CHECK (image_url IS NULL OR (length(image_url) <= 1000 AND image_url ~
                     '^https://umxssfahtuprnztlytdd\.supabase\.co/(functions/v1/drive-file\?id=[A-Za-z0-9_-]+|storage/v1/object/public/[A-Za-z0-9_./-]+)$'
                     AND image_url !~ '/\.')),
  is_available     boolean NOT NULL DEFAULT true,
  display_order    smallint NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 999),
  -- เจ้าของร้านติ๊กรับรองตอนเพิ่ม/แก้ ว่าสินค้าขายได้ถูกกฎหมาย (ถ้อยคำบนจอต้องเทียบตัวบทก่อน)
  attest_lawful    boolean NOT NULL CHECK (attest_lawful),
  is_hidden        boolean NOT NULL DEFAULT false,  -- เจ้าหน้าที่ซ่อน (เขียนผ่าน RPC เท่านั้น · ใครซ่อนเมื่อไรอยู่ในสมุดบันทึกด้านล่าง)
  hidden_reason    text CHECK (hidden_reason IS NULL OR length(hidden_reason) <= 300), -- เจ้าของร้านเห็น จะได้รู้ว่าต้องแก้อะไร
  -- ไม่มีคอลัมน์ created_by/hidden_by: แถวที่แสดงสาธารณะต้องไม่มี user id (เจ้าของร้านอยู่ใน market_shop_owners แล้ว)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_products_place_idx ON public.market_products (place_id, display_order);
CREATE INDEX IF NOT EXISTS market_products_muni_idx ON public.market_products (municipality_id) WHERE NOT is_hidden;

-- สมุดบันทึก: ซ่อน/เลิกซ่อน/ลบสินค้าโดยเจ้าหน้าที่ · เจ้าของลบสินค้าที่ถูกซ่อน · ผูก/เปลี่ยน/ถอดเจ้าของร้าน
-- (ย้อนตรวจได้ · ไม่มี FK ไปสินค้า/ร้าน เพื่อให้บันทึกอยู่ต่อหลังลบ · แถวเจ้าของร้าน product_* = NULL)
CREATE TABLE IF NOT EXISTS public.market_product_moderation_log (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  place_id         uuid NOT NULL,
  product_id       uuid,
  product_name     text,
  action           text NOT NULL CHECK (action IN ('hide', 'unhide', 'delete', 'owner_delete_hidden',
                                                   'link_owner', 'replace_owner', 'unlink_owner')),
  subject_user_id  uuid, -- เจ้าของร้านที่ถูกผูก/ถอด (เฉพาะแถว *_owner) · ไม่มี FK ให้ประวัติอยู่ต่อ
  reason           text,
  actor_id         uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((action IN ('link_owner', 'replace_owner', 'unlink_owner')) = (product_id IS NULL AND product_name IS NULL))
);
CREATE INDEX IF NOT EXISTS market_product_moderation_log_place_idx ON public.market_product_moderation_log (place_id);
CREATE INDEX IF NOT EXISTS market_product_moderation_log_muni_idx ON public.market_product_moderation_log (municipality_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tourism_favorites (
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_id         uuid NOT NULL REFERENCES public.tourism_places(id) ON DELETE CASCADE,
  municipality_id  uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, place_id)
);
CREATE INDEX IF NOT EXISTS tourism_favorites_place_idx ON public.tourism_favorites (place_id);

-- ปิดประตูทันที: ไฟล์ 2 ค่อยเปิดทีละสิทธิ์ (ช่วงระหว่างไฟล์ 1 กับ 2 ไม่มีใครอ่าน/เขียนได้)
ALTER TABLE public.market_shop_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_product_moderation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tourism_favorites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_shop_owners, public.market_products, public.market_product_moderation_log, public.tourism_favorites
  FROM PUBLIC, anon, authenticated;

COMMIT;
