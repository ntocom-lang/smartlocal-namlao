-- หมวดคำร้องมาตรฐาน "ซ่อมน้ำประปา" (water_repair) ให้ทุก อปท. — แจ้งซ่อมของโมดูลงานประปา
--
-- ทำไม (เจ้าของระบบเลือก 2569-09-14):
--   แจ้งซ่อมประปาใช้ระบบคำร้อง ไม่ใช่คำขอเอกสาร (ต้องส่งช่าง แนบรูป ปักหมุด และเป็นงานด่วน)
--   ตรวจฐานข้อมูลจริงแล้ว demo กับ thungkaew มีหมวด "ซ่อมน้ำประปา" อยู่แล้ว แต่แอดมินสร้างเอง
--   ได้รหัสสุ่ม (cat_mtsubkz2 / cat_mtsucpig) ส่วน namlao / tamnaktham ไม่มีเลย — ขัดกติกา
--   หลังบ้านทุก อปท. เหมือนกัน และโค้ดผูกหมวดรหัสสุ่มกับสวิตช์โมดูล waterworks ไม่ได้
--
-- สิ่งที่ทำ (transaction เดียว):
--   1. เปลี่ยนรหัสหมวดเดิม 2 แถวเป็น water_repair — คง id / ชื่อ / อีโมจิ / สี / กอง ที่แอดมินตั้งไว้
--      คำร้องเดิมจึงยังชี้ category_id เดิมได้ ไม่ต้องสร้างแถวใหม่
--   2. แก้ complaints.category ของคำร้องเดิม (ตอนตรวจมี 3 เรื่อง) ให้ตรงรหัสใหม่
--      ⚠️ ตรวจ trigger ของ complaints แล้วไม่มีตัวไหนบล็อก: ไม่ใช่หมวดเฉพาะกิจ ไม่เปลี่ยน status
--      ไม่แตะ rating · trg_resolve_complaint_routing หา category_id ใหม่จากรหัส water_repair
--      ได้แถวเดิม · ผลข้างเคียงเดียวคือ updated_at ของคำร้องเหล่านั้นเป็นเวลาที่รันไฟล์นี้
--   3. แก้ category_assignments (ผังช่างรายหมวด ตอนตรวจมี 2 แถว) ให้ตรงรหัสใหม่
--   4. สร้าง water_repair ให้ อปท. ที่ยังไม่มี — กองรับผิดชอบ: กองการประปา → กองช่าง
--      (ลำดับเดียวกับคำขอประปาใน route_document_request_department)
--      อปท. ที่ยังไม่ได้ตั้งกองเลย (muangphrae ตอนตรวจ) สร้างแบบปิดใช้งานไว้ เพราะ
--      trg_active_category_requires_department ห้ามหมวดที่เปิดอยู่ไม่มีกอง
--      แอดมินเลือกกองแล้วเปิดใช้งานเองได้ในหน้าประเภทคำร้อง
--
-- ⚠️ รหัส water_repair ต้องตรงกับ CATEGORY_MODULES ใน src/lib/complaintCategoryModules.js
-- ไม่แตะฟังก์ชัน/trigger ใดๆ — ไฟล์นี้แก้เฉพาะข้อมูล รันซ้ำได้ (ทุกขั้นเช็คก่อนเขียน)

BEGIN;

-- 1-3: ย้ายหมวดที่แอดมินสร้างเองมาเป็นรหัสมาตรฐาน
-- จับด้วยชื่อหมวดด้วย ไม่ใช่รหัสสุ่มอย่างเดียว กันไปเปลี่ยนหมวดอื่นที่บังเอิญได้รหัสซ้ำ
CREATE TEMP TABLE _water_repair_rename ON COMMIT DROP AS
SELECT category.id, category.municipality_id, category.value AS old_value
FROM public.complaint_categories AS category
WHERE category.value IN ('cat_mtsubkz2', 'cat_mtsucpig')
  AND category.label = 'ซ่อมน้ำประปา'
  AND NOT EXISTS (
    SELECT 1 FROM public.complaint_categories AS standard
    WHERE standard.municipality_id = category.municipality_id
      AND standard.value = 'water_repair'
  );

UPDATE public.complaint_categories AS category
SET value = 'water_repair'
FROM _water_repair_rename AS renamed
WHERE category.id = renamed.id;

UPDATE public.complaints AS complaint
SET category = 'water_repair'
FROM _water_repair_rename AS renamed
WHERE complaint.municipality_id = renamed.municipality_id
  AND complaint.category = renamed.old_value;

UPDATE public.category_assignments AS assignment
SET category = 'water_repair'
FROM _water_repair_rename AS renamed
WHERE assignment.municipality_id = renamed.municipality_id
  AND assignment.category = renamed.old_value;

-- 4: อปท. ที่ยังไม่มีหมวดนี้
INSERT INTO public.complaint_categories
  (municipality_id, value, label, emoji, color, text_color, sort_order, is_active, is_adhoc, department_id)
SELECT
  municipality.id,
  'water_repair',
  'ซ่อมน้ำประปา',
  '💧',
  '#DBEAFE',
  '#2563EB',
  COALESCE((SELECT max(existing.sort_order) FROM public.complaint_categories AS existing
            WHERE existing.municipality_id = municipality.id), -1) + 1,
  routed.department_id IS NOT NULL,
  false,
  routed.department_id
FROM public.municipalities AS municipality
CROSS JOIN LATERAL (
  SELECT COALESCE(
    public.resolve_work_department(municipality.id, 'waterworks', 'ประปา'),
    public.resolve_work_department(municipality.id, 'engineering', 'กองช่าง')
  ) AS department_id
) AS routed
WHERE NOT EXISTS (
  SELECT 1 FROM public.complaint_categories AS existing
  WHERE existing.municipality_id = municipality.id
    AND existing.value = 'water_repair'
);

COMMIT;
