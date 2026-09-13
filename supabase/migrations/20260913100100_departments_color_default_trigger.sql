-- เติมสีประจำกองอัตโนมัติ + ใส่สีเริ่มต้นให้กองที่มีอยู่แล้วทุก อปท.
-- (คอลัมน์ departments.color สร้างในไฟล์ก่อนหน้า 20260913100000_departments_color_column.sql)
--
-- ทำไมเป็น trigger ไม่ใช่เลือกสีในหน้าจอ: กองไม่ได้ถูกสร้างจากหน้า "จัดการกอง" ทางเดียว
-- fleet_seed_departments() สร้างกองมาตรฐานให้ อปท. ใหม่ด้วย ถ้าเลือกสีเฉพาะในหน้าจอ อปท. ที่
-- เปิดใช้ใหม่จะได้แถบ ⬜ ทุกกองแบบที่ตำหนักธรรม/ทุ่งแค้วเป็นอยู่ trigger ครอบคลุมทุกช่องทาง
-- โดยไม่ต้อง CREATE OR REPLACE ฟังก์ชันเดิม (ซึ่งเขียนทับทั้งตัว เสี่ยงทำของที่มีอยู่หาย)
--
-- ⚠️ trigger เติมให้เฉพาะตอน INSERT ที่ color ว่าง — ห้ามเขียนทับสีที่แอดมินเลือกเองเด็ดขาด
-- และไม่เปลี่ยนสีตอนแก้ชื่อกอง (แอดมินเลือกสีไว้แล้ว เปลี่ยนชื่อไม่ควรทำให้สีเปลี่ยนตาม)

-- ── เลือกสีจากชื่อ/รหัสกอง ถ้าไม่เข้าเกณฑ์ใดเลย เลือกสีแรกที่ อปท. นั้นยังไม่มีกองไหนใช้ ─────────
-- จับจากชื่อด้วย เพราะ อปท. ที่สร้างกองเองได้ code เป็น dept_* ทั้งหมด จับจาก code อย่างเดียวไม่ได้
-- ลำดับเงื่อนไขมีผล: ชื่อแรกที่เข้าเกณฑ์ชนะ
-- SECURITY DEFINER เพราะต้องมองเห็นกองทั้งหมดของ อปท. นั้นเพื่อหาสีที่ยังว่าง ไม่ขึ้นกับ RLS ของคนที่สร้างกอง
CREATE FUNCTION public.department_default_color(p_municipality_id uuid, p_code text, p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  text := coalesce(p_name, '');
  v_code  text := coalesce(p_code, '');
  v_color text;
BEGIN
  v_color := CASE
    WHEN v_code = 'exec'        OR v_name LIKE '%ผู้บริหาร%' THEN 'red'
    WHEN v_code = 'general'     OR v_name LIKE '%ปลัด%'      THEN 'green'
    WHEN v_code = 'finance'     OR v_name LIKE '%คลัง%'      THEN 'yellow'
    WHEN v_code = 'engineering' OR v_name LIKE '%ช่าง%' OR v_name LIKE '%โยธา%' THEN 'blue'
    WHEN v_code = 'education'   OR v_name LIKE '%ศึกษา%'     THEN 'purple'
    WHEN v_code = 'health'      OR v_name LIKE '%สาธารณสุข%' THEN 'orange'
    WHEN v_name LIKE '%สวัสดิการ%' THEN 'brown'
    WHEN v_name LIKE '%ตรวจสอบ%'  THEN 'black'
    WHEN v_name LIKE '%สภา%'      THEN 'white'
  END;

  IF v_color IS NOT NULL THEN
    RETURN v_color;
  END IF;

  SELECT t.k INTO v_color
  FROM unnest(ARRAY['blue', 'green', 'yellow', 'purple', 'orange', 'brown', 'red', 'black', 'white'])
       WITH ORDINALITY AS t(k, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.municipality_id = p_municipality_id
      AND d.is_active
      AND d.color = t.k
  )
  ORDER BY t.ord
  LIMIT 1;

  -- ครบ 9 สีแล้ว (มีกองเกิน 9 กอง) ใช้ขาวซ้ำ แอดมินเปลี่ยนเองได้
  RETURN coalesce(v_color, 'white');
END;
$$;

-- ไม่เปิดให้เรียกผ่าน PostgREST RPC — ใช้ภายใน trigger กับ migration นี้เท่านั้น
REVOKE ALL ON FUNCTION public.department_default_color(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ── trigger เติมสีตอนสร้างกอง ────────────────────────────────────────────────
-- SECURITY DEFINER เพราะผู้สร้างกอง (admin ผ่านหน้าจอ) ไม่มีสิทธิ์ EXECUTE department_default_color
CREATE FUNCTION public.departments_fill_color()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.color IS NULL THEN
    NEW.color := public.department_default_color(NEW.municipality_id, NEW.code, NEW.name);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.departments_fill_color() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS departments_fill_color ON public.departments;
CREATE TRIGGER departments_fill_color
  BEFORE INSERT ON public.departments
  FOR EACH ROW
  EXECUTE FUNCTION public.departments_fill_color();

-- ── ใส่สีให้กองที่มีอยู่แล้ว ─────────────────────────────────────────────────
-- ทีละแถว (ไม่ใช่ UPDATE ก้อนเดียว) เพราะกองที่ไม่เข้าเกณฑ์ชื่อต้องเห็นสีที่แถวก่อนหน้าเพิ่งได้ไป
-- ไม่งั้นกองที่ตกเกณฑ์หลายกองใน อปท. เดียวกันจะได้สีเดียวกันหมด
-- เรียงตาม sort_order ให้กองที่อยู่บนสุดในหน้าจอได้สีก่อน ผลจึงคาดเดาได้ทุกครั้ง
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, municipality_id, code, name
    FROM public.departments
    WHERE color IS NULL
    ORDER BY municipality_id, sort_order, created_at
  LOOP
    UPDATE public.departments
    SET color = public.department_default_color(r.municipality_id, r.code, r.name)
    WHERE id = r.id;
  END LOOP;
END;
$$;
