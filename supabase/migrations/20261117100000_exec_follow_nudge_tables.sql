-- 20261117100000_exec_follow_nudge_tables.sql
--
-- ห้องผู้บริหาร เฟส E3-2 — ไฟล์ 1/2: ตารางเปล่า "ติดตามเรื่อง" + "บันทึกการเร่งรัด"
-- (แยกไฟล์ตามกติกา NOTES.md ข้อ 3 — CREATE TABLE แล้วอ้างตารางในไฟล์เดียวกันเคยพัง 42P01)
--
-- ทำไมต้องมี (แผน E3 ที่เจ้าของระบบอนุมัติ 2026-11-10 ส่วน ②-7 "ไม่เพิ่มงานกอง"):
--   - exec_follows : ผู้บริหารกด ⭐ ติดตามเรื่อง → แจ้งความเคลื่อนไหวในสรุปเช้า (E3-3) เท่านั้น
--                    ไม่เปลี่ยนอะไรในตัวเรื่อง · เรื่องเสร็จแล้วระบบเลิกติดตามเอง (E3-3 ปิดแถวหลังแจ้งว่าเสร็จ)
--   - exec_nudges  : ผู้บริหารกด "ส่งให้กองเร่งรัด" → Telegram ส่วนตัวถึง ผอ.กอง (profiles.is_dept_head)
--                    ผอ.กองไม่ได้ผูก Telegram → ส่งเข้ากลุ่ม อปท. แทน (เจ้าของระบบเลือก 2026-11-11)
--                    เก็บประวัติว่าใครเร่งเมื่อไร · ไม่สร้างสถานะ/เอกสาร · ไม่ลง complaint_timeline
--                    เร่งได้ "วันละครั้งต่อเรื่อง" (นับรวมทุกคน กัน ผอ.กองโดนนายก+รองนายก+ปลัดยิงซ้ำ)
--
-- PDPA: ทั้งสองตารางไม่เก็บชื่อผู้ร้อง/รายละเอียดเรื่อง — เก็บแค่ประเภท + id + เลขที่ (snapshot ไว้ตรวจย้อน)
--   ตำแหน่งผู้เร่ง snapshot เป็นข้อความ (nudged_by_position) — บัญชีถูกลบแล้วประวัติยังบอกได้ว่า "นายก" เป็นคนเร่ง
--
-- สิทธิ์: เปิด RLS และไม่มี policy ⇒ authenticated/anon อ่าน-เขียนตรงไม่ได้เลย
--   อ่าน/เขียนผ่านฟังก์ชัน SECURITY DEFINER ในไฟล์ 2 เท่านั้น · service_role (Edge Function) ข้าม RLS ตามปกติ
--
-- item_id ไม่มี FK เพราะชี้ได้ 2 ตาราง (complaints / document_requests) — เรื่องถูกลบ ประวัติการเร่งยังอยู่ (ตั้งใจ)
--
-- ย้อนกลับ (ต้อง DROP ฟังก์ชันไฟล์ 2 ก่อน):
--   DROP TABLE public.exec_nudges; DROP TABLE public.exec_follows;

-- FK ไป auth.users ต้องล็อกตารางผู้ใช้ชั่วครู่ — รอคิวล็อกนานแล้วจะบล็อกการล็อกอิน ⇒ รอไม่เกิน 5 วินาทีแล้วล้มทั้งไฟล์
SET lock_timeout = '5s';

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(need.tbl || '.' || need.col, ', ')
    INTO v_missing
  FROM (VALUES
    ('municipalities', 'id'), ('departments', 'id'),
    ('profiles', 'is_dept_head'), ('profiles', 'department_id')
  ) AS need(tbl, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = need.tbl AND c.column_name = need.col
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'exec_follow_nudge_tables: ไม่พบคอลัมน์ %', v_missing;
  END IF;
  -- ไฟล์นี้ต้องมาหลังเฟส E2 (ด่านสิทธิ์กลาง)
  IF to_regprocedure('public.exec_assert_viewer(uuid)') IS NULL THEN
    RAISE EXCEPTION 'exec_follow_nudge_tables: ต้อง apply 20261115100000_exec_access_overview.sql ก่อน';
  END IF;
END $$;

-- ── ติดตามเรื่อง ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.exec_follows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id   uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_kind         text NOT NULL CHECK (item_kind IN ('complaint', 'document_request')),
  item_id           uuid NOT NULL,
  item_ref          text NOT NULL CHECK (char_length(item_ref) BETWEEN 1 AND 40),
  -- สถานะที่แจ้งผู้ติดตามไปแล้วล่าสุด — สรุปเช้า (E3-3) เทียบกับสถานะปัจจุบันเพื่อบอก "เปลี่ยนจาก…เป็น…"
  last_seen_status  text CHECK (last_seen_status IS NULL OR char_length(last_seen_status) <= 30),
  last_seen_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  ended_reason      text CHECK (ended_reason IS NULL OR ended_reason IN ('unfollowed', 'done', 'gone')),
  CONSTRAINT exec_follows_end_pair CHECK ((ended_at IS NULL) = (ended_reason IS NULL))
);

-- ติดตามซ้ำเรื่องเดิมไม่ได้ขณะยังติดตามอยู่ (เลิกแล้วกดติดตามใหม่ได้ = แถวใหม่)
CREATE UNIQUE INDEX IF NOT EXISTS exec_follows_active_uniq
  ON public.exec_follows (user_id, item_kind, item_id)
  WHERE ended_at IS NULL;

-- สรุปเช้า E3-3 ไล่ "ผู้ติดตามที่ยังติดตามอยู่ของ อปท. นี้"
CREATE INDEX IF NOT EXISTS exec_follows_active_muni_idx
  ON public.exec_follows (municipality_id, user_id)
  WHERE ended_at IS NULL;

ALTER TABLE public.exec_follows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.exec_follows FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.exec_follows IS
  'ห้องผู้บริหาร E3-2: ผู้บริหารติดตามเรื่อง (คำร้อง/คำขอ) — แจ้งในสรุปเช้าเท่านั้น ไม่แตะตัวเรื่อง · เขียนผ่าน exec_follow()/exec_unfollow() เท่านั้น';

-- ── บันทึกการเร่งรัด ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.exec_nudges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id     uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  item_kind           text NOT NULL CHECK (item_kind IN ('complaint', 'document_request')),
  item_id             uuid NOT NULL,
  item_ref            text NOT NULL CHECK (char_length(item_ref) BETWEEN 1 AND 40),
  department_id       uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  -- ผู้เร่งคนแรกของวัน — กดซ้ำหลังส่งพลาดไม่เขียนทับ (คนกดซ้ำอยู่ที่ last_retry_by)
  -- SET NULL: ลบ/รวมบัญชีได้ไม่ติด FK · ตำแหน่ง snapshot ยังบอกได้ว่าใครสั่ง
  nudged_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nudged_by_position  text NOT NULL CHECK (char_length(nudged_by_position) BETWEEN 1 AND 120),
  last_retry_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_retry_at       timestamptz,
  nudged_on           date NOT NULL,              -- วันที่ตามเวลาไทย ใช้คุม "วันละครั้งต่อเรื่อง"
  nudged_at           timestamptz NOT NULL DEFAULT now(),
  -- ผลการส่ง (Edge Function เขียนด้วย service_role)
  --   pending = รอส่ง · sending = Edge Function จองแถวแล้วกำลังส่ง (กันดับเบิลคลิก/สองแท็บส่ง Telegram ซ้ำ:
  --   UPDATE ... SET delivery='sending' WHERE id=$1 AND delivery='pending' AND ผู้เรียก = ผู้กดล่าสุด → 0 แถว = หยุด)
  --   dm = ถึง ผอ.กองทาง Telegram ส่วนตัว ≥1 คน · group = ส่งเข้ากลุ่ม อปท. แทน
  --   none = ไม่มีช่องทางให้ส่งเลย (ผอ.กองไม่ผูก และ อปท. ไม่ได้ผูกกลุ่ม) · failed = ส่งแล้ว Telegram ปฏิเสธ/ต่อไม่ติด
  delivery            text NOT NULL DEFAULT 'pending'
                      CHECK (delivery IN ('pending', 'sending', 'dm', 'group', 'none', 'failed')),
  delivered_count     integer NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  delivery_note       text CHECK (delivery_note IS NULL OR char_length(delivery_note) <= 300),
  delivered_at        timestamptz,
  attempt_count       integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  CONSTRAINT exec_nudges_once_per_day UNIQUE (item_kind, item_id, nudged_on)
);

CREATE INDEX IF NOT EXISTS exec_nudges_muni_item_idx
  ON public.exec_nudges (municipality_id, item_kind, item_id, nudged_at DESC);

-- คุมเพดานรายคนต่อวัน (exec_nudge นับจากดัชนีนี้)
CREATE INDEX IF NOT EXISTS exec_nudges_actor_day_idx
  ON public.exec_nudges (nudged_by, nudged_on);

ALTER TABLE public.exec_nudges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.exec_nudges FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.exec_nudges IS
  'ห้องผู้บริหาร E3-2: บันทึกการเร่งรัดรายเรื่อง (วันละครั้งต่อเรื่อง) — ไม่สร้างสถานะ ไม่ลง timeline · เขียนผ่าน exec_nudge() และ Edge Function (service_role) เท่านั้น';
COMMENT ON COLUMN public.exec_nudges.delivery_note IS
  'ข้อความทางเทคนิคจากผู้ให้บริการเท่านั้น ห้ามมีข้อมูลผู้ร้องหรือรายละเอียดเรื่อง';

-- ── ด่านยืนยันท้ายไฟล์ ──────────────────────────────────────────────────────────────
-- REVOKE ถอนได้เฉพาะ grant ที่ผู้สั่งเป็น grantor — ถ้า default privileges มาจาก grantor อื่น คำสั่งผ่านเงียบๆ
-- แต่สิทธิ์ยังอยู่ ด่านนี้ทำให้ทั้งไฟล์ย้อนกลับแทน "รันผ่านแต่ไม่ได้ปิดอะไร" (แบบเดียวกับ 20261114100000)
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(t.tbl || ':' || r.rol, ', ')
    INTO v_bad
  FROM (VALUES ('public.exec_follows'), ('public.exec_nudges')) AS t(tbl)
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rol)
  WHERE has_table_privilege(r.rol, t.tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'exec_follow_nudge_tables: ยังมีสิทธิ์ตารางหลุดให้ %', v_bad;
  END IF;
END $$;

RESET lock_timeout;
