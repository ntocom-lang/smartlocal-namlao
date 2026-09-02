-- ช่องลงนาม "ผู้อำนวยการกอง/หัวหน้ากอง" และ "ผู้มีอำนาจสั่งใช้รถ" บนใบขออนุญาต
-- ใช้รถส่วนกลาง (แบบ 3) ให้เจ้าหน้าที่เลือกได้เองตอนสร้างคำขอ โดยดึงตัวจริงจาก
-- ทะเบียนผู้ลงนามกลาง (public.document_signatories)
--
-- เก็บ "ตัวชี้" ไม่ใช่ FK ไป document_signatories.id และไม่ใช่ snapshot ชื่อ เพราะ:
--   1. set_document_signatory_v2 เปลี่ยนตัวผู้ลงนามด้วยการปิดแถวเก่า (is_active=false)
--      แล้วสร้างแถวใหม่ FK จึงจะค้างชี้แถวที่ปิดไปแล้ว และ ON DELETE RESTRICT
--      ของ profile_id ยังบล็อกการลบบุคลากรเพิ่มอีกชั้น
--   2. ทริปที่สร้างวันนี้อาจพิมพ์อีกหลายวันถัดไป ถ้า อปท. เปลี่ยนตัวนายกหรือหัวหน้ากอง
--      ระหว่างนั้น ใบที่พิมพ์ต้องขึ้นชื่อคนปัจจุบันที่จะเซ็นจริง ไม่ใช่ชื่อ ณ วันที่กรอกฟอร์ม
-- ชื่อที่พิมพ์ใต้เส้นเป็นเพียงการระบุว่าใครควรเซ็น ตัวเอกสารจริงมีลายเซ็นสดกำกับอยู่แล้ว
--
-- ทั้งสองคอลัมน์เป็น NULL ได้และค่าเริ่มต้นคือ NULL แปลว่า "ใช้ค่าปริยาย" —
-- หัวหน้ากองตาม department_id ของทริปเอง และผู้มีอำนาจสั่งใช้รถคือนายก
-- ซึ่งตรงกับพฤติกรรมเดิมเป๊ะ ทริปเก่าทุกใบจึงพิมพ์ได้เหมือนเดิมโดยไม่ต้อง backfill

ALTER TABLE public.fleet_trips
  ADD COLUMN IF NOT EXISTS dept_head_department_id uuid,
  ADD COLUMN IF NOT EXISTS order_authority_role text;

COMMENT ON COLUMN public.fleet_trips.dept_head_department_id IS
  'กองที่หัวหน้ากองจะลงนามช่อง "ผู้อำนวยการกอง/หัวหน้ากอง" ในแบบ 3 (NULL = ใช้ department_id ของทริป) ชื่อผู้ลงนามอ่านจาก document_signatories ตอนพิมพ์';
COMMENT ON COLUMN public.fleet_trips.order_authority_role IS
  'บทบาทผู้มีอำนาจสั่งใช้รถในแบบ 3: mayor หรือ clerk (NULL = mayor) ชื่อผู้ลงนามอ่านจาก document_signatories ตอนพิมพ์';

-- ON DELETE SET NULL: กองถูกยุบ/รวมได้จริงในทางปฏิบัติ ทริปเก่าต้องไม่ถูกบล็อกการลบกอง
-- และต้องถอยกลับไปใช้ค่าปริยายแทนที่จะชี้กองที่ไม่มีอยู่
ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_dept_head_department_id_fkey;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_dept_head_department_id_fkey
  FOREIGN KEY (dept_head_department_id) REFERENCES public.departments(id) ON DELETE SET NULL
  NOT VALID;

-- จำกัดเฉพาะนายกกับปลัด — ผู้มีอำนาจสั่งใช้รถต้องเป็นผู้บริหารท้องถิ่นหรือผู้รักษา
-- ราชการแทน/ผู้รับมอบอำนาจ การเปิดให้เลือกหัวหน้ากองใดก็ได้เสี่ยงระบุผู้ไม่มีอำนาจ
-- ลงในเอกสารซึ่งเป็นประเด็นที่ สตง. ทักท้วง กรณีมอบอำนาจให้ผู้อื่นให้ระบุคำว่า
-- "รักษาราชการแทน..." ในช่องชื่อตำแหน่งที่พิมพ์ของทะเบียนผู้ลงนามแทน
ALTER TABLE public.fleet_trips
  DROP CONSTRAINT IF EXISTS fleet_trips_order_authority_role_check;
ALTER TABLE public.fleet_trips
  ADD CONSTRAINT fleet_trips_order_authority_role_check
  CHECK (order_authority_role IS NULL OR order_authority_role IN ('mayor', 'clerk'))
  NOT VALID;

-- ใช้ตอนพิมพ์เท่านั้น (ทีละใบ) จึงไม่ต้องมี index — ไม่มี query ไหนกรองด้วยคอลัมน์นี้
--
-- ไม่ต้อง GRANT เพิ่ม: fleet_trips ใช้สิทธิ์ระดับตาราง ไม่ใช่ column-level grant
-- แบบ municipalities คอลัมน์ใหม่จึงอยู่ใต้ policy fleet_trips_select/insert/update เดิม
-- ที่คุมด้วย municipality_id + my_fleet() อยู่แล้ว
