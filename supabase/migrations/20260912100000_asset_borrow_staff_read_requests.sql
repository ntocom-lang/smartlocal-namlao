-- เจ้าหน้าที่พัสดุ (asset_staff) มองเห็นคำขอยืมพัสดุที่วิ่งเข้ากองตัวเองในกล่องงาน
--
-- ปัญหาเดิม: policy "read document_requests" ให้ role หลัก 'staff' เห็นเฉพาะแถวที่ assigned_to
-- เป็นตัวเอง แต่คำขอยืมพัสดุวิ่งเข้า "กองเจ้าของพัสดุ" ของแต่ละใบ (หลายกองได้ ยื่นครั้งเดียวแตก
-- หลายใบ — 20260911100100) ขณะที่หน้าผังงานตั้งผู้รับผิดชอบได้คนเดียวต่อประเภท
-- ผลคือเจ้าหน้าที่พัสดุที่แอดมินมอบ asset_staff ให้แล้ว มองไม่เห็นใบของกองตัวเองเลย
-- ทั้งที่เป็นคนเดียวที่ assert_asset_borrow_actor() อนุญาตให้อนุมัติ/จ่ายของ/รับคืน
--
-- ทางแก้: เพิ่ม policy แยกอีกข้อ ไม่แตะ "read document_requests" เดิม — Postgres รวม policy
-- แบบ permissive ด้วย OR ขอบเขตที่เปิดเพิ่มจึงจำกัดอยู่แค่ประเภท asset_borrow_request
-- และใช้เงื่อนไขเดียวกับ asset_can_manage() ที่ตัดสินสิทธิ์ดำเนินการ คนที่เห็น = คนที่ทำได้
--   asset_admin / admin / superadmin — ทุกกองใน อปท.
--   asset_staff                      — เฉพาะใบที่ department_id ตรงกับกองตัวเอง
--
-- ตารางลูก asset_borrow_requests / asset_borrow_items อ่านได้ตามแถวแม่ (EXISTS document_requests)
-- จึงเปิดตามให้เองโดยไม่ต้องแก้ ส่วน asset_borrow_events กรอง role หลักรวม 'staff' อยู่แล้ว
-- การเขียนไม่ต้องเปิดเพิ่ม — ทุกขั้นตอนของคำขอยืมผ่าน RPC SECURITY DEFINER (20260909100200)
--
-- PDPA: คนที่เห็นข้อมูลผู้ยืมเพิ่มขึ้นมีเฉพาะผู้ที่แอดมินมอบหน้าที่พัสดุของกองนั้นให้แล้ว

BEGIN;

DROP POLICY IF EXISTS "asset staff read asset_borrow requests" ON public.document_requests;
CREATE POLICY "asset staff read asset_borrow requests" ON public.document_requests
  FOR SELECT TO authenticated
  USING (
    document_type = 'asset_borrow_request'
    AND public.asset_can_manage(municipality_id, department_id)
  );

COMMIT;
