-- เฟส 1/3 ของ "ทะเบียนผู้ขายน้ำมัน" — สร้างตารางอย่างเดียว
-- ไฟล์ถัดไป (20260908150100) จึงจะอ้างตารางนี้เป็น FK ได้
--
-- ที่มา: ช่อง fleet_fuel_records.fuel_station เป็นข้อความอิสระที่เจ้าหน้าที่พิมพ์ว่า
-- "ปตท." / "เชลล์" ซึ่งเป็นแบรนด์ ไม่ใช่คู่สัญญาตามใบกำกับภาษี (เช่น
-- "บริษัท พลกฤตเซอร์วิสเอ็นเนอร์ยี่ จำกัด" เลขผู้เสียภาษี 0545550000062)
-- ผู้ตรวจสอบต้องการชื่อนิติบุคคลกับเลขผู้เสียภาษีที่ตรงกันทุกใบ การพิมพ์ซ้ำทุกครั้ง
-- ทำให้เลข 13 หลักผิดได้ง่ายและชื่อเพี้ยนกันเอง จึงต้องตั้งเป็นทะเบียนกลางแล้วเลือกใช้

CREATE TABLE IF NOT EXISTS public.fleet_vendors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  name            text NOT NULL,
  tax_id          text,
  branch          text,
  phone           text,
  address         text,
  -- เลิกใช้ผู้ขายรายไหนให้ปิด is_active ห้ามลบทิ้ง ประวัติการเติมน้ำมันเก่ายังอ้างอยู่
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid
);

COMMENT ON TABLE public.fleet_vendors IS
  'ทะเบียนผู้ขายน้ำมัน/ปั๊ม ตามชื่อนิติบุคคลในใบกำกับภาษี ใช้อ้างอิงในบันทึกการเติมเชื้อเพลิง';
COMMENT ON COLUMN public.fleet_vendors.name IS 'ชื่อผู้ขายตามใบกำกับภาษี ไม่ใช่ชื่อแบรนด์';
COMMENT ON COLUMN public.fleet_vendors.tax_id IS 'เลขประจำตัวผู้เสียภาษี 13 หลัก ของนิติบุคคลผู้ขาย';
COMMENT ON COLUMN public.fleet_vendors.branch IS 'สาขาตามใบกำกับภาษี เช่น 00001 หรือ สำนักงานใหญ่';

ALTER TABLE public.fleet_vendors
  DROP CONSTRAINT IF EXISTS fleet_vendors_name_length_check;
ALTER TABLE public.fleet_vendors
  ADD CONSTRAINT fleet_vendors_name_length_check
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);

-- เลขผู้เสียภาษีเป็นตัวเลข 13 หลักเสมอ ปล่อยว่างได้สำหรับร้านที่ไม่จดทะเบียน
ALTER TABLE public.fleet_vendors
  DROP CONSTRAINT IF EXISTS fleet_vendors_tax_id_format_check;
ALTER TABLE public.fleet_vendors
  ADD CONSTRAINT fleet_vendors_tax_id_format_check
  CHECK (tax_id IS NULL OR btrim(tax_id) ~ '^[0-9]{13}$');

ALTER TABLE public.fleet_vendors
  DROP CONSTRAINT IF EXISTS fleet_vendors_branch_length_check;
ALTER TABLE public.fleet_vendors
  ADD CONSTRAINT fleet_vendors_branch_length_check
  CHECK (branch IS NULL OR char_length(btrim(branch)) BETWEEN 1 AND 30);

-- กันตั้งผู้ขายรายเดียวกันซ้ำจนรายงานแยกเป็นสองราย (เทียบเฉพาะสาขาเดียวกัน)
CREATE UNIQUE INDEX IF NOT EXISTS fleet_vendors_tenant_tax_branch_key
  ON public.fleet_vendors (municipality_id, tax_id, coalesce(btrim(branch), ''))
  WHERE tax_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS fleet_vendors_tenant_active_idx
  ON public.fleet_vendors (municipality_id, is_active, name);

DROP TRIGGER IF EXISTS trg_fleet_vendors_updated_at ON public.fleet_vendors;
CREATE TRIGGER trg_fleet_vendors_updated_at
BEFORE UPDATE ON public.fleet_vendors
FOR EACH ROW EXECUTE FUNCTION public.fleet_set_updated_meta();

ALTER TABLE public.fleet_vendors ENABLE ROW LEVEL SECURITY;

-- อ่านได้ทุกคนที่มี fleet_role ใน อปท. นั้น (ต้องเห็นชื่อผู้ขายตอนบันทึกน้ำมัน)
-- เขียนได้เฉพาะ fleet_admin หรือ admin ของ อปท. — ยึดรูปแบบเดียวกับ fleet_budgets
DROP POLICY IF EXISTS fvendor_read ON public.fleet_vendors;
CREATE POLICY fvendor_read ON public.fleet_vendors
FOR SELECT TO authenticated
USING (
  (
    (SELECT frole FROM public.my_fleet()) IS NOT NULL
    AND municipality_id = (SELECT mun_id FROM public.my_fleet())
  )
  OR (
    public.get_my_role() = ANY (ARRAY['admin', 'superadmin'])
    AND (public.get_my_role() = 'superadmin' OR municipality_id = public.get_my_municipality_id())
  )
);

DROP POLICY IF EXISTS fvendor_write ON public.fleet_vendors;
CREATE POLICY fvendor_write ON public.fleet_vendors
FOR ALL TO authenticated
USING (
  (
    (SELECT frole FROM public.my_fleet()) = 'fleet_admin'
    AND municipality_id = (SELECT mun_id FROM public.my_fleet())
  )
  OR (
    public.get_my_role() = ANY (ARRAY['admin', 'superadmin'])
    AND (public.get_my_role() = 'superadmin' OR municipality_id = public.get_my_municipality_id())
  )
)
WITH CHECK (
  (
    (SELECT frole FROM public.my_fleet()) = 'fleet_admin'
    AND municipality_id = (SELECT mun_id FROM public.my_fleet())
  )
  OR (
    public.get_my_role() = ANY (ARRAY['admin', 'superadmin'])
    AND (public.get_my_role() = 'superadmin' OR municipality_id = public.get_my_municipality_id())
  )
);

-- ห้าม anon แตะเด็ดขาด ตารางนี้มีชื่อ/เลขผู้เสียภาษีของคู่สัญญา
REVOKE ALL ON public.fleet_vendors FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_vendors TO authenticated;
