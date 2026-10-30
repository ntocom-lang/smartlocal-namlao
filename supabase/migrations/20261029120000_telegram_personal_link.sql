-- ข้อ 3b ตั้งค่าแจ้งเตือน (เจ้าของระบบอนุมัติ 2569-10-29): บุคลากรผูกบัญชีกับ Telegram ส่วนตัว เพื่อรับงานที่มอบหมายให้ตัวเอง
-- (ไม่ทำ LINE OA ตามที่เจ้าของระบบสั่ง)
--
-- ขั้นตอนผูก: หน้าเว็บขอลิงก์จาก Edge Function telegram-webhook (action link) → ได้ t.me/<บอต>?start=<โทเคน>
--   → ผู้ใช้กด Start ในแชทกับบอต → Telegram ส่ง /start <โทเคน> เข้า webhook → telegram_link_consume() ผูก chat กับบัญชี
--   ⇒ ผูกได้เฉพาะคนที่ถือลิงก์จากหน้าเว็บที่ล็อกอินอยู่ · โทเคนใช้ครั้งเดียว หมดอายุ 15 นาที เก็บแค่ sha256
-- เลิกผูก: ปุ่มในหน้าเว็บ (ลบแถวของตัวเองผ่าน RLS) · พิมพ์ /stop ในแชท · บล็อกบอต (Telegram แจ้ง my_chat_member)
--
-- PDPA: chat_id คือรหัสผู้ใช้ Telegram (ข้อมูลส่วนบุคคล) เก็บเฉพาะของบุคลากรที่กดผูกเอง
--   tg_display = ชื่อที่แสดงใน Telegram (ตัดไม่เกิน 64 ตัว) ไว้ให้เจ้าของบัญชีตรวจว่าผูกกับ Telegram ของตัวเองจริง
--   ไม่เก็บเบอร์โทร/ข้อความแชท · ผู้ใช้อ่านได้แค่ linked_at + tg_display ของตัวเอง (ไม่เห็น chat_id)
-- telegram_seen_chats: กลุ่ม/แชนเนลที่บอตอยู่ (แทน getUpdates ที่ใช้ไม่ได้อีกเมื่อตั้ง webhook) ไม่เก็บแชทส่วนตัว
--   ใช้หา chat id ตอนผูกกลุ่ม Telegram ของ อปท. ใหม่ และจับกรณีกลุ่มถูกอัปเกรดเป็น supergroup (รหัสเปลี่ยน)

BEGIN;

CREATE TABLE IF NOT EXISTS public.telegram_user_links (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id    bigint NOT NULL UNIQUE CHECK (chat_id > 0),
  tg_display text CHECK (tg_display IS NULL OR char_length(tg_display) BETWEEN 1 AND 64),
  linked_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.telegram_user_links IS
  'บัญชีบุคลากรที่ผูก Telegram ส่วนตัว (1 บัญชี ↔ 1 แชท) — เขียนผ่าน telegram_link_consume() เท่านั้น ผู้ใช้ลบของตัวเองได้';
COMMENT ON COLUMN public.telegram_user_links.chat_id IS
  'รหัสแชทส่วนตัวกับบอต (= รหัสผู้ใช้ Telegram) ข้อมูลส่วนบุคคล ห้ามเปิดให้ผู้ใช้อ่าน';

CREATE TABLE IF NOT EXISTS public.telegram_link_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_user
  ON public.telegram_link_tokens (user_id, created_at DESC);

COMMENT ON TABLE public.telegram_link_tokens IS
  'โทเคนผูก Telegram ใช้ครั้งเดียว อายุ 15 นาที เก็บแค่ sha256 — service role เท่านั้น';

CREATE TABLE IF NOT EXISTS public.telegram_seen_chats (
  chat_id             bigint PRIMARY KEY CHECK (chat_id < 0),
  chat_type           text NOT NULL CHECK (chat_type IN ('group', 'supergroup', 'channel')),
  title               text CHECK (title IS NULL OR char_length(title) <= 255),
  bot_status          text CHECK (bot_status IS NULL OR char_length(bot_status) <= 32),
  migrated_to_chat_id bigint,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.telegram_seen_chats IS
  'กลุ่ม/แชนเนลที่บอตเห็น (แทน getUpdates) — ไม่เก็บแชทส่วนตัว · service role เท่านั้น';

ALTER TABLE public.telegram_user_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_seen_chats  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "telegram link: owner reads" ON public.telegram_user_links;
CREATE POLICY "telegram link: owner reads" ON public.telegram_user_links
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "telegram link: owner unlinks" ON public.telegram_user_links;
CREATE POLICY "telegram link: owner unlinks" ON public.telegram_user_links
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ค่าเริ่มต้นของ Supabase ให้ anon/authenticated ทุกสิทธิ์บนตารางใหม่ — ถอนทิ้งแล้วให้เฉพาะที่ใช้
-- (RLS ไม่กัน TRUNCATE) · ไม่ให้อ่าน chat_id: column-level SELECT เฉพาะช่องที่หน้าเว็บแสดง
REVOKE ALL ON TABLE public.telegram_user_links  FROM anon, authenticated;
REVOKE ALL ON TABLE public.telegram_link_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.telegram_seen_chats  FROM anon, authenticated;
GRANT SELECT (user_id, tg_display, linked_at) ON public.telegram_user_links TO authenticated;
GRANT DELETE ON public.telegram_user_links TO authenticated;

-- เรียกจาก webhook (service role) ตอนได้ /start <โทเคน> · ทำทั้งหมดในธุรกรรมเดียว กันกดลิงก์เดียวพร้อมกันสองเครื่อง
-- คืน 'linked' | 'invalid' (ไม่พบ/ใช้แล้ว) | 'expired'
-- แชทนี้เคยผูกกับบัญชีอื่น → ย้ายมาบัญชีใหม่ (1 แชทรับงานได้บัญชีเดียว ไม่งั้นงานของสองคนปนกันในแชทเดียว)
CREATE OR REPLACE FUNCTION public.telegram_link_consume(
  p_token_hash text,
  p_chat_id bigint,
  p_display text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token   public.telegram_link_tokens%ROWTYPE;
  v_display text := nullif(left(btrim(coalesce(p_display, '')), 64), '');
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_chat_id IS NULL OR p_chat_id <= 0 THEN
    RETURN 'invalid';
  END IF;

  SELECT * INTO v_token FROM public.telegram_link_tokens
   WHERE token_hash = p_token_hash
   FOR UPDATE;
  IF NOT FOUND OR v_token.used_at IS NOT NULL THEN
    RETURN 'invalid';
  END IF;
  IF v_token.expires_at <= now() THEN
    RETURN 'expired';
  END IF;

  UPDATE public.telegram_link_tokens SET used_at = now() WHERE token_hash = p_token_hash;
  -- ลิงก์อื่นของคนเดิมที่ยังไม่ได้ใช้ ปิดทิ้ง (เหลือทางผูกทางเดียว)
  DELETE FROM public.telegram_link_tokens
   WHERE user_id = v_token.user_id AND used_at IS NULL;

  DELETE FROM public.telegram_user_links
   WHERE chat_id = p_chat_id AND user_id <> v_token.user_id;

  INSERT INTO public.telegram_user_links (user_id, chat_id, tg_display, linked_at)
  VALUES (v_token.user_id, p_chat_id, v_display, now())
  ON CONFLICT (user_id) DO UPDATE
    SET chat_id = EXCLUDED.chat_id, tg_display = EXCLUDED.tg_display, linked_at = EXCLUDED.linked_at;

  RETURN 'linked';
END;
$$;

REVOKE ALL ON FUNCTION public.telegram_link_consume(text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_link_consume(text, bigint, text) TO service_role;

COMMIT;
