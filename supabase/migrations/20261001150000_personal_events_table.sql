-- รายการส่วนตัวในปฏิทินกิจกรรม ("🔒 เฉพาะฉัน") — เจ้าของระบบสั่ง 2569-10-01
--
-- งานจริง: ผู้มีตำแหน่ง (ผู้บริหาร สมาชิกสภา เจ้าหน้าที่ ช่าง) อยากจดนัดหมาย/กำหนดการของตัวเองในปฏิทิน
-- เดียวกับกิจกรรมของหน่วยงาน โดยไม่มีใครอื่นเห็น ประชาชนไม่ได้ใช้
--
-- ทำไมเป็นตารางแยก ไม่ใช่ค่ากลุ่มเป้าหมายใหม่ใน events:
--   1) RLS ของ events คืนทุกแถวให้ผู้มีตำแหน่งทุกคนของ อปท. (ตัดรายละเอียดกันที่ชั้น RPC เท่านั้น)
--      ถ้าเก็บรวม เพื่อนร่วมงานที่ยิงคำสั่งเองจะอ่านของกันได้
--   2) หน้าสาธารณะ (หน้าแรก ปฏิทินย่อ) อ่านจาก events ตารางแยกจึงไม่มีทางหลุดไปโผล่
--   3) การเพิ่ม events ส่ง Telegram และการลบเขียนชื่อกิจกรรมลง audit_logs ที่แอดมินเปิดดูได้
--
-- เจ้าของระบบตัดสิน 2569-10-01:
--   - ใช้ได้ทุกคนที่มีตำแหน่ง ยกเว้นประชาชน (นิยามเดียวกับ STAFF_PORTAL_ROLES ใน src/lib/portalAccess.js)
--   - 100 รายการต่อคน เต็มแล้วเขียนทับรายการเก่า · ลงล่วงหน้าได้ไม่เกิน 1 ปี · มีปุ่ม "ทุกปี"
--   (กติกา 3 ข้อหลังบังคับด้วย trigger ในไฟล์ 20261001150100)
--
-- ⚠️ "เห็นเฉพาะเจ้าของ" หมายถึงผ่านหน้าเว็บและ API — ผู้ถือสิทธิ์ดูแลฐานข้อมูล (service_role) ยังอ่านได้
-- ข้อความในฟอร์มบอกผู้ใช้ไว้แล้ว และแนะนำว่าไม่ควรบันทึกเรื่องอ่อนไหว

BEGIN;

CREATE TABLE public.personal_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ลบบัญชีแล้วรายการหายตาม (ไม่มีใครอื่นเปิดดูได้ จึงไม่มีเหตุให้เก็บต่อ)
  owner_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text,
  event_date      date NOT NULL,
  end_date        date,
  event_time      time,
  end_time        time,
  location        text,
  category        text,
  -- true = ขึ้นตรงวันเดิมทุกปี (เช่น วันเกิด) เก็บเป็นกฎ 1 แถว หน้าเว็บคำนวณวันของแต่ละปีเอง
  repeat_yearly   boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- ตั้งชื่อ constraint ทุกตัว (บทเรียนจากทะเบียนผู้ลงนาม: CHECK แบบ inline ไม่มีชื่อ ต้องไล่หาตอนแก้)
  -- ความยาวต้องตรงกับ PERSONAL_LIMITS ใน src/lib/personalEvents.js (tests/personal-events.test.mjs เทียบให้)
  CONSTRAINT personal_events_title_len      CHECK (char_length(title) <= 200 AND btrim(title) <> ''),
  CONSTRAINT personal_events_desc_len       CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT personal_events_location_len   CHECK (location IS NULL OR char_length(location) <= 200),
  CONSTRAINT personal_events_category_len   CHECK (category IS NULL OR char_length(category) <= 60),
  CONSTRAINT personal_events_date_order     CHECK (end_date IS NULL OR end_date >= event_date),
  -- "ทุกปี" ใช้กับรายการวันเดียว — ช่วงหลายวันที่วนทุกปีมีกรณีขอบ (คร่อมปี, 29 ก.พ.) ที่ยังไม่มีใครต้องการ
  CONSTRAINT personal_events_yearly_one_day CHECK (NOT repeat_yearly OR end_date IS NULL)
);

-- ทุกคำสั่งของหน้าเว็บกรองด้วยเจ้าของ + อปท. แล้วเรียงตามวันที่ และ trigger นับ/หาแถวที่จะทับด้วยคู่เดียวกัน
CREATE INDEX personal_events_owner_idx
  ON public.personal_events (owner_id, municipality_id, event_date);

ALTER TABLE public.personal_events ENABLE ROW LEVEL SECURITY;

-- อ่าน/ลบ: เจ้าของเท่านั้น ไม่มี policy ของแอดมินหรือ superadmin โดยเจตนา
-- คนที่ถูกลดเป็นประชาชนทีหลังยังอ่านและลบของตัวเองได้ (เป็นข้อมูลของเขา) แต่เพิ่ม/แก้ไม่ได้
CREATE POLICY "personal events owner read" ON public.personal_events
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- เพิ่ม/แก้: เป็นเจ้าของ และเป็นผู้มีตำแหน่งของ อปท. นั้น — ลิสต์ role ต้องตรงกับ STAFF_PORTAL_ROLES
-- (superadmin ไม่มีสังกัด จึงแยกเงื่อนไข) tests/personal-events.test.mjs เทียบลิสต์นี้กับหน้าเว็บทุกครั้ง
CREATE POLICY "personal events owner insert" ON public.personal_events
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      public.get_my_role() = 'superadmin'
      OR (
        public.get_my_role() IN ('admin', 'officer', 'viewer', 'council', 'staff', 'technician')
        AND municipality_id = public.get_my_municipality_id()
      )
    )
  );

CREATE POLICY "personal events owner update" ON public.personal_events
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      public.get_my_role() = 'superadmin'
      OR (
        public.get_my_role() IN ('admin', 'officer', 'viewer', 'council', 'staff', 'technician')
        AND municipality_id = public.get_my_municipality_id()
      )
    )
  );

CREATE POLICY "personal events owner delete" ON public.personal_events
  FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- Supabase แจกสิทธิ์ตารางใหม่ใน public ให้ anon/authenticated อัตโนมัติ ต้องถอนเอง
-- TRUNCATE ไม่ผ่าน RLS จึงต้องถอนด้วย (ดูบันทึก anon table grants)
REVOKE ALL ON public.personal_events FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.personal_events FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_events TO authenticated;

COMMENT ON TABLE public.personal_events IS
  'รายการส่วนตัวในปฏิทิน (เฉพาะฉัน) ของผู้มีตำแหน่ง — อ่าน/เขียนได้เฉพาะเจ้าของ แอดมินไม่เห็น '
  '100 รายการต่อคนต่อ อปท. เต็มแล้ว trigger ทับรายการเก่า ไม่ส่งแจ้งเตือน ไม่ลง audit_logs';

COMMIT;

-- ดูการใช้งานโดยไม่เปิดเนื้อหา (สำหรับผู้ดูแลฐานข้อมูล):
--   SELECT m.slug, count(*) AS entries, count(DISTINCT p.owner_id) AS owners,
--          pg_size_pretty(pg_total_relation_size('public.personal_events')) AS table_size
--     FROM public.personal_events p JOIN public.municipalities m ON m.id = p.municipality_id
--    GROUP BY m.slug ORDER BY 2 DESC;
--
-- ย้อนกลับ (รายการที่ผู้ใช้จดไว้จะหายทั้งหมด — ถอนโค้ดหน้าเว็บก่อน):
--   DROP TABLE public.personal_events;
--   DROP FUNCTION IF EXISTS public.personal_events_guard();
