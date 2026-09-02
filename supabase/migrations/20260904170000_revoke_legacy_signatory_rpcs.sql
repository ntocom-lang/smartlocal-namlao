-- ถอนสิทธิ์ RPC ผู้ลงนามเวอร์ชันเก่า หลังโค้ดที่เรียก v3 ขึ้น production แล้ว
--
-- ⚠️ ไฟล์นี้ต้อง apply "หลัง" deploy เท่านั้น ห้าม apply พร้อมชุด migration ปกติ
-- ที่รันก่อน deploy — เพราะระหว่างที่ยังไม่ deploy โค้ดที่รันอยู่จะเรียก v2 ซึ่งถูกถอน
-- สิทธิ์ไปแล้ว แอดมินบันทึก/ยกเลิกผู้ลงนามไม่ได้เลยและได้ error สิทธิ์ที่อ่านไม่ออก
-- (เกิดจริง 2026-09-02 ต้อง GRANT คืนฉุกเฉิน ดู 20260904160000)
--
-- ตัวฟังก์ชันยังอยู่ในฐานข้อมูล ถอนแค่สิทธิ์เรียกของ authenticated เพื่อให้ย้อนดู
-- นิยามเดิมได้ และ GRANT คืนได้ทันทีถ้าต้อง rollback โค้ด

REVOKE EXECUTE ON FUNCTION public.set_document_signatory_v2(
  uuid, text, uuid, uuid, text, text, text, date, date
) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.clear_document_signatory(uuid, text, uuid) FROM authenticated;
