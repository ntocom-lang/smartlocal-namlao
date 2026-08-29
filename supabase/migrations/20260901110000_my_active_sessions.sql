-- ให้ผู้ใช้ดูได้ว่าบัญชีตัวเองล็อกอินค้างอยู่ที่เครื่องไหนบ้าง และเตะออกทีละเครื่อง
--
-- ทำไมต้องเป็น SECURITY DEFINER: ข้อมูล session จริงอยู่ใน auth.sessions ซึ่ง PostgREST
-- ไม่ได้ expose ให้ client และ role `authenticated` ก็ไม่มีสิทธิ์บน schema auth
-- supabase-js ฝั่ง client ไม่มี API ให้ลิสต์ session ของตัวเองเลย มีแค่
-- signOut({ scope: 'others' }) ที่เตะทุกเครื่องอื่นรวดเดียว เลือกเครื่องไม่ได้
--
-- ขอบเขตสิทธิ์: ทั้งสองฟังก์ชันกรองด้วย user_id = auth.uid() เสมอ ผู้ใช้จึงเห็นและเตะได้
-- เฉพาะ session ของตัวเอง แอดมินก็ดูของคนอื่นไม่ได้ผ่านทางนี้ (PDPA — user_agent กับ ip
-- เป็นข้อมูลส่วนบุคคล เจ้าของบัญชีดูของตัวเองเท่านั้น ถ้าวันหลังจะให้แอดมินดูได้
-- ต้องกลับมาทบทวนฐานทางกฎหมายก่อน ห้ามเพิ่มโดยถือว่าเป็นงานเล็ก)
--
-- SET search_path = '' + ชื่อเต็มทุกตัว กัน search_path attack ตามแนวทางของ Supabase
-- สำหรับฟังก์ชัน SECURITY DEFINER

-- ── ลิสต์ session ของตัวเอง ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_my_sessions()
RETURNS TABLE (
  session_id    uuid,
  created_at    timestamptz,
  last_seen_at  timestamptz,
  user_agent    text,
  ip            text,
  is_current    boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    s.id,
    s.created_at,
    -- refreshed_at เป็น timestamp ไม่มี timezone (เก็บเป็น UTC) ต้องแปลงก่อนเทียบกับคอลัมน์อื่น
    COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at),
    s.user_agent,
    host(s.ip),
    -- session_id เป็น claim มาตรฐานใน access token ที่ GoTrue ออกให้ ใช้ชี้ว่าแถวไหน
    -- คือเครื่องที่กำลังเรียกฟังก์ชันนี้อยู่
    s.id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid
  FROM auth.sessions s
  WHERE s.user_id = auth.uid()
  ORDER BY COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at) DESC;
$$;

-- ── เตะ session ของตัวเองออกทีละเครื่อง ────────────────────────────────────
--
-- ลบแถวใน auth.sessions = เพิกถอน refresh token ของเครื่องนั้น (GoTrue รุ่นนี้ผูก
-- refresh token กับ session ผ่าน refresh_token_hmac_key/refresh_token_counter บนแถว
-- session โดยตรง ลบแถวแล้วต่ออายุไม่ได้อีก)
--
-- ⚠️ ข้อจำกัดที่ต้องบอกผู้ใช้บนหน้าจอ: access token ใบที่เครื่องนั้นถืออยู่ยังใช้ได้
-- จนหมดอายุ (ไม่เกิน 1 ชั่วโมง) การเตะจึงไม่ได้ดีดออกทันทีเสมอไป
CREATE OR REPLACE FUNCTION public.revoke_my_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อนจึงจะจัดการอุปกรณ์ได้'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM auth.sessions
  WHERE id = p_session_id
    AND user_id = auth.uid();   -- กันเตะ session ของคนอื่นเด็ดขาด

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

-- anon ไม่ต้องเรียกได้ และ PUBLIC ต้องไม่ติดมากับ default grant ของ CREATE FUNCTION
REVOKE ALL ON FUNCTION public.list_my_sessions()          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_my_session(uuid)     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_sessions()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_my_session(uuid)  TO authenticated;
