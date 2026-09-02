-- ปลดระวางบทบาท vehicle_authority และ RPC v3 หลังโค้ดใหม่ขึ้น production แล้ว
--
-- ⚠️ ไฟล์นี้ต้อง apply "หลัง" deploy เท่านั้น — ระหว่างที่ยังไม่ deploy โค้ดที่รันอยู่
-- ยังส่งบทบาท vehicle_authority และเรียก v3 ได้อยู่ ถ้าถอดก่อนจะบันทึกไม่ผ่านและได้
-- error ที่อ่านไม่ออก (บทเรียนเดียวกับ 20260904160000/20260904170000)
--
-- ค่าตั้งต้นของช่องผู้มีอำนาจสั่งใช้รถย้ายไปเป็นเครื่องหมาย is_vehicle_order_default
-- ที่ติ๊กได้ที่แถวไหนก็ได้แล้ว บทบาทสำเร็จรูปนี้จึงซ้ำซ้อน

-- แถวเก่าที่ยังเป็นบทบาทนี้ต้องแปลงเป็นแถวที่แอดมินสร้างเอง ไม่ใช่ลบทิ้ง —
-- ข้อมูลที่ อปท. ตั้งไว้ต้องไม่หายไปเงียบๆ ชื่อแถวใช้ชื่อเดิมที่ผู้ใช้คุ้นอยู่แล้ว
-- และยกเครื่องหมายค่าตั้งต้นให้ด้วย เพราะเดิมบทบาทนี้ทำหน้าที่นั้นอยู่
UPDATE public.document_signatories
SET signatory_role = 'custom',
    custom_label = 'ผู้มีอำนาจสั่งใช้รถ',
    is_vehicle_order_default = is_active,
    updated_at = now()
WHERE signatory_role = 'vehicle_authority';

ALTER TABLE public.document_signatories
  DROP CONSTRAINT IF EXISTS document_signatories_role_check;
ALTER TABLE public.document_signatories
  ADD CONSTRAINT document_signatories_role_check
  CHECK (signatory_role IN ('department_head', 'clerk', 'mayor', 'custom'));

ALTER TABLE public.document_signatories
  DROP CONSTRAINT IF EXISTS document_signatories_role_scope_check;
ALTER TABLE public.document_signatories
  ADD CONSTRAINT document_signatories_role_scope_check
  CHECK (
    (signatory_role = 'department_head' AND department_id IS NOT NULL)
    OR (signatory_role IN ('clerk', 'mayor', 'custom') AND department_id IS NULL)
  );

-- ทริปเก่าที่ชี้บทบาทนี้ต้องชี้แถวที่แปลงแล้วแทน ไม่งั้นตอนพิมพ์จะ resolve ไม่เจอ
-- แล้วเว้นช่องลงนามว่างโดยไม่มีอะไรบอกว่าทำไม
UPDATE public.fleet_trips
SET order_authority_role = 'custom',
    order_authority_label = 'ผู้มีอำนาจสั่งใช้รถ'
WHERE order_authority_role = 'vehicle_authority';

ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_order_authority_role_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_order_authority_role_check
  CHECK (
    order_authority_role IS NULL
    OR order_authority_role IN ('mayor', 'clerk', 'custom')
  )
  NOT VALID;

REVOKE EXECUTE ON FUNCTION public.set_document_signatory_v3(
  uuid, text, uuid, uuid, text, text, text, date, date, text
) FROM authenticated;
