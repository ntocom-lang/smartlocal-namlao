-- PRE-FLIGHT ก่อนรัน 20260816170000_unify_personnel_directory.sql
--
-- ทำไมต้องเช็คก่อน:
-- ฟังก์ชัน get_public_personnel_directory() ดึงจาก profiles JOIN positions
-- โดยกรอง positions.category IN ('political_exec','top_admin','dept_head')
-- แต่ตอนนี้ระบบยังวิ่งบน fallback ตาราง staff เดิม (เพราะฟังก์ชันไม่มีใน DB)
--
-- จุดตาย: fallback ใน src/lib/personnelDirectory.js ทำงานเฉพาะเมื่อ RPC คืน error
-- ไม่ได้ทำงานเมื่อ RPC สำเร็จแต่คืน 0 แถว — พอฟังก์ชันมีตัวตนขึ้นมา ระบบจะเลิกใช้
-- staff ทันที ถ้า profiles.position_id ยังไม่ถูกกรอก หน้าบุคลากรบนเว็บสาธารณะ
-- จะว่างเปล่าโดยไม่มีอะไรรับ และไม่มี error ให้เห็นด้วย
--
-- อ่านผล: ถ้า new_directory_rows < legacy_staff_rows ในเทศบาลไหน = เทศบาลนั้น
-- ข้อมูลจะหายไปจากหน้าเว็บ ต้องไปกรอก position_id ใน profiles ให้ครบก่อนรัน migration
--
-- รันได้ซ้ำ ไม่แก้ไขข้อมูลใดๆ

SELECT
  m.slug,
  m.name,
  (SELECT count(*) FROM public.staff s
    WHERE s.municipality_id = m.id AND s.is_active) AS legacy_staff_rows,
  (SELECT count(*) FROM public.profiles p
     JOIN public.positions pos ON pos.id = p.position_id
    WHERE p.municipality_id = m.id
      AND pos.category IN ('political_exec', 'top_admin', 'dept_head')
      AND nullif(btrim(p.full_name), '') IS NOT NULL) AS new_directory_rows,
  (SELECT count(*) FROM public.profiles p
    WHERE p.municipality_id = m.id AND p.position_id IS NOT NULL) AS profiles_with_position
FROM public.municipalities m
ORDER BY m.slug;
