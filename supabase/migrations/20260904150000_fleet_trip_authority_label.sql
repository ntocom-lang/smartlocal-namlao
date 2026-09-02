-- ใบขออนุญาตใช้รถ (แบบ 3) ต้องชี้แถวผู้ลงนามที่แอดมินสร้างเองได้
--
-- order_authority_role เดิมเก็บแค่ชื่อบทบาท ซึ่งเพียงพอตอนที่ทุกบทบาทมีแถวเดียว
-- พอเปิดให้สร้างแถวเองได้ (signatory_role = 'custom' หลายแถวต่อ อปท.) ชื่อบทบาท
-- อย่างเดียวชี้ไม่ถูกว่าแถวไหน จึงต้องเก็บชื่อแถวคู่กันไป
--
-- ยังไม่เก็บ FK ไป document_signatories.id ด้วยเหตุผลเดิม: การเปลี่ยนตัวผู้ลงนาม
-- คือปิดแถวเก่า (is_active=false) แล้วสร้างแถวใหม่ FK จะค้างชี้แถวที่ปิดไปแล้ว
-- ส่วนคู่ (signatory_role, custom_label) เสถียรข้ามการเปลี่ยนตัวคน — ใบที่พิมพ์
-- จึงขึ้นชื่อคนที่ดำรงตำแหน่งนั้นจริง ณ วันที่พิมพ์

ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS order_authority_label text;

COMMENT ON COLUMN public.fleet_trips.order_authority_label IS
  'ชื่อแถวผู้ลงนามที่แอดมินสร้างเอง คู่กับ order_authority_role = custom (NULL สำหรับบทบาทของระบบ)';

-- ต้องมีชื่อแถวเมื่อและเฉพาะเมื่อเลือกบทบาทที่สร้างเอง ไม่งั้นตอนพิมพ์จะ resolve
-- ไม่เจอแถวไหนเลยแล้วเว้นช่องลงนามว่างโดยไม่มีอะไรบอกว่าทำไม
ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_order_authority_label_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_order_authority_label_check
  CHECK (
    (order_authority_role = 'custom' AND btrim(coalesce(order_authority_label, '')) <> ''
      AND char_length(order_authority_label) <= 100)
    OR (order_authority_role IS DISTINCT FROM 'custom' AND order_authority_label IS NULL)
  )
  NOT VALID;

-- ทริปเดิมทุกใบมี order_authority_role เป็น NULL หรือ mayor/clerk/vehicle_authority
-- ซึ่งผ่านเงื่อนไขข้างบนอยู่แล้ว แต่ CHECK ตัวบทบาทยังไม่รู้จัก custom
ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_order_authority_role_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_order_authority_role_check
  CHECK (
    order_authority_role IS NULL
    OR order_authority_role IN ('mayor', 'clerk', 'vehicle_authority', 'custom')
  )
  NOT VALID;
