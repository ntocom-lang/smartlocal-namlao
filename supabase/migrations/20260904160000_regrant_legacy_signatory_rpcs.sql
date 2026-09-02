-- คืนสิทธิ์ set_document_signatory_v2 / clear_document_signatory ให้ authenticated
--
-- ความผิดพลาดที่แก้: 20260904140000 REVOKE ทั้งสองตัวไปพร้อมกับตอนสร้าง v3
-- แต่ migration ถูก apply ก่อน deploy โค้ดที่เรียก v3 เสมอ (ต้องเป็นลำดับนี้ ไม่งั้น
-- โค้ดใหม่จะเรียกฟังก์ชันที่ยังไม่มี) ผลคือช่วงระหว่างสองเหตุการณ์นั้น หน้าทะเบียน
-- ผู้ลงนามบน production เรียก v2 ที่เพิ่งถูกถอนสิทธิ์ไป แอดมินบันทึก/ยกเลิกผู้ลงนาม
-- ไม่ได้เลยและได้ error สิทธิ์ที่อ่านไม่ออกว่าเกิดจากอะไร
--
-- กติกาที่ได้จากเรื่องนี้: การถอนสิทธิ์ RPC เวอร์ชันเก่าต้องเป็น migration แยก
-- ที่ apply "หลัง" deploy โค้ดใหม่เสร็จแล้วเท่านั้น ห้ามรวมไว้กับไฟล์ที่สร้างเวอร์ชันใหม่
-- (ดูไฟล์ถัดไปที่ทำหน้าที่ถอนสิทธิ์จริงหลัง deploy)

GRANT EXECUTE ON FUNCTION public.set_document_signatory_v2(
  uuid, text, uuid, uuid, text, text, text, date, date
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.clear_document_signatory(uuid, text, uuid) TO authenticated;
