-- คำขอ "ขออนุเคราะห์รถรับ-ส่งผู้ป่วย" เฟส 2/4 — RLS + สิทธิ์ตาราง + trigger ประทับผู้แก้ทะเบียน
-- (ตารางสร้างไว้แล้วใน 20260910100000 ไฟล์นี้จึงอ้างถึงได้)
--
-- หลักการสิทธิ์มองเห็นของตารางลูก: **ไม่เขียนตรรกะชุดใหม่** (แบบเดียวกับ asset_borrow_*)
-- ผูกกับแถวแม่ใน document_requests ด้วย EXISTS — PostgreSQL บังคับ RLS ของ document_requests
-- ในซับคิวรีให้เอง ผลจึงตรงกับ policy "read document_requests" ทุกกรณี:
--   ผู้ยื่น = คำขอตนเอง · superadmin = ทั้งหมด · admin = ทั้ง อปท.
--   officer = เฉพาะกองตน · staff = เฉพาะที่ถูกมอบหมาย
--
-- ⚠️ ตารางลูกไม่มี policy INSERT/UPDATE/DELETE โดยตั้งใจ — เขียนได้ทาง RPC (SECURITY DEFINER)
-- ในไฟล์ 20260910100200 เท่านั้น ผู้ยื่นจึงแก้สถานะ/เลขหนังสือ/ผลจากกองทุนเองไม่ได้

DO $$
BEGIN
  IF to_regclass('public.patient_transport_requests') IS NULL
     OR to_regclass('public.referral_partners') IS NULL
     OR to_regclass('public.patient_transport_events') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260910100000_patient_transport_tables.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

-- ===========================================================================
-- referral_partners — ทะเบียนหน่วยงานรับเรื่องต่อ
-- ===========================================================================
ALTER TABLE public.referral_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read referral_partners" ON public.referral_partners;
DROP POLICY IF EXISTS "insert referral_partners" ON public.referral_partners;
DROP POLICY IF EXISTS "update referral_partners" ON public.referral_partners;

-- ประชาชนต้องเห็นชื่อหน่วยงานที่เปิดอยู่ เพราะข้อความขอความยินยอมต้องระบุชื่อผู้รับข้อมูล
-- บุคลากรเห็นทั้งหมดรวมที่ปิดแล้ว (คำขอเก่ายังอ้างอยู่)
CREATE POLICY "read referral_partners" ON public.referral_partners
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (
      municipality_id = public.get_my_municipality_id()
      AND (public.get_my_role() <> 'citizen' OR is_active)
    )
  );

-- ตั้งค่าหน่วยงานภายนอกเป็นงานของแอดมิน อปท. เท่านั้น (กติกา 3 ส่วน: ฝั่งแอดมิน = ตั้งค่า)
-- ไม่เปิดให้หัวหน้ากอง เพราะชื่อหน่วยงานนี้คือผู้รับข้อมูลสุขภาพของประชาชน
CREATE POLICY "insert referral_partners" ON public.referral_partners
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  );

CREATE POLICY "update referral_partners" ON public.referral_partners
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  )
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  );

-- ประทับผู้สร้าง/ผู้แก้จากฝั่งเซิร์ฟเวอร์ — client ส่ง created_by เป็นใครก็ได้ถ้าไม่ทับตรงนี้
CREATE OR REPLACE FUNCTION public.stamp_referral_partner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    -- ย้ายหน่วยงานข้าม อปท. ไม่ได้ — คำขอเก่าของ อปท. เดิมยังอ้างแถวนี้อยู่
    NEW.municipality_id := OLD.municipality_id;
  END IF;
  NEW.name            := btrim(NEW.name);
  NEW.recipient_title := btrim(NEW.recipient_title);
  NEW.updated_by      := auth.uid();
  NEW.updated_at      := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_referral_partner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stamp_referral_partner ON public.referral_partners;
CREATE TRIGGER stamp_referral_partner
  BEFORE INSERT OR UPDATE ON public.referral_partners
  FOR EACH ROW EXECUTE FUNCTION public.stamp_referral_partner();

-- ===========================================================================
-- patient_transport_requests / events — อ่านอย่างเดียว เขียนผ่าน RPC
-- ===========================================================================
ALTER TABLE public.patient_transport_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_transport_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read patient_transport_requests" ON public.patient_transport_requests;
CREATE POLICY "read patient_transport_requests" ON public.patient_transport_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.document_requests AS parent
      WHERE parent.id = patient_transport_requests.request_id
    )
  );

-- ประวัติการดำเนินการเป็นข้อมูลภายใน — ผู้ยื่นดูสถานะจากหน้า "เอกสารของฉัน" ได้อยู่แล้ว
DROP POLICY IF EXISTS "read patient_transport_events" ON public.patient_transport_events;
CREATE POLICY "read patient_transport_events" ON public.patient_transport_events
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (
      municipality_id = public.get_my_municipality_id()
      AND public.get_my_role() IN ('admin', 'officer', 'staff')
      AND EXISTS (
        SELECT 1 FROM public.document_requests AS parent
        WHERE parent.id = patient_transport_events.request_id
      )
    )
  );

-- ===========================================================================
-- สิทธิ์ระดับตาราง
-- default privileges ของ schema public ใน Supabase แจก grant ให้ anon ด้วย ต้องถอนเองทุกตาราง
-- (ดู 20260905200000_revoke_anon_write_grants.sql) — คำขอนี้บังคับล็อกอิน ไม่มีช่องทาง anon
-- ===========================================================================
REVOKE ALL ON TABLE public.referral_partners          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.patient_transport_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.patient_transport_events   FROM PUBLIC, anon, authenticated;

-- ไม่มี DELETE — เลิกใช้หน่วยงานให้ปิด is_active (FK ของคำขอเก่าเป็น RESTRICT อยู่แล้ว)
GRANT SELECT, INSERT, UPDATE ON TABLE public.referral_partners TO authenticated;

GRANT SELECT ON TABLE public.patient_transport_requests TO authenticated;
GRANT SELECT ON TABLE public.patient_transport_events   TO authenticated;

COMMIT;
