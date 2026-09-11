-- ยืมข้ามกองในการยื่นครั้งเดียว เฟส 2/2 — RPC ที่แตกคำขอเดียวเป็นใบย่อยตามกอง
--
-- ⚠️ ไฟล์นี้ "ไม่แตะ" create_asset_borrow_request เดิมแม้แต่บรรทัดเดียว โดยตั้งใจ
-- ฟังก์ชันนั้นผ่านการทดสอบและใช้งานจริงมาแล้ว และยังเป็นทางยื่นแบบกองเดียวต่อไป
-- กติกา "1 ใบ = 1 กอง" ที่มันบังคับไว้ยังอยู่ครบ ตัวนี้แค่เป็นผู้เรียกที่วนเรียกทีละกอง
--
-- ⚠️ ทั้งชุดอยู่ใน transaction เดียว — กองที่ 2 ล้ม กองที่ 1 ต้องไม่เกิดด้วย
-- ถ้าปล่อยให้ client ยิงทีละกองเอง ประชาชนจะเจอสภาพ "ยื่นได้ 1 จาก 2 ใบ" ตอนเน็ตหลุด
-- แล้วไม่มีใครรู้ว่าต้องยื่นใบที่เหลือซ้ำหรือไม่ (ใบแรกก็ยกเลิกเองไม่ได้ด้วย)
--
-- ⚠️ กองหนึ่งไม่อนุมัติ อีกกองยังเดินต่อโดยตั้งใจ ไม่ยกเลิกทั้งชุดให้อัตโนมัติ —
-- "ได้เต็นท์แต่ไม่ได้เก้าอี้ แล้วยังจะยืมไหม" เป็นการตัดสินใจของผู้ยืม ไม่ใช่ของระบบ
-- หน้าจอทั้งสองฝั่งจะแสดงสถานะใบอื่นในชุดให้เห็นแทน

BEGIN;

-- p_groups = [{ "request_id": uuid, "items": [{asset_id, requested_qty}, ...] }, ...]
--   แยกกลุ่มมาจากฝั่ง client แล้ว (client รู้ว่าของชิ้นไหนอยู่กองไหนจาก list_borrowable_assets)
--   ถ้า client แบ่งผิด create_asset_borrow_request จะ RAISE เองอยู่ดี ไม่มีทางหลุด
-- p_payload = ก้อนเดียวกับที่ส่งให้ create_asset_borrow_request ใช้ร่วมกันทุกใบในชุด
CREATE OR REPLACE FUNCTION public.create_asset_borrow_batch(
  p_batch_id uuid,
  p_payload  jsonb,
  p_groups   jsonb
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_group      jsonb;
  v_request_id uuid;
  v_ids        uuid[] := '{}';
  v_count      integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน';
  END IF;

  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุรหัสชุดคำขอ';
  END IF;

  v_count := COALESCE(jsonb_array_length(p_groups), 0);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'ต้องเลือกพัสดุที่ต้องการยืมอย่างน้อย 1 รายการ';
  END IF;

  -- เพดาน 10 กองต่อชุด — อปท. ที่มีกองมากที่สุดยังไม่ถึงเลขนี้ ตั้งไว้กันคำขอที่ถูกยิง
  -- ด้วยสคริปต์จนสร้างใบเป็นร้อยในคราวเดียว (แต่ละใบมี trigger กำหนดกอง/SLA ตามมาอีก)
  IF v_count > 10 THEN
    RAISE EXCEPTION 'หนึ่งชุดคำขอแตกได้ไม่เกิน 10 ใบ';
  END IF;

  FOR v_group IN SELECT * FROM jsonb_array_elements(p_groups)
  LOOP
    v_request_id := NULLIF(v_group->>'request_id', '')::uuid;
    IF v_request_id IS NULL THEN
      RAISE EXCEPTION 'ใบในชุดคำขอต้องมีเลขอ้างอิงมาจากฝั่งผู้ใช้';
    END IF;

    -- ฟังก์ชันเดิมรับผิดชอบตรวจทุกอย่าง: สิทธิ์ วันที่ จำนวนของว่าง และกฎ 1 ใบ = 1 กอง
    PERFORM public.create_asset_borrow_request(
      v_request_id,
      p_payload,
      COALESCE(v_group->'items', '[]'::jsonb)
    );

    UPDATE public.asset_borrow_requests
    SET batch_id = p_batch_id
    WHERE request_id = v_request_id;

    v_ids := v_ids || v_request_id;
  END LOOP;

  RETURN v_ids;
END;
$$;

COMMENT ON FUNCTION public.create_asset_borrow_batch(uuid, jsonb, jsonb) IS
  'ยื่นคำขอยืมครั้งเดียวที่มีของหลายกอง — แตกเป็นใบย่อยตามกอง ผูกด้วย batch_id เดียวกัน '
  'ทั้งชุดสำเร็จหรือไม่เกิดเลย';

REVOKE ALL ON FUNCTION public.create_asset_borrow_batch(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_asset_borrow_batch(uuid, jsonb, jsonb) TO authenticated;

COMMIT;
