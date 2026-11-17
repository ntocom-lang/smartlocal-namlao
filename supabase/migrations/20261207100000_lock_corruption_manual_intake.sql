-- 20261207100000_lock_corruption_manual_intake.sql
--
-- ล็อกหมวดคำร้อง 'corruption' (แจ้งการทุจริต) ให้ผ่านแอดมินก่อนเสมอ ที่ระดับฐานข้อมูล
--
-- ที่มา: 2569-11-17 พบ namlao แถว corruption มี requires_manual_intake = false ทั้งที่แถวสร้าง
-- 2569-05-17 ก่อน 20260915100000 (ซึ่งตั้ง true ให้แถวเดิมทุกแถว) ⇒ มีคนกดสวิตช์ปิดในหน้าแอดมิน
-- หรือรัน SQL ตรง · ตรวจแล้วไม่มีคำร้องหมวดนี้เลย (0 เรื่อง) จึงไม่มีเรื่องหลุด
-- PR #753 แก้ปุ่มโหลดค่าเริ่มต้นแล้ว ไฟล์นี้ปิดทางที่เหลือ
--
-- ทำไมต้องล็อก ไม่ปล่อยเป็นสวิตช์:
--   เรื่องทุจริตทุก อปท. ไปสำนักปลัดและมีผู้รับผิดชอบคนเดียว ถ้าระบบรับเรื่องเอง เรื่องถึงมือคนนั้น
--   ทันทีโดยไม่มีใครกรอง ซึ่งอาจเป็นผู้ถูกร้องเอง (ผลประโยชน์ทับซ้อน) และธงนี้ยังเป็นตัวซ่อนเลขที่เรื่อง/
--   หมู่บ้าน/ชื่อหมวดในฟังก์ชันสรุปของห้องผู้บริหาร + ผลการปฏิบัติงาน (exec_*, staff_performance_rows)
--   ธงเป็น false = ข้อมูลหมวดอ่อนไหวโผล่ในการ์ดที่คนกลุ่มใหญ่เห็น
--
-- ล็อก 2 ทางที่ทำให้เรื่องข้ามแอดมิน:
--   (ก) requires_manual_intake = false → route_complaint_auto_receive() รับเรื่องเอง
--   (ข) is_adhoc = true → หมวดเฉพาะกิจส่งตรงถึงผู้รับผิดชอบ ไม่มีขั้นรับเรื่องเลย
--
-- พฤติกรรม:
--   - requires_manual_intake ของ corruption บังคับเป็น true เงียบๆ ทั้ง INSERT/UPDATE (ไม่ raise)
--     เหตุผล: หน้าเว็บรุ่นก่อน #753 ที่ค้างใน cache ส่ง false มากับ upsert ค่าเริ่มต้นหลายแถว
--     ถ้า raise ทั้งชุดล้ม แอดมินโหลดหมวดคำร้องไม่ได้เลย
--   - is_adhoc: INSERT เป็น true = raise · UPDATE จาก false → true = raise (ข้อความไทยขึ้นในหน้าเว็บ)
--     แถวที่เป็นเฉพาะกิจอยู่ก่อนแล้วไม่แตะ และยังย้ายกลับเป็นปกติได้ — ถ้าย้ายให้เอง คำร้องเก่าของ
--     หมวดจะเปิดให้เจ้าหน้าที่ในกองเห็นย้อนหลัง (ดู toggleAdhoc ใน AdminDashboard.jsx) ซึ่งต้องให้
--     เจ้าของระบบตัดสินรายแถว ไม่ใช่ migration
--   - เปลี่ยน value เข้าหรือออกจาก 'corruption' = raise (ออก = เลี่ยงล็อกแล้วปิดธง ·
--     เข้า = เอาหมวดเฉพาะกิจที่มีอยู่มาเปลี่ยนรหัสเป็น corruption) — หน้าเว็บไม่มีที่ไหนแก้ value
--   - ล็อกผูกกับรหัส value เท่านั้น: ลบแถว corruption หรือสร้างหมวดรหัสอื่นชื่อคล้ายกันยังทำได้
--     (นอกขอบเขตที่อนุมัติ 2569-11-17)
--
-- ไม่ใช้ CHECK constraint: กันการเปลี่ยนรหัสไม่ได้ และ raise เสมอ (ชนกับเหตุผล cache ข้างบน)
--
-- trigger เดิมบนตารางนี้ 2 ตัวผูกเฉพาะคอลัมน์ (UPDATE OF municipality_id/department_id และ
-- is_active/department_id) ไม่ยุ่งกับคอลัมน์ที่ไฟล์นี้แตะ ลำดับการทำงานจึงไม่มีผล
--
-- ถ้าวันหนึ่งต้องการปลดล็อกจริง: DROP TRIGGER trg_lock_corruption_category ใน migration ใหม่
-- (ตั้งใจไม่มีทางยกเว้นรายบุคคล รวม superadmin)

-- ── 1) trigger function ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lock_corruption_category_flags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- กันทั้งสองทิศ: เปลี่ยนออก = เลี่ยงล็อกแล้วปิดธง · เปลี่ยนเข้า = ได้ corruption ที่เป็นเฉพาะกิจ
  -- (สร้างหมวดในแท็บเฉพาะกิจด้วยรหัสอื่นก่อน แล้วค่อย PATCH value เป็น corruption)
  IF TG_OP = 'UPDATE'
     AND NEW.value IS DISTINCT FROM OLD.value
     AND 'corruption' IN (OLD.value, NEW.value) THEN
    RAISE EXCEPTION 'ห้ามเปลี่ยนรหัสหมวดเข้าหรือออกจาก "แจ้งการทุจริต" (corruption)'
      USING ERRCODE = '23514',
            HINT = 'หมวดนี้ล็อกให้แอดมินรับเรื่องเสมอ เปลี่ยนได้เฉพาะชื่อที่แสดง';
  END IF;

  IF NEW.value IS DISTINCT FROM 'corruption' THEN
    RETURN NEW;
  END IF;

  NEW.requires_manual_intake := true;

  -- INSERT ใช้ raise ไม่บังคับ false: ค่าที่ BEFORE INSERT ตั้งไว้ติดไปกับ EXCLUDED ของ upsert
  -- ถ้าบังคับ false แถวเฉพาะกิจเดิมจะถูกย้ายกลับเป็นปกติเงียบๆ (เปิดคำร้องเก่าให้กองเห็นย้อนหลัง)
  -- seedDefaults ไม่ส่ง is_adhoc ⇒ ได้ DEFAULT false ไม่โดน raise
  IF TG_OP = 'INSERT' AND NEW.is_adhoc THEN
    RAISE EXCEPTION 'หมวด "แจ้งการทุจริต" เป็นประเภทงานเฉพาะกิจไม่ได้'
      USING ERRCODE = '23514',
            HINT = 'หมวดเฉพาะกิจส่งเรื่องตรงถึงผู้รับผิดชอบโดยไม่ผ่านแอดมิน ซึ่งอาจเป็นผู้ถูกร้องเอง';
  ELSIF TG_OP = 'UPDATE' AND NEW.is_adhoc AND NOT OLD.is_adhoc THEN
    RAISE EXCEPTION 'หมวด "แจ้งการทุจริต" ย้ายเป็นประเภทงานเฉพาะกิจไม่ได้'
      USING ERRCODE = '23514',
            HINT = 'หมวดเฉพาะกิจส่งเรื่องตรงถึงผู้รับผิดชอบโดยไม่ผ่านแอดมิน ซึ่งอาจเป็นผู้ถูกร้องเอง';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lock_corruption_category_flags() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.lock_corruption_category_flags() IS
  'หมวด corruption: บังคับ requires_manual_intake = true, ห้ามเป็นเฉพาะกิจ (INSERT true / UPDATE false→true raise), ห้ามเปลี่ยน value เข้าหรือออก — กันเรื่องทุจริตถึงผู้รับผิดชอบคนเดียวโดยไม่ผ่านแอดมิน';

-- ── 2) trigger ───────────────────────────────────────────────────────────────
-- DROP/CREATE TRIGGER ถือ lock แรงบนตาราง ฟอร์มคำร้องกับ trigger ฝั่ง complaints อ่านตารางนี้ทุกครั้ง
-- ถ้ามี transaction ค้าง คำสั่งต่อคิวแล้วบล็อกการอ่านที่ตามมา ⇒ รอไม่เกิน 5 วินาทีแล้วล้มไปเลย (รันใหม่ได้)
SET lock_timeout = '5s';
-- ไม่ใช้ UPDATE OF <คอลัมน์> เพราะต้องจับการเปลี่ยน value ด้วย ตารางเล็ก (หลักสิบแถวต่อ อปท.)
DROP TRIGGER IF EXISTS trg_lock_corruption_category ON public.complaint_categories;
CREATE TRIGGER trg_lock_corruption_category
BEFORE INSERT OR UPDATE ON public.complaint_categories
FOR EACH ROW EXECUTE FUNCTION public.lock_corruption_category_flags();

-- ── 3) แก้แถวที่ค้าง false อยู่ (namlao ณ 2569-11-17) ─────────────────────────
-- trigger ด้านบนทำงานกับ UPDATE นี้ด้วย ได้ค่าเดิม (is_adhoc ไม่เปลี่ยน จึงไม่ raise)
UPDATE public.complaint_categories
SET requires_manual_intake = true
WHERE value = 'corruption'
  AND requires_manual_intake IS DISTINCT FROM true;

RESET lock_timeout;

-- ── ตรวจหลัง apply (อ่านอย่างเดียว) ──────────────────────────────────────────
-- (1) ทุกแถว corruption ต้อง requires_manual_intake = true · ถ้ามีแถว is_adhoc = true ให้แจ้งเจ้าของระบบ
--   select m.slug, cc.requires_manual_intake, cc.is_adhoc, cc.is_active
--     from public.complaint_categories cc join public.municipalities m on m.id = cc.municipality_id
--    where cc.value = 'corruption' order by m.slug;
-- (2) trigger ติดตั้งแล้ว
--   select tgname, tgenabled from pg_trigger
--    where tgrelid = 'public.complaint_categories'::regclass and tgname = 'trg_lock_corruption_category';
-- (3) ทดลองบน tenant demo (ย้อนเองด้วย ROLLBACK):
--   begin;
--   update public.complaint_categories cc set requires_manual_intake = false
--     from public.municipalities m where m.id = cc.municipality_id and m.slug = 'demo' and cc.value = 'corruption'
--   returning cc.requires_manual_intake;   -- ต้องได้ true
--   rollback;
