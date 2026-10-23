-- ลงนามออนไลน์รายเรื่อง — ชุด S1 (2/2): ฟังก์ชัน/RLS/trigger ของ "ภาพลายเซ็น" (เจ้าของระบบสั่ง 2026-10-23)
-- ต้องรัน 20261023100000_esign_image_tables.sql ก่อน
--
-- ฟังก์ชันใหม่ล้วน ไม่ CREATE OR REPLACE ทับของเดิม (docs/ai/NOTES.md ข้อ 5):
--   esign_sign_fleet_trip_stamped ครอบ esign_sign_fleet_trip เดิมไว้ในทรานแซกชันเดียว แล้วแนบภาพให้ลายเซ็นที่เพิ่งเกิด
--   ตรวจภาพให้ผ่านก่อนเรียกของเดิมเสมอ — ภาพเสียต้องไม่ไปเผาจำนวนครั้งใส่รหัสผิดของผู้ลงนาม
--   ของเดิมตอบ {ok:false,...} แทนการ raise เพื่อให้ตัวนับรหัสผิด commit; ตัวครอบไม่ raise ทับผลของเดิมเช่นกัน
--
-- ภาพไม่เพิ่มน้ำหนักทางกฎหมายของลายเซ็น — หลักฐานคือบันทึกลงนาม (ผู้ลงนาม รหัส เวลา hash) ภาพเป็นส่วนแสดงบนใบพิมพ์
-- หน้าตรวจสอบสาธารณะ (esign_verify) ไม่แสดงภาพ และไม่เปลี่ยนแปลงในไฟล์นี้

DO $guard$
BEGIN
  IF to_regclass('public.esign_signature_stamps') IS NULL OR to_regclass('public.esign_signature_images') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261023100000_esign_image_tables.sql ก่อน';
  END IF;
  IF to_regprocedure('public.esign_sign_fleet_trip(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20261022100200_esign_functions.sql ก่อน';
  END IF;
END;
$guard$;

-- ── 1) RLS: ปิดทุกทางตรง ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.esign_image_blobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_signature_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.esign_signature_stamps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.esign_image_blobs, public.esign_signature_images, public.esign_signature_stamps
  FROM PUBLIC, anon, authenticated;
-- ไม่มี policy และไม่ GRANT อะไรเลย: อ่าน/เขียนผ่านฟังก์ชัน SECURITY DEFINER ด้านล่างเท่านั้น

-- ── 2) ดัชนี + trigger ────────────────────────────────────────────────────────────────────────
-- ผู้ใช้มีลายเซ็นค่าเริ่มต้นได้ไม่เกิน 1 แบบ
CREATE UNIQUE INDEX IF NOT EXISTS esign_signature_images_one_default
  ON public.esign_signature_images (user_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS esign_signature_images_user_idx
  ON public.esign_signature_images (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS esign_signature_images_sha_idx
  ON public.esign_signature_images (sha256);
CREATE INDEX IF NOT EXISTS esign_signature_stamps_sha_idx
  ON public.esign_signature_stamps (sha256);

-- ภาพที่ใช้ลงนามแล้วเป็นหลักฐาน แก้/ลบ/TRUNCATE ไม่ได้ (ใช้ trigger กลางของชุด A)
DROP TRIGGER IF EXISTS trg_esign_stamps_append_only ON public.esign_signature_stamps;
CREATE TRIGGER trg_esign_stamps_append_only
BEFORE UPDATE OR DELETE ON public.esign_signature_stamps
FOR EACH ROW EXECUTE FUNCTION public.esign_block_mutation();
DROP TRIGGER IF EXISTS trg_esign_stamps_no_truncate ON public.esign_signature_stamps;
CREATE TRIGGER trg_esign_stamps_no_truncate
BEFORE TRUNCATE ON public.esign_signature_stamps
FOR EACH STATEMENT EXECUTE FUNCTION public.esign_block_mutation();

-- ภาพใน blob แก้ไม่ได้ (ตาม sha256 ของเนื้อหา) — ลบได้เฉพาะตอนไม่มีใครอ้างถึง ซึ่ง FK RESTRICT คุมอยู่
DROP TRIGGER IF EXISTS trg_esign_blobs_no_update ON public.esign_image_blobs;
CREATE TRIGGER trg_esign_blobs_no_update
BEFORE UPDATE ON public.esign_image_blobs
FOR EACH ROW EXECUTE FUNCTION public.esign_block_mutation();
DROP TRIGGER IF EXISTS trg_esign_blobs_no_truncate ON public.esign_image_blobs;
CREATE TRIGGER trg_esign_blobs_no_truncate
BEFORE TRUNCATE ON public.esign_image_blobs
FOR EACH STATEMENT EXECUTE FUNCTION public.esign_block_mutation();

-- ── 3) ตัวช่วยภายใน (ไม่เปิดให้ API) ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.esign_is_staff_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND COALESCE(public.get_my_role(), '') IN ('superadmin', 'admin', 'officer', 'staff', 'technician', 'viewer', 'council')
$$;

-- แปลง base64 → PNG และตรวจโครงสร้างจริง: ลายเซ็น PNG ครบ (IHDR ... IEND) ไม่เกิน 50,000 ไบต์ ไม่เกิน 640×320 px
-- รับเฉพาะ PNG เท่านั้น (ไม่รับ SVG/JPEG/GIF — ตัดความเสี่ยงสคริปต์ฝังในภาพและ metadata ติดมา)
-- ผลลัพธ์: r_code ว่าง = ผ่าน
CREATE OR REPLACE FUNCTION public.esign_png_decode(p_b64 text, OUT r_png bytea, OUT r_code text, OUT r_width integer, OUT r_height integer)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_len integer;
BEGIN
  IF p_b64 IS NULL OR p_b64 = '' THEN
    r_code := 'invalid_image';
    RETURN;
  END IF;
  IF char_length(p_b64) > 66700 THEN
    r_code := 'image_too_large';
    RETURN;
  END IF;
  IF p_b64 !~ '^[A-Za-z0-9+/]+={0,2}$' OR char_length(p_b64) % 4 <> 0 THEN
    r_code := 'invalid_image';
    RETURN;
  END IF;
  BEGIN
    r_png := decode(p_b64, 'base64');
  EXCEPTION WHEN OTHERS THEN
    r_png := NULL;
    r_code := 'invalid_image';
    RETURN;
  END;
  v_len := octet_length(r_png);
  IF v_len > 50000 THEN
    r_png := NULL;
    r_code := 'image_too_large';
    RETURN;
  END IF;
  IF v_len < 67
     OR substring(r_png from 1 for 8) <> '\x89504e470d0a1a0a'::bytea
     OR substring(r_png from 13 for 4) <> '\x49484452'::bytea
     OR substring(r_png from v_len - 11 for 12) <> '\x0000000049454e44ae426082'::bytea THEN
    r_png := NULL;
    r_code := 'invalid_image';
    RETURN;
  END IF;
  -- ความกว้าง/สูงอยู่ในชิ้นส่วน IHDR (ไบต์ 16–19 และ 20–23, big-endian); ไบต์สูงสองตัวต้องเป็น 0 (ไม่เกิน 65,535)
  IF get_byte(r_png, 16) <> 0 OR get_byte(r_png, 17) <> 0 OR get_byte(r_png, 20) <> 0 OR get_byte(r_png, 21) <> 0 THEN
    r_png := NULL;
    r_code := 'invalid_image_size';
    RETURN;
  END IF;
  r_width := get_byte(r_png, 18) * 256 + get_byte(r_png, 19);
  r_height := get_byte(r_png, 22) * 256 + get_byte(r_png, 23);
  IF r_width < 1 OR r_width > 640 OR r_height < 1 OR r_height > 320 THEN
    r_png := NULL;
    r_code := 'invalid_image_size';
    RETURN;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.esign_is_staff_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.esign_png_decode(text) FROM PUBLIC, anon, authenticated;

-- ── 4) คลังลายเซ็นของฉัน ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.esign_my_signatures()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_items jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF NOT public.esign_is_staff_user() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'label', i.label,
           'is_default', i.is_default,
           'created_at', i.created_at,
           'width', b.width,
           'height', b.height,
           -- encode(..., 'base64') ตัดบรรทัดทุก 76 ตัวอักษร ต้องเอา \n ออกก่อนใช้เป็น data URL
           'png_base64', replace(encode(b.png, 'base64'), E'\n', '')
         ) ORDER BY i.is_default DESC, i.created_at DESC), '[]'::jsonb)
    INTO v_items
  FROM public.esign_signature_images i
  JOIN public.esign_image_blobs b ON b.sha256 = i.sha256
  WHERE i.user_id = auth.uid();
  RETURN jsonb_build_object('ok', true, 'items', v_items, 'max', 5);
END;
$$;

CREATE OR REPLACE FUNCTION public.esign_my_signature_add(
  p_label        text,
  p_png_base64   text,
  p_make_default boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_muni    uuid;
  v_label   text := left(NULLIF(btrim(COALESCE(p_label, '')), ''), 40);
  v_dec     record;
  v_sha     text;
  v_exist   uuid;
  v_count   integer;
  v_default boolean;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF NOT public.rpc_rate_limit_hit('esign_image', 20, interval '5 minutes') THEN
    RAISE EXCEPTION 'ลองถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' USING ERRCODE = 'PT429';
  END IF;
  IF NOT public.esign_is_staff_user() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  SELECT * INTO v_dec FROM public.esign_png_decode(p_png_base64);
  IF v_dec.r_code IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', v_dec.r_code);
  END IF;
  v_sha := encode(sha256(v_dec.r_png), 'hex');

  -- ภาพเดียวกัน (ไบต์ต่อไบต์) ที่มีอยู่แล้ว = สำเร็จโดยไม่เพิ่มแถว (กดซ้ำ/ส่งซ้ำไม่ทำให้คลังรก)
  SELECT i.id INTO v_exist FROM public.esign_signature_images i WHERE i.user_id = v_uid AND i.sha256 = v_sha LIMIT 1;
  IF FOUND THEN
    IF COALESCE(p_make_default, false) THEN
      UPDATE public.esign_signature_images SET is_default = false WHERE user_id = v_uid AND is_default AND id <> v_exist;
      UPDATE public.esign_signature_images SET is_default = true WHERE id = v_exist;
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_exist, 'already', true);
  END IF;

  SELECT count(*)::int INTO v_count FROM public.esign_signature_images WHERE user_id = v_uid;
  IF v_count >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'too_many_images', 'max', 5);
  END IF;

  INSERT INTO public.esign_image_blobs (sha256, png, width, height)
  VALUES (v_sha, v_dec.r_png, v_dec.r_width, v_dec.r_height)
  ON CONFLICT (sha256) DO NOTHING;

  -- แบบแรกของผู้ใช้เป็นค่าเริ่มต้นเสมอ (ลงนามแล้วแนบให้เอง ผู้ใช้ไม่ต้องไปตั้ง)
  v_default := (v_count = 0) OR COALESCE(p_make_default, false);
  IF v_default THEN
    UPDATE public.esign_signature_images SET is_default = false WHERE user_id = v_uid AND is_default;
  END IF;
  INSERT INTO public.esign_signature_images (user_id, label, sha256, is_default)
  VALUES (v_uid, COALESCE(v_label, 'ลายเซ็นของฉัน'), v_sha, v_default)
  RETURNING id INTO v_id;

  SELECT p.municipality_id INTO v_muni FROM public.profiles p WHERE p.id = v_uid;
  -- audit ไม่เก็บตัวภาพ (ข้อมูลส่วนบุคคล) เก็บแค่ขนาด
  PERFORM public.esign_audit(v_muni, 'esign_image_add', 'esign_image', v_id::text, COALESCE(v_label, 'ลายเซ็นของฉัน'),
    jsonb_build_object('width', v_dec.r_width, 'height', v_dec.r_height, 'bytes', octet_length(v_dec.r_png), 'default', v_default));
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'already', false, 'is_default', v_default);
END;
$$;

CREATE OR REPLACE FUNCTION public.esign_my_signature_set_default(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF NOT public.esign_is_staff_user() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.esign_signature_images WHERE id = p_id AND user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'image_not_found');
  END IF;
  UPDATE public.esign_signature_images SET is_default = false WHERE user_id = v_uid AND is_default AND id <> p_id;
  UPDATE public.esign_signature_images SET is_default = true WHERE id = p_id AND user_id = v_uid;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ลบภาพออกจากคลังของฉัน: ใบที่ลงนามไปแล้วยังแสดงภาพเดิม (สำเนาอยู่ที่ esign_signature_stamps เป็นหลักฐาน)
-- ภาพที่ไม่มีใบไหนอ้างถึงแล้วถูกลบทิ้งจริง
CREATE OR REPLACE FUNCTION public.esign_my_signature_delete(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_muni        uuid;
  v_sha         text;
  v_label       text;
  v_was_default boolean;
  v_used        boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF NOT public.esign_is_staff_user() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  DELETE FROM public.esign_signature_images
   WHERE id = p_id AND user_id = v_uid
  RETURNING sha256, label, is_default INTO v_sha, v_label, v_was_default;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'image_not_found');
  END IF;

  IF v_was_default THEN
    UPDATE public.esign_signature_images SET is_default = true
     WHERE id = (SELECT i.id FROM public.esign_signature_images i WHERE i.user_id = v_uid ORDER BY i.created_at DESC LIMIT 1);
  END IF;

  v_used := EXISTS (SELECT 1 FROM public.esign_signature_stamps s WHERE s.sha256 = v_sha);
  DELETE FROM public.esign_image_blobs b
   WHERE b.sha256 = v_sha
     AND NOT EXISTS (SELECT 1 FROM public.esign_signature_images i WHERE i.sha256 = v_sha)
     AND NOT EXISTS (SELECT 1 FROM public.esign_signature_stamps s WHERE s.sha256 = v_sha);

  SELECT p.municipality_id INTO v_muni FROM public.profiles p WHERE p.id = v_uid;
  PERFORM public.esign_audit(v_muni, 'esign_image_delete', 'esign_image', p_id::text, v_label,
    jsonb_build_object('kept_as_evidence', v_used));
  -- kept_as_evidence = true: ภาพนี้เคยใช้ลงนามแล้ว สำเนาเก็บไว้เป็นหลักฐาน หน้าจอแจ้งผู้ใช้ตามนี้
  RETURN jsonb_build_object('ok', true, 'kept_as_evidence', v_used);
END;
$$;

-- ── 5) ศูนย์ลายมือชื่อของฉัน: ภาพรวม + ประวัติการลงนาม ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.esign_my_signer_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_s     public.esign_signers%ROWTYPE;
  v_month date := date_trunc('month', timezone('Asia/Bangkok', now()))::date;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF NOT public.esign_is_staff_user() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  SELECT * INTO v_s FROM public.esign_signers WHERE user_id = v_uid;
  RETURN jsonb_build_object(
    'ok', true,
    'pin_set', COALESCE(v_s.pin_hash IS NOT NULL, false),
    'pin_set_at', v_s.pin_set_at,
    'duty_acked', COALESCE(v_s.duty_ack_at IS NOT NULL, false),
    'suspended', COALESCE(v_s.suspended_at IS NOT NULL, false),
    'suspended_at', v_s.suspended_at,
    'locked_until', CASE WHEN v_s.locked_until > now() THEN v_s.locked_until ELSE NULL END,
    'failed_count', COALESCE(v_s.failed_count, 0),
    'image_count', (SELECT count(*)::int FROM public.esign_signature_images i WHERE i.user_id = v_uid),
    'signature_count', (SELECT count(*)::int FROM public.esign_signatures s
                         WHERE s.signer_id = v_uid
                           AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)),
    'signature_count_month', (SELECT count(*)::int FROM public.esign_signatures s
                               WHERE s.signer_id = v_uid
                                 AND timezone('Asia/Bangkok', s.signed_at)::date >= v_month
                                 AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id))
  );
END;
$$;

-- ประวัติการลงนามของฉัน (เฉพาะของตัวเอง) — ไม่คืนปลายทาง/วัตถุประสงค์ของคำขอ แค่บอกว่าเซ็นช่องไหน เมื่อไร ยังใช้อยู่หรือถูกถอน
CREATE OR REPLACE FUNCTION public.esign_my_signature_history(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit integer := least(greatest(COALESCE(p_limit, 20), 1), 100);
  v_items jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF NOT public.esign_is_staff_user() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  SELECT COALESCE(jsonb_agg(h.item ORDER BY h.signed_at DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT s.signed_at,
           jsonb_build_object(
             'signature_id', s.id,
             'doc_type', s.doc_type,
             'doc_id', s.doc_id,
             'slot', s.slot,
             'slot_label', public.esign_slot_label(s.slot),
             'decision', s.decision,
             'signed_at', s.signed_at,
             'revoked', (r.id IS NOT NULL),
             'revoked_at', r.revoked_at,
             'with_image', (st.signature_id IS NOT NULL)
           ) AS item
    FROM public.esign_signatures s
    LEFT JOIN public.esign_revocations r ON r.signature_id = s.id
    LEFT JOIN public.esign_signature_stamps st ON st.signature_id = s.id
    WHERE s.signer_id = v_uid
    ORDER BY s.signed_at DESC
    LIMIT v_limit
  ) h;
  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

-- ── 6) ลงนามพร้อมแนบภาพ + อ่านภาพไปใส่ใบพิมพ์ ───────────────────────────────────────────────────
-- p_image_id = ภาพจากคลังของฉัน · p_png_base64 = ภาพที่วาดตอนลงนาม (ไม่บันทึกลงคลัง) · ว่างทั้งคู่ = ลงนามโดยไม่แนบภาพ
-- ส่งทั้งสองอย่างพร้อมกันไม่ได้ (กำกวม)
CREATE OR REPLACE FUNCTION public.esign_sign_fleet_trip_stamped(
  p_trip_id    uuid,
  p_slot       text,
  p_pin        text,
  p_decision   text,
  p_image_id   uuid,
  p_png_base64 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_dec    record;
  v_png    bytea;
  v_w      integer;
  v_h      integer;
  v_sha    text;
  v_res    jsonb;
  v_sig    uuid;
  v_muni   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF p_image_id IS NOT NULL AND p_png_base64 IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_image');
  END IF;

  -- ตรวจภาพก่อนแตะรหัส: ภาพเสียต้องไม่นับเป็นรหัสผิด
  IF p_image_id IS NOT NULL THEN
    SELECT b.sha256, b.png, b.width, b.height INTO v_sha, v_png, v_w, v_h
    FROM public.esign_signature_images i
    JOIN public.esign_image_blobs b ON b.sha256 = i.sha256
    WHERE i.id = p_image_id AND i.user_id = v_uid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'image_not_found');
    END IF;
  ELSIF p_png_base64 IS NOT NULL THEN
    SELECT * INTO v_dec FROM public.esign_png_decode(p_png_base64);
    IF v_dec.r_code IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', v_dec.r_code);
    END IF;
    v_png := v_dec.r_png;
    v_w := v_dec.r_width;
    v_h := v_dec.r_height;
    v_sha := encode(sha256(v_png), 'hex');
  END IF;

  v_res := public.esign_sign_fleet_trip(p_trip_id, p_slot, p_pin, p_decision);

  IF v_sha IS NOT NULL
     AND COALESCE((v_res ->> 'ok')::boolean, false)
     AND NOT COALESCE((v_res ->> 'already')::boolean, false) THEN
    v_sig := (v_res ->> 'signature_id')::uuid;
    SELECT s.municipality_id INTO v_muni FROM public.esign_signatures s WHERE s.id = v_sig AND s.signer_id = v_uid;
    IF NOT FOUND THEN
      -- ไม่ควรเกิด: ลายเซ็นที่เพิ่งสร้างต้องเป็นของผู้เรียก — ถ้าเกิดให้ยกเลิกทั้งรายการดีกว่าแนบภาพผิดใบ
      RAISE EXCEPTION 'ESIGN_STAMP_MISMATCH';
    END IF;
    INSERT INTO public.esign_image_blobs (sha256, png, width, height)
    VALUES (v_sha, v_png, v_w, v_h)
    ON CONFLICT (sha256) DO NOTHING;
    INSERT INTO public.esign_signature_stamps (signature_id, municipality_id, sha256)
    VALUES (v_sig, v_muni, v_sha);
    v_res := v_res || jsonb_build_object('stamped', true);
  ELSE
    v_res := v_res || jsonb_build_object('stamped', false);
  END IF;
  RETURN v_res;
END;
$$;

-- ภาพบนใบพิมพ์: เฉพาะลายเซ็นที่ยังไม่ถูกถอน และเฉพาะผู้ที่เปิดดูคำขอนี้ได้ (ใช้เกณฑ์เดียวกับ esign_trip_status)
-- คืนภาพ ณ วันที่ลงนาม ไม่ใช่ภาพปัจจุบันในคลัง
CREATE OR REPLACE FUNCTION public.esign_trip_stamps(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_items jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_authenticated');
  END IF;
  IF NOT COALESCE((public.esign_trip_status(p_trip_id) ->> 'found')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'slot', s.slot,
           'signature_id', s.id,
           'width', b.width,
           'height', b.height,
           'png_base64', replace(encode(b.png, 'base64'), E'\n', '')
         ) ORDER BY s.signed_at), '[]'::jsonb)
    INTO v_items
  FROM public.esign_signatures s
  JOIN public.esign_signature_stamps st ON st.signature_id = s.id
  JOIN public.esign_image_blobs b ON b.sha256 = st.sha256
  WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = p_trip_id
    AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id);
  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

-- ── 7) สิทธิ์เรียก ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.esign_my_signatures() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_my_signature_add(text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_my_signature_set_default(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_my_signature_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_my_signer_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_my_signature_history(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_sign_fleet_trip_stamped(uuid, text, text, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.esign_trip_stamps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_my_signatures() TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_my_signature_add(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_my_signature_set_default(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_my_signature_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_my_signer_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_my_signature_history(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_sign_fleet_trip_stamped(uuid, text, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_trip_stamps(uuid) TO authenticated;

-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select has_function_privilege('anon', 'public.esign_my_signatures()', 'EXECUTE');   → false (ทุกตัวในไฟล์นี้)
--   select relrowsecurity from pg_class where relname like 'esign_%image%' or relname = 'esign_signature_stamps';  → true ทั้งสามตาราง
--   select count(*) from public.esign_signature_images;   → 0
