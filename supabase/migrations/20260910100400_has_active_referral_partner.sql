-- ตรวจว่า อปท. มีหน่วยงานรับเรื่องต่อที่เปิดอยู่ไหม — ใช้ซ่อน/แสดงการ์ด "ขออนุเคราะห์รถรับ-ส่งผู้ป่วย"
-- ในหน้า E-Service ให้ผู้ที่ยังไม่ล็อกอินเห็นด้วย (ผู้ใช้เลือก 2569-09-10)
--
-- ทำไมต้องเป็น RPC: referral_partners อ่านได้เฉพาะ authenticated (20260910100100) ผู้เยี่ยมชม
-- จึงรู้ไม่ได้ว่ามีบริการนี้ไหม ถ้าเปิด SELECT ให้ anon ตรงๆ จะดึงรายชื่อหน่วยงานข้ามทุก อปท.
-- ได้ในคำขอเดียว (กับดักเดียวกับ emergency_contacts ที่ปิดไปใน 20260905130000)
--
-- คืนค่า boolean อย่างเดียว — ไม่คืนชื่อ/ที่อยู่/เบอร์ของหน่วยงาน ข้อมูลที่ได้ไม่เกินสิ่งที่
-- ผู้เยี่ยมชมเห็นอยู่แล้วบนหน้าเว็บ (มีการ์ดหรือไม่มี) จึงไม่ใส่ rpc_rate_limit_hit()
-- ซึ่งเขียนตารางทุกครั้งที่เรียก = เปิดหน้าเว็บทีหนึ่งเขียน DB ทีหนึ่งโดยไม่ได้อะไรคืน
--
-- _municipality_id ไม่มีค่า default และเทียบด้วย = ตรงๆ — ส่ง NULL มาได้ false ไม่ใช่ "มีสักที่"

DO $$
BEGIN
  IF to_regclass('public.referral_partners') IS NULL THEN
    RAISE EXCEPTION 'ต้อง apply 20260910100000_patient_transport_tables.sql ก่อนไฟล์นี้';
  END IF;
END;
$$;

BEGIN;

CREATE OR REPLACE FUNCTION public.has_active_referral_partner(
  _municipality_id uuid,
  _document_type   text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.referral_partners AS partner
    JOIN public.municipalities AS muni
      ON muni.id = partner.municipality_id
     AND muni.is_active = true
    WHERE partner.municipality_id = _municipality_id
      AND partner.is_active
      AND _document_type = ANY (partner.document_types)
  );
$$;

-- Supabase ตั้ง ALTER DEFAULT PRIVILEGES ให้ฟังก์ชันใหม่มี anon=X ติดมาเอง จึง REVOKE ก่อนแล้ว
-- GRANT กลับเฉพาะที่ตั้งใจ
REVOKE ALL ON FUNCTION public.has_active_referral_partner(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_referral_partner(uuid, text) TO anon, authenticated;

COMMENT ON FUNCTION public.has_active_referral_partner(uuid, text) IS
  'true = อปท. นี้มีหน่วยงานรับเรื่องต่อที่เปิดรับประเภทคำขอนี้อยู่ — คืน boolean อย่างเดียว ไม่เปิดเผยรายละเอียดหน่วยงาน';

COMMIT;
