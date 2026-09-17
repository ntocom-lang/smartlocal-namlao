-- 20260917100000_complaint_text_origin.sql
--
-- เก็บ "ต้นฉบับที่ผู้ร้องพิมพ์" กับ "วิธีที่ผู้ร้องเลือกส่ง" ตอนยื่นคำร้อง
--
-- ที่มา: ฟอร์มคำร้องเพิ่มหน้าทวนก่อนส่ง ระบบเสนอฉบับที่เรียบเรียงด้วยกฎ (src/lib/complaintTextPolish.js)
-- ผู้ร้องเลือกเองว่าจะส่งฉบับไหน — เจ้าของระบบให้เก็บทั้งต้นฉบับและวิธีที่เลือกไว้ตรวจย้อนได้ (2569-09-17)
--
-- ⚠️ ไม่เพิ่มคอลัมน์ใหม่และไม่แตะ submit_citizen_complaint_v4 (ฟังก์ชันยาวและเป็นทางเข้าเดียวของ
-- คำร้องทุกใบ การ CREATE OR REPLACE ทับเพื่อเพิ่มพารามิเตอร์ = เสี่ยงทั้งระบบโดยไม่จำเป็น)
-- ใช้ RPC ตัวเล็กยิงตามหลังแบบเดียวกับ attach_complaint_photos() ซึ่งเป็นแพทเทิร์นที่ฟอร์มนี้ใช้อยู่แล้ว
--   • ต้นฉบับ → complaint_text_revisions (ตารางประวัติจาก 20260915110000 เขียนผ่าน definer เท่านั้น)
--   • วิธีที่เลือก → complaints.extra_data.text_source ('original' | 'system' | 'edited')
--
-- สิทธิ์: เจ้าของคำร้องที่ล็อกอิน หรือคำร้องที่ยื่นแบบไม่ล็อกอินภายใน 15 นาที (เท่ากับ
-- attach_complaint_photos) — ยิงย้อนหลังมาแก้ประวัติของคนอื่นไม่ได้ และเขียนทับของเดิมไม่ได้

CREATE OR REPLACE FUNCTION public.record_complaint_text_origin(
  p_complaint_id uuid,
  p_original     text,
  p_source       text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_c        public.complaints%ROWTYPE;
  v_original text := btrim(coalesce(p_original, ''));
  v_name     text;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('original', 'system', 'edited') THEN
    RETURN false;
  END IF;
  IF char_length(v_original) > 5000 THEN
    RETURN false;
  END IF;

  SELECT * INTO v_c FROM public.complaints WHERE id = p_complaint_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- คำร้องหมวดเฉพาะกิจไม่ผ่านหน้าทวนนี้ และ guard_adhoc_complaint_write() บล็อกการแก้ extra_data อยู่แล้ว
  IF public.complaint_category_is_adhoc(v_c.municipality_id, v_c.category) THEN
    RETURN false;
  END IF;

  IF NOT (
    (v_c.user_id IS NOT NULL AND v_c.user_id = auth.uid())
    OR (v_c.user_id IS NULL AND v_c.created_at > now() - interval '15 minutes')
  ) THEN
    RETURN false;
  END IF;

  -- เก็บต้นฉบับเฉพาะเมื่อข้อความที่ส่งจริงต่างจากที่พิมพ์มา และยังไม่เคยเก็บของใบนี้
  -- (client ยิงซ้ำได้เมื่อสัญญาณสะดุด — ต้องไม่ได้ประวัติซ้ำสองแถว)
  IF p_source <> 'original'
     AND v_original <> ''
     AND v_original IS DISTINCT FROM v_c.detail
     AND NOT EXISTS (
       SELECT 1 FROM public.complaint_text_revisions r
       WHERE r.complaint_id = p_complaint_id AND r.edited_role = 'citizen'
     )
  THEN
    SELECT nullif(btrim(full_name), '') INTO v_name FROM public.profiles WHERE id = auth.uid();
    INSERT INTO public.complaint_text_revisions
      (complaint_id, municipality_id, field, old_value, new_value, edited_by, edited_by_name, edited_role)
    VALUES (
      p_complaint_id, v_c.municipality_id, 'detail', v_original, v_c.detail,
      auth.uid(), coalesce(v_name, 'ผู้ร้อง') || ' (ก่อนส่ง)', 'citizen'
    );
  END IF;

  UPDATE public.complaints
  SET extra_data = coalesce(extra_data, '{}'::jsonb) || jsonb_build_object('text_source', p_source)
  WHERE id = p_complaint_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_complaint_text_origin(uuid, text, text) FROM PUBLIC;
-- ฟอร์มคำร้องเปิดให้ผู้ไม่ล็อกอินยื่นได้ ตัว RPC จึงต้องเรียกได้ด้วย anon เหมือน attach_complaint_photos
GRANT EXECUTE ON FUNCTION public.record_complaint_text_origin(uuid, text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.record_complaint_text_origin(uuid, text, text) IS
  'บันทึกต้นฉบับที่ผู้ร้องพิมพ์ (ลง complaint_text_revisions) และวิธีที่เลือกส่ง (extra_data.text_source) หลังยื่นคำร้องผ่านหน้าทวนก่อนส่ง';

-- ตรวจหลัง apply (tenant demo, ในทรานแซกชันที่ rollback):
--   ยื่นคำร้อง 1 ใบ → เรียกด้วย source='system' → ได้ true, มีแถวใน complaint_text_revisions 1 แถว
--   เรียกซ้ำ → ยังได้ true แต่ไม่มีแถวเพิ่ม · เรียกจากผู้ใช้อื่น → false
--   source='original' → ไม่มีแถวประวัติ แต่ extra_data.text_source = 'original'
