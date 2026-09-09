-- โมดูล "ขอยืมพัสดุ/ครุภัณฑ์" เฟส 2/3 — RLS + สิทธิ์ตาราง
-- (ตารางสร้างไว้แล้วใน 20260909100000 ไฟล์นี้จึงอ้างถึงได้)
--
-- หลักการสิทธิ์มองเห็น: **ไม่เขียนตรรกะชุดใหม่**
-- 3 ตารางลูก (requests/items/events) ผูกกับแถวแม่ใน document_requests ตรงๆ ด้วย EXISTS
-- ใครเห็นแถวแม่ได้ ก็เห็นรายละเอียดการยืมของแถวนั้นได้ — PostgreSQL บังคับ RLS ของ
-- document_requests ในซับคิวรีของ policy ให้เองอยู่แล้ว จึงได้ผลลัพธ์ตรงกับ policy
-- "read document_requests" (20260802071000) ทุกกรณีโดยอัตโนมัติ:
--   ผู้ยื่น = คำขอตนเอง · superadmin = ทั้งหมด · admin = ทั้ง อปท.
--   officer = เฉพาะกองตน · staff = เฉพาะที่ถูกมอบหมาย
-- ถ้าวันหนึ่งแก้สิทธิ์ของ document_requests ตารางนี้จะตามไปเอง ไม่มีทางหลุดจากกันได้
--
-- ⚠️ ตารางลูกทั้ง 3 ตัว **ไม่มี policy INSERT/UPDATE/DELETE เลยโดยตั้งใจ** — เขียนได้ทาง
-- RPC (SECURITY DEFINER) ในไฟล์ 20260909100200 เท่านั้น นี่คือสิ่งที่รับประกันว่าผู้ยื่น
-- แก้สถานะอนุมัติ/จำนวนที่จ่าย/สภาพของคืนเองไม่ได้ ต่อให้ยิง PostgREST ตรงก็ตาม
-- (ให้ GRANT แค่ SELECT ไม่ให้ INSERT/UPDATE/DELETE ซ้ำอีกชั้นหนึ่ง)

BEGIN;

-- ===========================================================================
-- borrowable_assets — ทะเบียนของ (ตารางเดียวที่แก้ผ่าน PostgREST ตรงได้)
-- ===========================================================================
ALTER TABLE public.borrowable_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read borrowable_assets" ON public.borrowable_assets;
DROP POLICY IF EXISTS "manage borrowable_assets" ON public.borrowable_assets;

-- ประชาชน (role = citizen) เห็นเฉพาะแถวที่แอดมินเปิดให้ยืมและยังใช้งานอยู่
-- — รหัสครุภัณฑ์และจำนวนของที่ไม่ได้เปิด ประชาชนไม่เห็นเลยแม้แต่ชื่อ
-- บุคลากรทุกบทบาทใน อปท. เห็นทั้งทะเบียน (ต้องเลือกของตอนรับเรื่องแทนประชาชนหน้าเคาน์เตอร์)
CREATE POLICY "read borrowable_assets" ON public.borrowable_assets
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (
      municipality_id = public.get_my_municipality_id()
      AND (
        public.get_my_role() <> 'citizen'
        OR (is_public_borrowable AND is_active)
      )
    )
  );

-- แก้ทะเบียนได้: แอดมินของ อปท. (ทั้งหมด) และหัวหน้ากอง (เฉพาะของกองตัวเอง)
-- หัวหน้ากองต้องแก้เองได้ ไม่งั้นทุกครั้งที่ซื้อเก้าอี้เพิ่มต้องรอแอดมิน
CREATE POLICY "manage borrowable_assets" ON public.borrowable_assets
  FOR ALL TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
  )
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
    OR (public.get_my_role() = 'officer' AND public.is_my_department(municipality_id, department_id))
  );

-- ===========================================================================
-- asset_borrow_requests / items / events — อ่านอย่างเดียว เขียนผ่าน RPC
-- ===========================================================================
ALTER TABLE public.asset_borrow_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_borrow_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_borrow_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read asset_borrow_requests" ON public.asset_borrow_requests;
CREATE POLICY "read asset_borrow_requests" ON public.asset_borrow_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.document_requests AS parent
      WHERE parent.id = asset_borrow_requests.request_id
    )
  );

DROP POLICY IF EXISTS "read asset_borrow_items" ON public.asset_borrow_items;
CREATE POLICY "read asset_borrow_items" ON public.asset_borrow_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.document_requests AS parent
      WHERE parent.id = asset_borrow_items.request_id
    )
  );

-- ประวัติการดำเนินการเป็นข้อมูลภายใน — ผู้ยื่นดูสถานะจากหน้า "เอกสารของฉัน" ได้อยู่แล้ว
-- ไม่ต้องเห็นบันทึกภายในของเจ้าหน้าที่ (staff_note/เหตุผลที่ขยายเวลา ฯลฯ)
DROP POLICY IF EXISTS "read asset_borrow_events" ON public.asset_borrow_events;
CREATE POLICY "read asset_borrow_events" ON public.asset_borrow_events
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (
      municipality_id = public.get_my_municipality_id()
      AND public.get_my_role() IN ('admin', 'officer', 'staff')
      AND EXISTS (
        SELECT 1 FROM public.document_requests AS parent
        WHERE parent.id = asset_borrow_events.request_id
      )
    )
  );

-- ===========================================================================
-- สิทธิ์ระดับตาราง
-- default privileges ของ schema public ใน Supabase แจก grant ให้ anon ด้วย ต้องถอนเองทุกตาราง
-- (ดู 20260905200000_revoke_anon_write_grants.sql) — โมดูลนี้บังคับล็อกอิน ไม่มีช่องทาง anon
-- ===========================================================================
REVOKE ALL ON TABLE public.borrowable_assets     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.asset_borrow_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.asset_borrow_items    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.asset_borrow_events   FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.borrowable_assets TO authenticated;

-- อ่านอย่างเดียวจริงๆ — ไม่มี INSERT/UPDATE/DELETE ให้ authenticated เลย
-- RPC เป็น SECURITY DEFINER จึงเขียนได้เองโดยไม่ต้องพึ่ง grant เหล่านี้
GRANT SELECT ON TABLE public.asset_borrow_requests TO authenticated;
GRANT SELECT ON TABLE public.asset_borrow_items    TO authenticated;
GRANT SELECT ON TABLE public.asset_borrow_events   TO authenticated;

COMMIT;
