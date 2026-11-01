-- 20261101100000_self_delete_account_fk.sql
--
-- [ทำไมต้องมี] App Store (Guideline 5.1.1(v)) และ Google Play (User Data policy) บังคับให้ผู้ใช้
-- เริ่มลบบัญชีเองได้ทั้งในแอปและผ่านหน้าเว็บ — เจ้าของระบบตัดสิน 2569-11-01: ลบบัญชี + โปรไฟล์ทันที
-- แต่คำร้อง/คำขอ/การจองที่ยื่นไปแล้วเก็บไว้ครบในฐานะเอกสารราชการ (ตัวลบอยู่ใน 20261101100100)
--
-- [บั๊กเดิมที่แก้ไปด้วย] ตรวจฐานจริง 2569-11-01 (pg_constraint): FK 7 ตัวด้านล่างเป็น NO ACTION
-- ประชาชนที่เคยยื่นคำขอ E-Service / จองรถผู้ป่วย / ให้คะแนน / รีวิวสถานที่ จึงลบบัญชีไม่ได้เลย
-- แม้แอดมินกดลบผ่าน delete_user_by_id ก็ไม่ได้ (ลบ auth.users → ชน FK → ยกเลิกทั้งคำสั่ง)
--
-- [กติกาใหม่]
--   SET NULL = เอกสาร/ประวัติอยู่ครบ แค่ไม่ผูกบัญชี — ชื่อ เบอร์ ที่อยู่ของผู้ยื่นเก็บในแถวนั้นเองอยู่แล้ว
--              (document_requests.requester_*, patient_bookings.requester_name/phone/patient_name)
--   CASCADE  = ของที่เป็นของตัวผู้ใช้ล้วนๆ: รีวิวที่แสดงชื่อผู้รีวิวต่อสาธารณะ (Apple ระบุว่าผู้ใช้คาดว่า
--              รีวิวที่โพสต์จะถูกลบไปพร้อมบัญชี) และข้อความแจ้งเรื่องการจองที่ส่งถึงตัวเขา
-- ตารางงานเจ้าหน้าที่ (ยานพาหนะ ผู้ลงนาม บันทึกการเปิดเอกสาร ผู้อนุมัติ ฯลฯ) ไม่แตะ — ต้องคงร่องรอย
-- ว่าใครทำอะไร บัญชีเจ้าหน้าที่ลบเองไม่ได้อยู่แล้ว (delete_my_account รับเฉพาะ role citizen)
--
-- ⚠️ ชื่อ constraint บนฐานจริงไม่แน่นอน (document_requests / satisfaction_responses / tourism_reviews
-- สร้างจากหน้า Dashboard ไม่มีใน migration) จึงหาจาก pg_constraint แล้วสร้างใหม่ด้วย "ชื่อเดิม"
-- เพราะ PostgREST embed อ้างชื่อ constraint (รูป profiles!xxx_fkey) เปลี่ยนชื่อแล้วหน้าเว็บพังเงียบ
-- ⚠️ ข้อความ "อะไรถูกลบ/อะไรถูกเก็บ" ใน src/lib/accountDeletion.js ต้องตรงกับไฟล์นี้เสมอ
-- (สโตร์บังคับให้บอกผู้ใช้ตามจริง) — tests/account-deletion.test.mjs ตรวจคู่กัน

-- SET NULL ใส่ค่าว่างไม่ได้ถ้าคอลัมน์บังคับมีค่า — ปลดก่อนเปลี่ยน FK
-- (ฟังก์ชันรถผู้ป่วยที่อ่านคอลัมน์เหล่านี้ใช้ LEFT JOIN / เทียบ = auth.uid() / กรอง u IS NOT NULL อยู่แล้ว)
ALTER TABLE public.patient_bookings           ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.patient_booking_events     ALTER COLUMN actor_id   DROP NOT NULL;
ALTER TABLE public.patient_booking_operations ALTER COLUMN actor_id   DROP NOT NULL;

DO $$
DECLARE
  t  record;
  fk record;
  n  int;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('public.document_requests'::regclass,          'user_id'::name,      'SET NULL'),
      ('public.satisfaction_responses'::regclass,     'user_id'::name,      'SET NULL'),
      ('public.patient_bookings'::regclass,           'created_by'::name,   'SET NULL'),
      ('public.patient_booking_events'::regclass,     'actor_id'::name,     'SET NULL'),
      ('public.patient_booking_operations'::regclass, 'actor_id'::name,     'SET NULL'),
      ('public.tourism_reviews'::regclass,            'user_id'::name,      'CASCADE'),
      ('public.patient_booking_notices'::regclass,    'recipient_id'::name, 'CASCADE')
    ) AS v(tbl, col, rule)
  LOOP
    n := 0;
    FOR fk IN
      SELECT c.conname, c.confrelid::regclass AS ref_tbl, ra.attname AS ref_col
      FROM pg_constraint c
      JOIN pg_attribute a  ON a.attrelid  = c.conrelid  AND a.attnum  = c.conkey[1]
      JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
      WHERE c.contype = 'f'
        AND c.conrelid = t.tbl
        AND cardinality(c.conkey) = 1
        AND a.attname = t.col
        AND c.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
    LOOP
      n := n + 1;
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', t.tbl, fk.conname);
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s (%I) ON DELETE %s',
                     t.tbl, fk.conname, t.col, fk.ref_tbl, fk.ref_col, t.rule);
    END LOOP;

    -- ไม่เจอ = โครงตารางไม่ตรงกับที่วัดไว้ / เจอเกิน 1 = มี FK ซ้ำ ทั้งสองกรณีต้องให้คนดูก่อน ห้ามเดา
    IF n <> 1 THEN
      RAISE EXCEPTION 'คาดว่า %.% มี FK ไปบัญชีผู้ใช้ 1 ตัว แต่เจอ % ตัว ยกเลิกทั้งไฟล์ ตรวจโครงตารางก่อน', t.tbl, t.col, n;
    END IF;
  END LOOP;
END $$;

-- รูปโปรไฟล์เป็นภาพใบหน้า ต้องลบได้จริงตอนลบบัญชี — bucket avatars (สร้างจากหน้า Dashboard) มีนโยบาย
-- อัปโหลด/แก้/อ่าน แต่ไม่มีนโยบายลบ Storage API จึงคืน "ลบสำเร็จ 0 ไฟล์" แบบเงียบ
-- เปิดให้ลบได้เฉพาะไฟล์ในโฟลเดอร์ของตัวเอง เงื่อนไขเดียวกับนโยบายอัปโหลดเดิม
DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;
CREATE POLICY "Users can delete own avatar" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (auth.uid())::text);
