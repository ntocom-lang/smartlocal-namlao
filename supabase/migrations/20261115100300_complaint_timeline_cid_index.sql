-- 20261115100300_complaint_timeline_cid_index.sql
--
-- คืน index ที่หายไปบนฐานจริง (schema drift) — ห้องผู้บริหาร E2 ไฟล์ 4/4
--
-- ข้อเท็จจริง (ตรวจฐานจริง 2026-11-10 ด้วย pg_indexes): complaint_timeline มีแค่ complaint_timeline_pkey (id)
-- ทั้งที่ 052_complaint_department_flow.sql สร้าง idx_complaint_timeline_cid ไว้ (น่าจะเพราะตารางมีอยู่ก่อน 052 ถูกรัน)
-- ผลที่จะเจอเมื่อข้อมูลโต: ทุก subquery "min(created_at) WHERE complaint_id = ..." ต้องสแกนทั้งตาราง
--   ใช้อยู่ใน exec_summary_complaints / exec_summary_departments (ไฟล์ 2) และ staff_performance_rows (เมนูผลการปฏิบัติงาน)
--   ตอนนี้คำร้องสูงสุด ~100 เรื่อง/อปท. ยังเร็ว · หลักพันเรื่อง × หลักหมื่นแถว timeline จะชน statement_timeout 8 วินาทีของ authenticated
--
-- นิยามเดียวกับ 052 ทุกตัวอักษร (ชื่อ + คอลัมน์ + ลำดับ) — IF NOT EXISTS ⇒ ฐานที่มีอยู่แล้วไม่เปลี่ยน
-- ไม่ใช้ CONCURRENTLY: รันใน transaction ของ SQL Editor/CLI ไม่ได้ และตารางเล็ก (ล็อกการเขียนแค่ระดับมิลลิวินาที)
-- ไม่มีการเปลี่ยนข้อมูล · ย้อนกลับ: DROP INDEX IF EXISTS public.idx_complaint_timeline_cid;
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'complaint_timeline';
--     → ต้องมี idx_complaint_timeline_cid ON public.complaint_timeline USING btree (complaint_id, created_at DESC)

CREATE INDEX IF NOT EXISTS idx_complaint_timeline_cid
  ON public.complaint_timeline (complaint_id, created_at DESC);
