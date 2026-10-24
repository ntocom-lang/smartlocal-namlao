-- หมวดคำร้องมาตรฐาน "น้ำท่วม/ระบายน้ำ" (flood) ให้ทุก อปท. — ให้ประชาชนแจ้งเรื่องน้ำท่วม/น้ำระบายไม่ทัน ผ่านระบบคำร้องได้
--
-- ทำไม (เจ้าของระบบเลือก 2569-10-24 "ครบ จบ เรื่องน้ำ จะไม่มีคำถามตามมา"):
--   แถว "เกิดเหตุหรือต้องการความช่วยเหลือเรื่องน้ำ" ท้ายแท็บผังน้ำตำบลของหน้า /water-situation (WaterHelpRow.jsx · #575)
--   ขึ้นปุ่มแจ้งเรื่องก็ต่อเมื่อ อปท. นั้นมีหมวดรหัส flood เปิดให้ผู้ใช้คนนั้นยื่นได้ — ตรวจ production 2569-10-24 แล้วไม่มี อปท. ไหนมีเลย
--   และแอดมินสร้างรหัสนี้เองไม่ได้ (เมนูสร้างหมวดใหม่ให้รหัสสุ่ม cat_xxxx · รายการหมวดตั้งต้นไม่มี flood)
--   ขัดกติกา "หลังบ้านทุก อปท. ต้องเหมือนกัน" — แบบเดียวกับที่ water_repair เคยเป็น (20260914130000_waterworks_repair_category.sql)
--
-- สิ่งที่ทำ (transaction เดียว) — สร้าง flood ให้ อปท. ที่ยังไม่มี (ไม่แตะ อปท. ที่มีอยู่แล้ว):
--   • กองรับผิดชอบ: กองช่าง (engineering) — ตรงกับกติกาเดิมที่ 20260901160000_complaint_routing_and_signatories.sql จัด flood ไว้กลุ่ม engineering
--     (resolve_work_department เลือกกองที่มีบุคลากรใช้งานจริงก่อน เหมือนเส้นทางคำขอประปา) · เปลี่ยนกองได้เองที่ Admin > ประเภทคำร้อง
--   • เปิดให้ใคร: "ตามนโยบายของ อปท. นั้นเองเรื่องน้ำอุปโภค" — คัดลอก is_active + submit_audience จากหมวด water_supply ของ อปท. เดียวกัน
--     (เปิดให้ทุกคนที่ตำหนักธรรม/ทุ่งแค้ว → flood เปิดให้ทุกคน · ปิด/เฉพาะผู้มีตำแหน่งที่น้ำเลา (อปท. ที่ใช้งานจริง) → flood ปิด+เฉพาะผู้มีตำแหน่ง)
--     ไม่เปิดช่องทางใหม่ให้ประชาชนของ อปท. ที่ใช้งานจริงโดยเจ้าของระบบยังไม่สั่ง — เปิดเองได้ที่ Admin > ประเภทคำร้อง (สวิตช์ใช้งาน + "ใครแจ้งได้")
--     ไม่มีแถว water_supply = ปิด + เฉพาะผู้มีตำแหน่ง (ค่าปลอดภัยไว้ก่อน)
--   • ไม่มีกองช่างเลย = สร้างแบบปิดใช้งาน เพราะ trg_active_category_requires_department ห้ามหมวดที่เปิดอยู่ไม่มีกอง (แอดมินเลือกกองแล้วเปิดเอง)
--
-- ⚠️ รหัส flood ต้องตรงกับ WATER_HELP_CATEGORIES ใน src/lib/waterHelp.js และ DEFAULT_SEED ใน src/pages/AdminDashboard.jsx
-- ไม่แตะฟังก์ชัน/trigger ใดๆ — ไฟล์นี้แก้เฉพาะข้อมูล รันซ้ำได้ (ข้ามที่มี flood อยู่แล้ว)
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select m.slug, c.is_active, c.submit_audience, d.name as department
--   from public.complaint_categories c
--   join public.municipalities m on m.id = c.municipality_id
--   left join public.departments d on d.id = c.department_id
--   where c.value = 'flood' order by m.slug;
--   → ทุก อปท. ต้องมี 1 แถว · น้ำเลา ต้องเป็น is_active=false, submit_audience=officials

BEGIN;

INSERT INTO public.complaint_categories
  (municipality_id, value, label, emoji, color, text_color, sort_order, is_active, submit_audience, is_adhoc, department_id)
SELECT
  municipality.id,
  'flood',
  'น้ำท่วม/ระบายน้ำ',
  '🌊',
  '#E0F2FE',
  '#0369A1',
  COALESCE((SELECT max(existing.sort_order) FROM public.complaint_categories AS existing
            WHERE existing.municipality_id = municipality.id), -1) + 1,
  routed.department_id IS NOT NULL AND COALESCE(supply.is_active, false),
  COALESCE(supply.submit_audience, 'officials'),
  false,
  routed.department_id
FROM public.municipalities AS municipality
CROSS JOIN LATERAL (
  SELECT public.resolve_work_department(municipality.id, 'engineering', 'กองช่าง') AS department_id
) AS routed
LEFT JOIN LATERAL (
  SELECT water_supply.is_active, water_supply.submit_audience
  FROM public.complaint_categories AS water_supply
  WHERE water_supply.municipality_id = municipality.id
    AND water_supply.value = 'water_supply'
  LIMIT 1
) AS supply ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.complaint_categories AS existing
  WHERE existing.municipality_id = municipality.id
    AND existing.value = 'flood'
);

COMMIT;
