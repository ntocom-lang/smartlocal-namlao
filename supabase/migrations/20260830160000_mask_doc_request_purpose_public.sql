-- 20260830160000_mask_doc_request_purpose_public.sql
--
-- doc_requests_public() เป็นตัวป้อนข้อมูลให้หน้า /doc-stats ซึ่งเปิดให้คนไม่ล็อกอินดูได้
-- (src/pages/LpaDocStats.jsx) และคืนคอลัมน์ purpose แบบดิบ ตัดแค่ 30 ตัวอักษร
--
-- ทำไมถึงสำคัญ: purpose ไม่ได้ใช้แค่กับ "วัตถุประสงค์" ของคำขอเอกสารทั่วไป
-- (เช่น "เพื่อยื่นกู้ธนาคาร") — ฟอร์มเดียวกันใช้ฟิลด์นี้กับบริการ "สอบถามยอดชำระ" ด้วย
-- โดย label เปลี่ยนเป็น "รายละเอียดที่ต้องการสอบถาม *" และ **บังคับกรอก**
-- (src/pages/CitizenDocRequest.jsx บรรทัด 489 และ 508) ประชาชนจึงพิมพ์บ้านเลขที่
-- ชื่อเจ้าของบ้าน หรือเลขผู้เสียภาษีลงไปได้ตามธรรมชาติของคำถาม
--
-- ต่างจาก get_complaint_by_ref ตรงที่ตัวนั้นต้องรู้ ref_no ก่อนถึงจะยิงได้ แต่ตัวนี้
-- คืนคำขอ 30 รายการล่าสุดให้ทุกคนที่เปิดหน้าเว็บ ไม่ต้องรู้อะไรเลย — ถ้ามีข้อมูลส่วนบุคคล
-- อยู่ในฟิลด์นี้ ตอนนี้มันเผยแพร่อยู่แล้ว ไม่ใช่ความเสี่ยงที่รอให้ใครมาเจาะ
--
-- แก้ด้วยกฎเดียวกับ subject ของคำร้อง (20260829110000): คืนให้เฉพาะเจ้าหน้าที่ของเทศบาลนั้น
-- ผู้เรียกทั่วไปได้ NULL — ตัวเลขที่ LPA ต้องการจริงคือประเภทเอกสาร / สถานะ / จำนวนวันที่ใช้
-- ซึ่งยังคืนครบเหมือนเดิม
--
-- ผลต่อ UI: LpaDocStats.jsx ซ่อนคอลัมน์ "วัตถุประสงค์" อัตโนมัติเมื่อไม่มีแถวไหนมีค่า
-- (ดูการแก้ในคอมมิตเดียวกัน) ผู้ใช้ทั่วไปจึงเห็นตารางที่แคบลง ไม่ใช่คอลัมน์ว่างทั้งแถบ
--
-- return type ไม่เปลี่ยน จึงใช้ CREATE OR REPLACE ได้ ไม่ต้อง DROP

create or replace function public.doc_requests_public(
  _municipality_id uuid,
  _limit           int default 30
)
returns table (
  ref_id     text,
  doc_type   text,
  purpose    text,
  status     text,
  created_at timestamptz,
  issued_at  timestamptz,
  days_taken numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_privileged boolean;
begin
  -- ต้องเป็นเจ้าหน้าที่ของเทศบาลที่ถูกถามถึงเท่านั้น superadmin ข้ามได้ทุกเทศบาลตามเดิม
  -- ประชาชนเจ้าของคำขอดูวัตถุประสงค์ของตัวเองได้อยู่แล้วที่หน้า "เอกสารของฉัน"
  -- ซึ่งอ่านจากตารางตรงผ่าน RLS ไม่ได้ใช้ฟังก์ชันนี้
  v_privileged := auth.uid() is not null and (
    get_my_role() = 'superadmin'
    or (
      get_my_role() in ('admin', 'officer', 'staff', 'technician', 'viewer', 'council')
      and get_my_municipality_id() = _municipality_id
    )
  );

  return query
    select
      left(dr.id::text, 8)                    as ref_id,
      dr.document_type                         as doc_type,
      case
        when v_privileged then left(coalesce(dr.purpose, ''), 30)
        else null
      end                                      as purpose,
      dr.status                                as status,
      dr.created_at                            as created_at,
      dr.issued_at                             as issued_at,
      case
        when dr.status = 'completed' and dr.issued_at is not null
        then round(
               extract(epoch from (dr.issued_at - dr.created_at)) / 86400.0,
               1
             )
        else null
      end                                      as days_taken
    from document_requests dr
    where dr.municipality_id = _municipality_id
    order by dr.created_at desc
    limit _limit;
end;
$$;

-- คงสิทธิ์เดิมไว้ หน้า /doc-stats ตั้งใจเปิดสาธารณะเพื่อความโปร่งใส สิ่งที่เปลี่ยนคือเนื้อหาที่คืน
grant execute on function public.doc_requests_public(uuid, int) to anon, authenticated;

comment on function public.doc_requests_public(uuid, int) is
  'รายการคำขอเอกสารสาธารณะสำหรับรายงานความโปร่งใส — purpose เป็นข้อความที่ประชาชนพิมพ์เอง คืนเฉพาะเจ้าหน้าที่ของเทศบาลนั้น';

notify pgrst, 'reload schema';
