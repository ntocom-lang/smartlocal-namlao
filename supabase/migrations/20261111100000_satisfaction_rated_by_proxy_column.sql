-- 20261111100000_satisfaction_rated_by_proxy_column.sql
--
-- [เฟสคอลัมน์] คะแนนที่ สท. บันทึกแทนชาวบ้าน — ต้อง apply ก่อน 20261111100100 (ฟังก์ชัน)
--
-- ทำไมมี: คำร้องของน้ำเลา 69/100 เรื่อง สมาชิกสภา (role council) ยื่นแทนชาวบ้าน และเบอร์ในคำร้องเป็นเบอร์ของ สท. เอง
-- ชาวบ้านตัวจริงจึงให้คะแนนได้ทางเดียวคือลิงก์ /t/<โทเคน> ที่ สท. ส่งต่อ — ชาวบ้านที่ไม่มีมือถือ/LINE ให้ สท. ถามแล้วบันทึกแทน
-- (เจ้าของระบบสั่ง 2569-11-09)
--
-- คะแนนบันทึกแทนอยู่ "ช่อง unverified" ช่องเดียวกับคะแนนผ่านลิงก์ (unique (complaint_id, is_verified) เดิม)
-- ⇒ 1 เรื่องมีความเห็นชาวบ้านได้ 1 ครั้ง ไม่ว่ามาทางลิงก์หรือ สท. บันทึกแทน ใครมาก่อนได้ช่อง
-- ไม่ลง complaints.rating (คะแนนทางการยังเป็นของเจ้าของเรื่องที่ยืนยันตัวตนเท่านั้น) และรายงานต้องแยกแถวนี้ออกเสมอ
-- เพราะคนกดคือ สท. ไม่ใช่ชาวบ้าน — ห้ามนับรวมเป็น "ประชาชนประเมินเอง"
--
-- ADD COLUMN แยกไฟล์จากฟังก์ชัน (docs/ai/NOTES.md: ฟังก์ชันที่อ้างคอลัมน์ใหม่ในไฟล์เดียวกันพังตอน parse)
-- ย้อนกลับ: ALTER TABLE public.satisfaction_ratings DROP CONSTRAINT satisfaction_ratings_proxy_shape,
--                                                    DROP COLUMN rated_by_proxy;
--          (ต้อง DROP FUNCTION + คืน policy INSERT ของไฟล์ 20261111100100 ก่อน)
--          ⚠️ ถ้ามีแถว rated_by_proxy=true แล้ว DROP COLUMN จะทำให้แถวนั้นค้างในช่องชาวบ้านโดยไม่มีป้าย
--          ต้อง export หรือ DELETE ... WHERE rated_by_proxy ก่อน (เจ้าของระบบตัดสิน)

ALTER TABLE public.satisfaction_ratings
  ADD COLUMN IF NOT EXISTS rated_by_proxy boolean NOT NULL DEFAULT false;

-- แถวบันทึกแทนต้องอยู่ช่อง unverified และไม่ใช่แถวผ่านลิงก์
-- ⚠️ ห้ามใส่ complaint_id/created_by IS NOT NULL ใน CHECK: FK ทั้งสองเป็น ON DELETE SET NULL (20260830150000)
--    ใส่แล้ว ลบคำร้อง / ลบบัญชี สท. (หมดวาระ หรือลบตัวเองตาม PDPA) จะพังด้วย 23514 (ผลตรวจ migration-reviewer 2569-11-09)
-- ด่านกันตั้ง rated_by_proxy=true เองนอก RPC อยู่ที่ policy INSERT ในไฟล์ 20261111100100 (ต้องอ้างคอลัมน์ใหม่จึงอยู่ไฟล์นั้น)
-- แถวเดิมทุกแถวได้ false จาก DEFAULT จึงผ่าน CHECK ทันที ไม่ต้อง NOT VALID
ALTER TABLE public.satisfaction_ratings
  DROP CONSTRAINT IF EXISTS satisfaction_ratings_proxy_shape;
ALTER TABLE public.satisfaction_ratings
  ADD CONSTRAINT satisfaction_ratings_proxy_shape CHECK (
    NOT rated_by_proxy OR (is_verified = false AND via_link = false)
  );

COMMENT ON COLUMN public.satisfaction_ratings.rated_by_proxy IS
  'true = สท. (ผู้ยื่นแทน) ถามชาวบ้านแล้วบันทึกคะแนนแทน ผ่าน rate_complaint_on_behalf() เท่านั้น — created_by คือ สท. '
  'รายงานต้องแยกจากคะแนนที่ประชาชนให้เอง';

NOTIFY pgrst, 'reload schema';
