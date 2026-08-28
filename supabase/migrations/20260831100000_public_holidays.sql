-- 20260831100000_public_holidays.sql
--
-- วันหยุดราชการที่แอดมินแก้เองได้ — เดิมตารางวันหยุดเป็น static อยู่ใน src/lib/workingDays.js
-- ครอบคลุมแค่ พ.ศ. 2568–2569 พอขึ้นปี 2570 ระบบจะถอยไปนับ "ตัดเฉพาะเสาร์-อาทิตย์" เงียบๆ
-- ทำให้ SLA คำร้องทุกเรื่องผิดทั้งปีโดยไม่มีใครรู้ จนกว่าจะมีคนแก้โค้ดแล้ว deploy ใหม่
--
-- ตารางนี้ไม่ได้มาแทนตาราง static — ตาราง static ยังเป็น baseline ที่ทำงานได้แม้ query ล้มเหลว
-- (เน็ตหลุด / RLS พัง) ส่วนแถวในตารางนี้เป็นส่วนเพิ่มและส่วนทับ ดู mergeHolidayRows() ใน
-- src/lib/workingDays.js
--
-- ขอบเขตของแถว:
--   municipality_id IS NULL     = วันหยุดทั่วประเทศ ใช้กับทุก อปท. (ประกาศสำนักนายกฯ / มติ ครม.)
--   municipality_id = <uuid>    = วันหยุดตามประเพณีท้องถิ่นที่ อปท. นั้นประกาศเอง
--
-- is_working_day = true คือ "ยกเลิกวันหยุด" ไม่ใช่ "เพิ่มวันหยุด" — ใช้เมื่อ ครม. ถอนวันหยุดพิเศษ
-- ที่เคยประกาศไว้ หรือ อปท. สั่งให้มาปฏิบัติงานในวันหยุด ถ้าไม่มีคอลัมน์นี้ วันที่อยู่ในตาราง
-- static แล้วจะลบทิ้งไม่ได้เลยโดยไม่ deploy ใหม่ ซึ่งเป็นปัญหาเดิมที่ตารางนี้ตั้งใจจะแก้
CREATE TABLE IF NOT EXISTS public.public_holidays (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid        REFERENCES public.municipalities(id) ON DELETE CASCADE,
  holiday_date    date        NOT NULL,
  name            text        NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 200),
  is_working_day  boolean     NOT NULL DEFAULT false,
  note            text        CHECK (note IS NULL OR length(note) <= 500),
  updated_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE (municipality_id, holiday_date) ธรรมดาใช้ไม่ได้ เพราะ Postgres ถือว่า NULL ไม่เท่ากับ NULL
-- แถววันหยุดทั่วประเทศจึงซ้ำวันเดียวกันได้ไม่จำกัด ต้องแยกเป็น partial unique index สองตัว
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_holidays_global_date
  ON public.public_holidays (holiday_date)
  WHERE municipality_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_holidays_tenant_date
  ON public.public_holidays (municipality_id, holiday_date)
  WHERE municipality_id IS NOT NULL;

-- ฝั่ง client ดึงทีละช่วงปี (global + ของ อปท. ตัวเอง) จึงเรียงตามวันที่เป็นหลัก
CREATE INDEX IF NOT EXISTS idx_public_holidays_date
  ON public.public_holidays (holiday_date);

ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;

-- อ่านได้ทุกคนรวมถึง anon — หน้า "คำร้องของฉัน" ฝั่งประชาชนแสดงป้ายนับถอยหลัง SLA ซึ่งต้องใช้
-- ตารางวันหยุดชุดเดียวกับฝั่งเจ้าหน้าที่ ไม่งั้นสองฝั่งจะเห็นตัวเลขไม่ตรงกันแล้วเถียงกันว่า
-- เรื่องเกินกำหนดแล้วหรือยัง — และวันหยุดราชการเป็นข้อมูลสาธารณะ ไม่มีประเด็น PDPA
CREATE POLICY "public_holidays read all" ON public.public_holidays FOR SELECT
  TO anon, authenticated
  USING (true);

-- แถววันหยุดทั่วประเทศ (municipality_id IS NULL) แก้ได้เฉพาะ superadmin เพราะกระทบทุก อปท.
-- ถ้าเปิดให้ admin ของแต่ละแห่งแก้ได้ ทุ่งแค้วแก้แล้วน้ำเลาเปลี่ยนตาม ซึ่งเป็นกับดักเดียวกับ
-- ที่เคยเจอตอน enabled_modules — admin ทั่วไปเพิ่มได้เฉพาะวันหยุดของหน่วยงานตัวเอง
CREATE POLICY "public_holidays admin insert" ON public.public_holidays FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE WHEN municipality_id IS NULL
      THEN get_my_role() = 'superadmin'
      ELSE get_my_role() = ANY (ARRAY['admin','superadmin'])
           AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())
    END
  );

-- ต้องคุมทั้ง USING (แถวเดิมที่แก้ได้) และ WITH CHECK (แถวหลังแก้) ไม่งั้น admin ของ อปท.
-- ย้ายแถวของตัวเองให้กลายเป็นแถว global ได้ด้วยการ UPDATE municipality_id = NULL
CREATE POLICY "public_holidays admin update" ON public.public_holidays FOR UPDATE
  TO authenticated
  USING (
    CASE WHEN municipality_id IS NULL
      THEN get_my_role() = 'superadmin'
      ELSE get_my_role() = ANY (ARRAY['admin','superadmin'])
           AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())
    END
  )
  WITH CHECK (
    CASE WHEN municipality_id IS NULL
      THEN get_my_role() = 'superadmin'
      ELSE get_my_role() = ANY (ARRAY['admin','superadmin'])
           AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())
    END
  );

CREATE POLICY "public_holidays admin delete" ON public.public_holidays FOR DELETE
  TO authenticated
  USING (
    CASE WHEN municipality_id IS NULL
      THEN get_my_role() = 'superadmin'
      ELSE get_my_role() = ANY (ARRAY['admin','superadmin'])
           AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())
    END
  );

COMMENT ON TABLE  public.public_holidays IS
  'วันหยุดราชการที่แก้ผ่านหน้าแอดมินได้ — municipality_id NULL = ทั่วประเทศ (superadmin เท่านั้น), มีค่า = วันหยุดตามประเพณีท้องถิ่นของ อปท. นั้น';
COMMENT ON COLUMN public.public_holidays.is_working_day IS
  'true = ยกเลิกวันหยุดของวันนั้น (ครม. ถอนวันหยุดพิเศษ / อปท. สั่งเปิดทำการ) ใช้ทับตาราง static ในโค้ดได้';
