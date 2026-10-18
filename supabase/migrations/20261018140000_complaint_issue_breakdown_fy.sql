-- 20261018140000_complaint_issue_breakdown_fy.sql
--
-- ภาพ/ใบสรุปเรื่องร้องเรียนรายเดือน (PR #497) อยากแสดง "รายการย่อยใต้หมวด" แบบเทศบาลนครยะลา
-- (เช่น ไฟฟ้าสาธารณะ → ไฟดับทั้งดวง 5 · ไฟกระพริบ 2) ข้อมูลอยู่ในคอลัมน์ complaints.issue_type
-- ซึ่งฟอร์มบังคับเลือกจากรายการเฉพาะหมวด light เท่านั้น (CitizenForm.jsx ISSUE_TYPES_BY_CATEGORY)
--
-- ⚠️ ทำไมต้องกรองรายการอนุญาตฝั่งฐานข้อมูล: คอลัมน์เป็น text ธรรมดา ฟังก์ชันรับเรื่อง (submit_citizen_complaint_v4)
-- จำกัดแค่ความยาว 250 ตัวอักษร ผู้ที่เรียก RPC ตรงๆ (anon) ใส่ข้อความอะไรก็ได้ — ชื่อคน ที่อยู่ เบอร์โทร
-- ถ้าฟังก์ชันสาธารณะคืนค่าดิบ แล้วไปกรองที่หน้าเว็บ ข้อความนั้นก็ยังหลุดผ่าน API ได้ จึงกรองที่นี่:
-- ค่าที่ไม่อยู่ในรายการ (รวมถึงว่าง) ถูกนับรวมเป็นแถว NULL "ไม่ระบุลักษณะ" ไม่มีข้อความดิบออกจากฟังก์ชันเลย
--
-- รายการอนุญาตต้องตรงกับ ISSUE_TYPES_BY_CATEGORY ใน src/pages/CitizenForm.jsx ทุกตัวอักษร
-- tests/complaint-monthly-infographic.test.mjs อ่านทั้งสองไฟล์มาเทียบกัน (ไม่ตรง = เทสต์ล้ม)
--
-- ชื่อฟังก์ชันใหม่ ไม่แตะ complaints_public_fy/complaint_stats_fy เดิม (ใช้ทุกหน้ารายงาน ห้ามพัง)
-- ผลลัพธ์เป็นเฉพาะ "ยอดนับ" ไม่มี ref_no/วันที่/สถานที่ จึงระบุตัวบุคคลไม่ได้
-- เพิ่มฟังก์ชันอย่างเดียว ไม่แก้ตาราง/ข้อมูลเดิม — ย้อนได้ด้วย DROP FUNCTION public.complaint_issue_breakdown_fy(uuid, text, date, date)

CREATE OR REPLACE FUNCTION public.complaint_issue_breakdown_fy(
  _municipality_id uuid,
  _category        text,
  _from            date,
  _to              date
)
RETURNS TABLE (
  issue_label text,   -- NULL = ไม่ระบุลักษณะ (เรื่องเก่าก่อน 2026-08-24, รับที่เคาน์เตอร์, หรือค่าไม่อยู่ในรายการอนุญาต)
  total       bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ขอบเขตวันที่ตามปฏิทินไทย แปลงเป็น timestamptz ก่อนเทียบ เพื่อให้ index บน created_at ใช้ได้
  -- (แบบเดียวกับ complaint_stats_fy) _to เป็นวันสุดท้ายที่นับรวม จึงเทียบด้วย < (_to + 1)
  v_from timestamptz;
  v_to   timestamptz;
BEGIN
  IF _municipality_id IS NULL OR _category IS NULL OR _from IS NULL OR _to IS NULL OR _to < _from THEN
    RETURN;
  END IF;
  v_from := (_from::timestamp) AT TIME ZONE 'Asia/Bangkok';
  v_to   := ((_to + 1)::timestamp) AT TIME ZONE 'Asia/Bangkok';

  RETURN QUERY
    WITH allowed(category, label) AS (
      VALUES
        ('light', 'ไฟดับทั้งดวง'),
        ('light', 'ไฟกระพริบ'),
        ('light', 'เสาเอียง/ชำรุด'),
        ('light', 'สายไฟชำรุด'),
        ('light', 'ต้องการติดตั้งเพิ่ม'),
        ('light', 'อื่นๆ')
    )
    , counted AS (
      SELECT
        -- ได้ label จากตาราง allowed เสมอ ไม่ใช่ค่าที่ผู้ส่งพิมพ์ — ไม่ตรงรายการ = NULL
        (SELECT a.label FROM allowed a WHERE a.category = c.category AND a.label = c.issue_type) AS issue_label,
        count(*)::bigint AS total
      FROM complaints c
      WHERE c.municipality_id = _municipality_id
        AND c.category = _category
        -- หมวดที่ไม่มีรายการอนุญาต (ทุกหมวดนอกจาก light ตอนนี้) ไม่คืนอะไรเลย
        AND EXISTS (SELECT 1 FROM allowed a WHERE a.category = _category)
        AND c.created_at >= v_from
        AND c.created_at <  v_to
      GROUP BY 1
    )
    -- มาก→น้อย แต่ "ไม่ระบุลักษณะ" (NULL) อยู่ท้ายเสมอ แม้ยอดจะมากกว่ารายการอื่น
    SELECT k.issue_label, k.total
    FROM counted k
    ORDER BY (k.issue_label IS NULL), k.total DESC, k.issue_label;
END;
$$;

REVOKE ALL ON FUNCTION public.complaint_issue_breakdown_fy(uuid, text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complaint_issue_breakdown_fy(uuid, text, date, date) TO anon, authenticated;

COMMENT ON FUNCTION public.complaint_issue_breakdown_fy(uuid, text, date, date) IS
  'ยอดนับเรื่องร้องเรียนแยกตามลักษณะปัญหา (เฉพาะค่าในรายการอนุญาตของหมวด) สำหรับภาพ/ใบสรุปรายเดือน — ค่านอกรายการนับเป็น NULL ไม่ส่งข้อความดิบออก';
