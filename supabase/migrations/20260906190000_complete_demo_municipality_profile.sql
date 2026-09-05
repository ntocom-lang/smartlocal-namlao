-- เติมข้อมูลหน่วยงานสังเคราะห์ให้สนามทดสอบ เพื่อให้แบบฟอร์มและเอกสาร
-- ทดสอบพฤติกรรมได้ใกล้เคียง tenant จริง โดยไม่คัดลอกข้อมูลของประชาชนหรือ อปท. จริง
-- จำกัดเป้าหมายด้วย slug และชื่อหน่วยงาน ป้องกันการเขียนผิด tenant

DO $$
DECLARE
  v_updated_rows integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.municipalities
     WHERE slug = 'demo'
       AND name = 'เทศบาลตำบลสาธิต'
  ) THEN
    RAISE EXCEPTION 'ไม่พบสนามทดสอบ slug=demo ชื่อเทศบาลตำบลสาธิต';
  END IF;

  UPDATE public.municipalities
     SET address = 'เลขที่ 99 หมู่ที่ 5 ตำบลสาธิต อำเภอเมืองแพร่ จังหวัดแพร่ 54000',
         district = 'เมืองแพร่',
         province = 'แพร่',
         phone = '054-000000',
         fax = '054-000001',
         email = 'demo@smartlocal.example',
         website_url = 'https://demo.rk-networks.com'
   WHERE slug = 'demo'
     AND name = 'เทศบาลตำบลสาธิต';

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows <> 1 THEN
    RAISE EXCEPTION 'คาดว่าจะอัปเดต Demo 1 แถว แต่ได้ % แถว', v_updated_rows;
  END IF;
END $$;
