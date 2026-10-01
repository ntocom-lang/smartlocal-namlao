-- มอบหมายผู้ไปแทนในกิจกรรมปฏิทิน (เจ้าของระบบสั่ง 2569-10-01)
--
-- งานจริง: เจ้าหน้าที่ลงกำหนดการให้ผู้บริหาร แล้วนายก/เลขาฯ ตัดสินว่าจะส่งใครไปประชุมหรือเปิดงานแทน
-- ช่องนี้ให้ "แจ้งในปฏิทินได้เลย" ไม่ต้องโทรตามกัน
--
-- ⚠️ เป็นบันทึกเพื่อแจ้งให้ทราบภายในเท่านั้น ไม่ใช่คำสั่งมอบหมาย/มอบอำนาจตามกฎหมาย
-- (การมอบอำนาจของนายกต้องทำเป็นคำสั่งตามกฎหมายของ อปท. นั้น — ต้องยืนยันกับฉบับปัจจุบัน:
--  พ.ร.บ.เทศบาล หมวดนายกเทศมนตรี / พ.ร.บ.สภาตำบลและองค์การบริหารส่วนตำบล หมวดนายก อบต.)
--
-- ทำไมเป็นตารางแยก ไม่ใช่คอลัมน์ใน events: เจ้าของระบบเลือกให้ "เฉพาะบุคลากรภายในเห็น"
-- ถ้าเป็นคอลัมน์ใน events ประชาชนที่ล็อกอิน (role authenticated เหมือนเจ้าหน้าที่) อ่านกิจกรรมสาธารณะ
-- ได้ทั้งแถวผ่าน RLS เดิม จะเห็นชื่อผู้รับมอบหมายไปด้วย ตารางแยกจึงกั้นได้ตั้งแต่ระดับฐานข้อมูล
--
-- เขียนได้ทางเดียวคือ RPC set_event_assignments (ไฟล์ 20261001120100) ซึ่งตรวจสิทธิ์ ประทับผู้บันทึก/เวลา
-- และเขียน audit_logs เอง — ตารางนี้จึงไม่มี policy INSERT/UPDATE/DELETE

BEGIN;

CREATE TABLE public.event_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  -- null = พิมพ์ชื่อเอง (คนที่ไม่มีบัญชีในระบบ เช่น รองนายกคนที่ 2 ของน้ำเลา)
  profile_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- ชื่อ/ตำแหน่ง ณ วันที่บันทึก — ย้ายตำแหน่งภายหลังบันทึกเก่าไม่เปลี่ยนตาม (เจตนา)
  assignee_name   text NOT NULL,
  assignee_title  text,
  task            text NOT NULL,
  on_behalf_of    text,
  sort_order      smallint NOT NULL DEFAULT 0,
  assigned_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  -- ตั้งชื่อ constraint ทุกตัว (บทเรียนจากทะเบียนผู้ลงนาม: CHECK แบบ inline ไม่มีชื่อ ต้องไล่หาตอนแก้)
  CONSTRAINT event_assignments_name_len   CHECK (char_length(btrim(assignee_name)) BETWEEN 1 AND 120),
  CONSTRAINT event_assignments_title_len  CHECK (assignee_title IS NULL OR char_length(assignee_title) <= 120),
  -- attend = ไปประชุมแทน · preside = เป็นประธาน/เปิดงานแทน · join = ร่วมงานแทน
  CONSTRAINT event_assignments_task_chk   CHECK (task IN ('attend', 'preside', 'join')),
  CONSTRAINT event_assignments_behalf_len CHECK (on_behalf_of IS NULL OR char_length(on_behalf_of) <= 120)
);

CREATE INDEX event_assignments_event_idx
  ON public.event_assignments (event_id, sort_order);
CREATE INDEX event_assignments_profile_idx
  ON public.event_assignments (profile_id) WHERE profile_id IS NOT NULL;
-- คนเดียวกันซ้ำในกิจกรรมเดียวไม่ได้ (ชื่อที่พิมพ์เองไม่บังคับ เพราะคนละคนชื่อซ้ำกันได้)
CREATE UNIQUE INDEX event_assignments_event_profile_uniq
  ON public.event_assignments (event_id, profile_id) WHERE profile_id IS NOT NULL;

ALTER TABLE public.event_assignments ENABLE ROW LEVEL SECURITY;

-- อ่านได้เฉพาะบุคลากรภายในของ อปท. เดียวกัน — กว้างเท่ากับ policy "events select by audience" ของตาราง
-- events (ตัดสิทธิ์รายกลุ่มที่ชั้น RPC list_events_for_staff เหมือนรายละเอียดกิจกรรม)
CREATE POLICY "event assignments read internal" ON public.event_assignments
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (
      public.get_my_role() IN ('admin', 'officer', 'viewer', 'council', 'staff', 'technician')
      AND municipality_id = public.get_my_municipality_id()
    )
  );

-- Supabase แจกสิทธิ์ตารางใหม่ใน public ให้ anon/authenticated อัตโนมัติ ต้องถอนเอง
-- TRUNCATE ไม่ผ่าน RLS จึงต้องถอนด้วย (ดูบันทึก anon table grants)
REVOKE ALL ON public.event_assignments FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.event_assignments FROM authenticated;
GRANT SELECT ON public.event_assignments TO authenticated;

-- ตำแหน่งที่จะแสดง: job_title ที่แอดมินกรอกเองมาก่อน (กติกาเดียวกับ signatoryTitle ใน
-- src/lib/documentSignatories.js) ไม่มีจึงใช้ชื่อในทะเบียนตำแหน่ง ซึ่งเขียนรวม 2 แบบไว้ในชื่อเดียว
-- เช่น "นายกเทศมนตรี / นายกองค์การบริหารส่วนตำบล" → ตัดเหลือฝั่งที่ตรงกับประเภท อปท.
-- org_type ที่ไม่รู้จัก/ว่างตกฝั่ง อบต. ตาม DEFAULT_ORG_TYPE ใน src/lib/orgTerms.js
-- (ยังไม่รองรับ อบจ. — ทะเบียนตำแหน่งไม่มีชื่อแบบ อบจ. ถ้ามีวันหน้าต้องเพิ่มกติกา)
CREATE OR REPLACE FUNCTION public.event_assignee_title(p_job_title text, p_position_name text, p_org_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT NULLIF(btrim(COALESCE(
    NULLIF(btrim(p_job_title), ''),
    CASE
      WHEN p_position_name IS NULL THEN NULL
      WHEN strpos(p_position_name, ' / ') = 0 THEN p_position_name
      WHEN COALESCE(p_org_type, '') LIKE 'เทศบาล%' THEN split_part(p_position_name, ' / ', 1)
      ELSE split_part(p_position_name, ' / ', 2)
    END
  )), '')
$$;

-- ใช้ภายใน RPC เท่านั้น ไม่ต้องเปิดให้หน้าเว็บเรียก
REVOKE ALL ON FUNCTION public.event_assignee_title(text, text, text) FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.event_assignments IS
  'ผู้รับมอบหมายให้ไปแทนในกิจกรรมปฏิทิน — บันทึกเพื่อแจ้งให้ทราบภายใน ไม่ใช่คำสั่งตามกฎหมาย '
  'อ่านได้เฉพาะบุคลากรภายใน เขียนผ่าน RPC set_event_assignments เท่านั้น';

COMMIT;
