-- 20261020170000_community_survey_tables.sql
--
-- [เฟสตาราง] แบบสำรวจความเห็นประชาชน (เฟส 1) — ฟังก์ชันอยู่ไฟล์ถัดไป 20261020170100 (แยกไฟล์ตามเฟส DDL)
--
-- ── หลักการ: แยก "ใครตอบแล้ว" ออกจาก "เลือกข้อไหน" ────────────────────────────────────────────
-- survey_voters  = ทะเบียนผู้ใช้สิทธิ์ (survey_id, user_id) — มีไว้กันตอบซ้ำอย่างเดียว ไม่มีเวลา ไม่มีตัวเลือก
-- survey_ballots = หีบบัตร — เก็บแค่ แบบสำรวจ + ตัวเลือก + กลุ่มผู้ตอบ (citizen/official) + ความเห็นที่พิมพ์
--                  ไม่มีคอลัมน์ user_id ไม่มีเวลา (ไม่มี created_at) และ id เป็น uuid สุ่ม จึงเรียงตามเวลาแล้วเทียบกับ
--                  ทะเบียนผู้ใช้สิทธิ์ไม่ได้ · ตัวเชื่อมสองตารางไม่มีอยู่ในฐานข้อมูล
-- ทั้งสองตารางเขียนด้วยฟังก์ชัน cast_survey_vote() ตัวเดียวในทรานแซกชันเดียวกัน (ลงทะเบียนสำเร็จ = บัตรลงหีบ หรือไม่ก็ไม่ทั้งคู่)
-- ⚠️ ความลับระดับนี้คือ "ไม่มีช่องทางในระบบให้ใครเปิดดูรายบุคคล" ไม่ใช่การลงคะแนนเลือกตั้ง — ผู้ดูแลฐานข้อมูลที่อ่านตารางตรงๆ
--    ยังประมวลผลเกี่ยวกับลำดับแถวฟิสิคัลได้ในทางทฤษฎี ผลแบบสำรวจนี้ไม่ใช่มติ (ป้ายบนหน้าจอบอกชัดเจน)
--
-- ── สิทธิ์ ───────────────────────────────────────────────────────────────────────────────────
-- ตารางใหม่ได้ ALL ให้ anon/authenticated อัตโนมัติจาก default privileges ของ Supabase — ถอนก่อน
-- RLS เปิดและไม่มี policy สักอัน = ไม่มีใครอ่านหรือเขียนได้นอกจากฟังก์ชัน SECURITY DEFINER ในไฟล์ถัดไป
-- (ผู้ไม่ล็อกอินมี SELECT ระดับตารางจาก default ถ้าไม่ถอน — ดู docs/ai/NOTES.md เรื่อง anon table grants)
--
-- ทดสอบพฤติกรรมด้วย PGlite: tests/community-survey-db.test.mjs

BEGIN;

CREATE TABLE IF NOT EXISTS public.surveys (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id  uuid        NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  question         text        NOT NULL CHECK (char_length(btrim(question)) BETWEEN 5 AND 200),
  -- ช่องความเห็นที่พิมพ์เอง เปิด-ปิดได้ตอนสร้างและระหว่างที่ยังเปิดรับ (ปิดแล้วความเห็นเดิมยังอยู่)
  allow_comment    boolean     NOT NULL DEFAULT true,
  opens_at         timestamptz NOT NULL DEFAULT now(),
  closes_at        timestamptz NOT NULL,
  -- ปิดก่อนกำหนดโดยเจ้าหน้าที่ — เวลาปิดจริงคือค่าที่น้อยกว่าระหว่าง closes_at กับ closed_early_at
  closed_early_at  timestamptz,
  closed_early_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT surveys_close_after_open CHECK (closes_at > opens_at)
);

CREATE INDEX IF NOT EXISTS surveys_muni_close_idx ON public.surveys (municipality_id, closes_at DESC);

CREATE TABLE IF NOT EXISTS public.survey_options (
  id          uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id   uuid     NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  position    smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
  label       text     NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
  CONSTRAINT survey_options_position_once UNIQUE (survey_id, position),
  -- ให้หีบบัตรอ้างตัวเลือกพร้อมแบบสำรวจได้ (กันบัตรที่ชี้ตัวเลือกของแบบสำรวจอื่น)
  CONSTRAINT survey_options_id_survey_key UNIQUE (id, survey_id)
);

-- ทะเบียนผู้ใช้สิทธิ์: ไม่มีเวลา ไม่มีตัวเลือก — ลบบัญชีแล้วแถวหาย แต่บัตรในหีบอยู่ต่อ (ยอดรวมไม่เปลี่ยน)
CREATE TABLE IF NOT EXISTS public.survey_voters (
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (survey_id, user_id)
);

-- หีบบัตร: ห้ามเพิ่มคอลัมน์ user_id / created_at / ตัวระบุตัวตนใดๆ ลงตารางนี้ (tests/community-survey-db.test.mjs ตรวจรายชื่อคอลัมน์)
CREATE TABLE IF NOT EXISTS public.survey_ballots (
  id           uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id    uuid     NOT NULL,
  option_id    uuid     NOT NULL,
  -- กลุ่มผู้ตอบ ณ ตอนตอบ: official = ผู้มีตำแหน่ง (role ชุดเดียวกับ OFFICIAL_ROLES) · citizen = นอกนั้น
  voter_group  text     NOT NULL CHECK (voter_group IN ('citizen', 'official')),
  -- ความเห็นที่พิมพ์ (ไม่บังคับ) — ฟังก์ชันซ่อนเบอร์โทร/เลขบัตร/อีเมลก่อนบันทึก · เห็นเฉพาะเจ้าหน้าที่ · ลบทิ้งเองหลังปิด 90 วัน
  comment      text     CHECK (comment IS NULL OR char_length(comment) <= 300),
  CONSTRAINT survey_ballots_option_in_survey FOREIGN KEY (option_id, survey_id)
    REFERENCES public.survey_options (id, survey_id) ON DELETE CASCADE,
  CONSTRAINT survey_ballots_survey_fk FOREIGN KEY (survey_id) REFERENCES public.surveys (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS survey_ballots_survey_option_idx ON public.survey_ballots (survey_id, option_id);

REVOKE ALL ON public.surveys, public.survey_options, public.survey_voters, public.survey_ballots FROM anon, authenticated, PUBLIC;
ALTER TABLE public.surveys        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_voters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_ballots ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.survey_voters  IS 'ทะเบียนผู้ใช้สิทธิ์แบบสำรวจ — กันตอบซ้ำเท่านั้น ห้ามเพิ่มเวลาหรือตัวเลือก (ไม่ให้เชื่อมกับ survey_ballots)';
COMMENT ON TABLE public.survey_ballots IS 'หีบบัตรแบบสำรวจ — ห้ามเพิ่ม user_id/created_at · เขียนผ่าน cast_survey_vote() เท่านั้น';

COMMIT;
