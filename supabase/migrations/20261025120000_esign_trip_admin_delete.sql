-- ผู้ดูแลระบบของ อปท. ลบทริปที่เคยมีลายเซ็นออนไลน์ได้ (เจ้าของระบบสั่ง 2569-10-25)
--
-- เดิม trigger esign_fleet_trip_guard ห้ามลบทริปที่เคยมีลายเซ็น (แม้ถอนแล้ว) กับทุกคน ปุ่ม "ลบ" ของแอดมินจึงขึ้น
-- "ลบไม่สำเร็จ: ทริปที่เคยมีลายเซ็นออนไลน์ลบไม่ได้" — ทริปทดสอบที่ลงนามไปแล้วลบทิ้งไม่ได้เลย
--
-- ที่เปลี่ยน: เฉพาะแอดมินของ อปท. นั้น (หรือ superadmin) ลบได้ · คนอื่นยังถูกกันด้วยรหัสเดิม ESIGN_TRIP_HAS_SIGNATURES
-- ทำไมลบได้โดยไม่ทำลายหลักฐาน:
--   • esign_signatures เก็บ content_snapshot (เนื้อหาที่ลงนามจริง) + content_hash + ชื่อ/ตำแหน่งผู้ลงนามไว้ในแถวของมันเอง
--     และไม่มี FK ไปที่ fleet_trips (doc_id เป็น uuid ธรรมดา) การลบทริปจึงไม่แตะลายเซ็น/ภาพ/การถอนสักแถว
--     (ตารางเหล่านั้น append-only — ลบ/แก้ไม่ได้อยู่แล้ว ตามเทสต์ ESIGN_APPEND_ONLY)
--   • ก่อนลบเขียน audit_logs 'esign_trip_deleted' (ใครลบ/อปท./id ทริป/ลายเซ็นกี่แถว ใช้ได้กี่แถว ถอนกี่แถว + id ลายเซ็น)
--     ไม่ใส่ปลายทาง/วัตถุประสงค์/รหัสตรวจสอบ · เขียน audit ไม่สำเร็จ = ลบไม่ผ่านด้วย (ไม่มีทางลบโดยไม่มีร่องรอย)
--   • trigger trg_fleet_trips_audit (fleet_audit_row) เดิมบันทึกการลบแถวทริปอยู่แล้วอีกชั้น
-- ผลที่ผู้ใช้เห็น: ลายเซ็นของทริปที่ถูกลบหายไปจากรายการ "รอลงนามของฉัน" และหน้าตรวจสอบ /v/<รหัส> ขึ้น "ไม่พบ"
--   (รหัสตรวจสอบเก็บอยู่ที่แถวทริป) แต่หลักฐานลายเซ็นยังอยู่ในตาราง esign_* สำหรับตรวจย้อน
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน (docs/ai/NOTES.md ข้อ 5): ตัวนี้คือตัวเดิมของ 20261022100200 ทุกบรรทัด
--    (ตรวจกับนิยามจริงบน prod 2569-10-25 ตรงกัน) เปลี่ยนเฉพาะบล็อก DELETE ท้ายฟังก์ชัน
-- ทุกเส้นทางมี RETURN
--
-- ตรวจหลัง apply (อ่านอย่างเดียว):
--   select position('esign_trip_deleted' in pg_get_functiondef('public.esign_fleet_trip_guard'::regproc)) > 0;   → true
CREATE OR REPLACE FUNCTION public.esign_fleet_trip_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_modes jsonb;
  v_total integer;
  v_revoked integer;
  v_ids   jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- client ส่งค่าเองมาก็ไม่รับ: ทริปเป็นโหมดออนไลน์ได้ทางเดียวคือ อปท. เปิดสวิตช์ไว้ตอนสร้าง
    NEW.esign_slots := NULL;
    NEW.esign_verify_code := NULL;
    BEGIN
      -- บันทึกย้อนหลัง (completed) เป็นการจดหลังเหตุการณ์ ขออนุญาตไปแล้วบนกระดาษ ไม่เข้าระบบลงนามออนไลน์
      IF NEW.status IS DISTINCT FROM 'completed' THEN
        SELECT s.slot_modes INTO v_modes
        FROM public.esign_doc_type_settings s
        WHERE s.municipality_id = NEW.municipality_id AND s.doc_type = 'fleet_trip_request';
        IF v_modes IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_each_text(v_modes) e WHERE e.value = 'online'
        ) THEN
          NEW.esign_slots := v_modes;
          NEW.esign_verify_code := replace(gen_random_uuid()::text, '-', '');
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- ระบบลงนามเสียห้ามทำให้สร้างทริปไม่ได้ — ถือว่าเซ็นสดเหมือนก่อนมีระบบนี้
      RAISE WARNING 'esign stamp skipped (%): %', SQLSTATE, SQLERRM;
      NEW.esign_slots := NULL;
      NEW.esign_verify_code := NULL;
    END;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.esign_slots := OLD.esign_slots;
    NEW.esign_verify_code := OLD.esign_verify_code;
    IF OLD.esign_slots IS NOT NULL
       AND public.esign_fleet_trip_payload(OLD) IS DISTINCT FROM public.esign_fleet_trip_payload(NEW)
       AND EXISTS (
         SELECT 1 FROM public.esign_signatures s
         WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = OLD.id
           AND NOT EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id)
       ) THEN
      RAISE EXCEPTION 'ESIGN_TRIP_LOCKED: คำขอนี้มีลายเซ็นแล้ว แก้เนื้อหาไม่ได้ — ต้องถอนลายเซ็นก่อนแล้วเซ็นใหม่หลังแก้';
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE: ทริปที่เคยมีลายเซ็น (แม้ถอนแล้ว) — เฉพาะแอดมินของ อปท. นั้น/superadmin ลบได้ คนอื่นใช้ "ยกเลิก"
  SELECT count(*)::integer,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.esign_revocations r WHERE r.signature_id = s.id))::integer,
         COALESCE(jsonb_agg(s.id ORDER BY s.signed_at), '[]'::jsonb)
    INTO v_total, v_revoked, v_ids
  FROM public.esign_signatures s
  WHERE s.doc_type = 'fleet_trip_request' AND s.doc_id = OLD.id;

  IF v_total > 0 THEN
    IF NOT public.esign_is_tenant_admin(OLD.municipality_id) THEN
      RAISE EXCEPTION 'ESIGN_TRIP_HAS_SIGNATURES: ทริปที่เคยมีลายเซ็นลบไม่ได้ ให้ยกเลิกแทน';
    END IF;
    -- ลายเซ็น/ภาพ/การถอนไม่ถูกลบ (ไม่มี FK ไปทริป + append-only) — บันทึกไว้ว่าใครลบและทิ้งหลักฐานอะไรไว้
    PERFORM public.esign_audit(OLD.municipality_id, 'esign_trip_deleted', 'fleet_trip', OLD.id::text,
      'ทริปที่มีลายเซ็นออนไลน์',
      jsonb_build_object('signatures', v_total, 'valid', v_total - v_revoked, 'revoked', v_revoked, 'signature_ids', v_ids));
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.esign_fleet_trip_guard() FROM PUBLIC, anon, authenticated;
