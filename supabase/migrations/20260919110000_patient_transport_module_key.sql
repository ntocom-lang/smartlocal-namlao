-- แยกบริการ "รถรับ-ส่งผู้ป่วย" ออกจากโมดูล inbox เป็นคีย์ของตัวเอง (2569-09-19)
--
-- เหตุผล: อปท. ที่ไม่มีกองทุนเจ้าของรถใช้บริการนี้ไม่ได้เลย แต่เดิมผูกอยู่กับ 'inbox'
-- ร่วมกับคำขอเอกสารอื่น จึงปิดเฉพาะบริการนี้ไม่ได้ ต้องปิดคำขอเอกสารทั้งหมดไปด้วย
--
-- ⚠️ ต่างจาก waste/waterworks ที่เติมคีย์ให้ "ทุกแถว" — ที่นี่ตั้งใจเปิดเฉพาะ อปท. ที่มีกองทุน
-- เปิดรับเรื่องอยู่จริงวันนี้ (demo + thungkaew) เหมือนกรณี water-situation
-- ผลต่อด่าน scripts/check-backend-uniformity.mjs: จะเตือนว่า อปท. อื่น "ขาด" คีย์นี้ ซึ่งเป็น
-- การปิดโดยตั้งใจ ด่านนั้นบล็อก deploy เฉพาะเมื่อคีย์ไม่อยู่ในแถวไหนเลย
-- ⇒ ต้อง apply ไฟล์นี้ "ก่อน" merge โค้ดที่เพิ่มคีย์ใน src/lib/staffModules.js เสมอ
--
-- ไม่ฮาร์ดโค้ด slug แต่เลือกจาก "มีกองทุนที่เปิดรับเรื่องประเภทนี้" ซึ่งเป็นเงื่อนไขเดียวกับที่
-- ฝั่งประชาชนใช้ตัดสินว่าจะโชว์การ์ดหรือไม่ (has_active_referral_partner) ⇒ ไม่มี อปท. ไหน
-- เห็นบริการหายไปจากที่เห็นอยู่ก่อนไฟล์นี้
--
-- เปิดให้ อปท. อื่นทีหลัง: เพิ่มกองทุนในทะเบียนหน่วยงานรับเรื่องต่อก่อน แล้วค่อยติ๊กโมดูล
-- "รถรับ-ส่งผู้ป่วย" ในแผง superadmin (ติ๊กก่อนมีกองทุน ประชาชนจะยังไม่เห็นการ์ดอยู่ดี)
BEGIN;

DO $$
DECLARE
  opened integer;
BEGIN
  UPDATE public.municipalities m
     SET enabled_modules = array_append(m.enabled_modules, 'patient-transport')
   WHERE m.enabled_modules IS NOT NULL
     AND NOT ('patient-transport' = ANY(m.enabled_modules))
     AND EXISTS (
       SELECT 1
         FROM public.referral_partners p
        WHERE p.municipality_id = m.id
          AND p.is_active
          AND 'patient_transport_request' = ANY(p.document_types)
     );
  GET DIAGNOSTICS opened = ROW_COUNT;

  -- ไม่มีแถวไหนได้คีย์เลย = ด่าน check:uniform จะบล็อก deploy และประชาชนที่เคยเห็นบริการจะไม่เห็น
  IF opened = 0 AND NOT EXISTS (
    SELECT 1 FROM public.municipalities WHERE 'patient-transport' = ANY(enabled_modules)
  ) THEN
    RAISE EXCEPTION 'ไม่มี อปท. ใดมีกองทุนเปิดรับเรื่องรถรับ-ส่งผู้ป่วย — ตรวจ referral_partners ก่อน apply';
  END IF;

  RAISE NOTICE 'เปิดโมดูล patient-transport ให้ % หน่วยงาน', opened;
END $$;

COMMIT;
