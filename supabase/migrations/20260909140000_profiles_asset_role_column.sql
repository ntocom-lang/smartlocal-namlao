-- สิทธิ์รายโมดูลของ "ขอยืมพัสดุ/ครุภัณฑ์" — คอลัมน์แยกบน profiles ไม่ผูกกับ role หลัก
-- ลอกแม่แบบจาก profiles.fleet_role ของระบบยานพาหนะ
--
-- ทำไมต้องมีคอลัมน์แยก: role หลักบอกแค่ระดับในองค์กร (officer/staff) ไม่ได้บอกว่าใครคือ
-- "เจ้าหน้าที่พัสดุ" ของกองนั้น ถ้าผูกกับ role หลัก officer ทุกคนของทุกกองจะแก้ทะเบียนของได้
-- ทันทีโดยไม่มีใครมอบสิทธิ์ ซึ่งตรวจสอบย้อนหลังไม่ได้ว่าใครควรเป็นคนทำ
--
-- NULL = ไม่มีสิทธิ์ใช้โมดูลนี้ (ค่าเริ่มต้นของทุกคน) admin/superadmin ของ อปท. ได้สิทธิ์เต็ม
-- อยู่แล้วโดยไม่ต้องถูกตั้งค่า — ตรรกะนั้นอยู่ใน asset_is_manager() ไฟล์ถัดไป
--
-- ⚠️ ไฟล์นี้ทำแค่ ADD COLUMN + GRANT เท่านั้น ฟังก์ชันที่อ้างคอลัมน์นี้อยู่คนละไฟล์
-- (ADD COLUMN แล้วอ้างในไฟล์เดียวกันชนกับ 42703)

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS asset_role text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_asset_role_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_asset_role_check
      CHECK (asset_role IS NULL OR asset_role IN ('asset_admin', 'asset_staff', 'asset_viewer'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.asset_role IS
  'สิทธิ์โมดูลยืมพัสดุ: asset_admin = ทุกกองใน อปท., asset_staff = เฉพาะกองตัวเอง, '
  'asset_viewer = อ่านอย่างเดียว, NULL = ไม่มีสิทธิ์ ตั้งค่าได้ทาง admin_update_user() เท่านั้น';

-- GRANT ตัวนี้ซ้ำกับสิทธิ์ที่มีอยู่แล้ว — ตรวจแล้วพบว่า profiles ให้สิทธิ์ระดับ "ตาราง"
-- (authenticated มี SELECT/INSERT/UPDATE/DELETE ทั้งตาราง) ไม่ใช่ระดับคอลัมน์แบบ municipalities
-- คอลัมน์ใหม่จึงได้สิทธิ์ตามไปเองอยู่แล้ว เขียนไว้เพื่อความชัดเจนและกันกรณีมีคนถอนสิทธิ์
-- ระดับตารางออกในอนาคต
--
-- ⚠️ ผลที่ตามมา: ฝั่ง client "เขียน" คอลัมน์นี้ได้ในทางเทคนิค ตัวกันจริงคือ trigger
-- guard_profile_privileged_update() ที่ไฟล์ถัดไปเพิ่ม asset_role เข้าไปดักด้วย
-- ห้าม apply ไฟล์นี้แล้วข้ามไฟล์ถัดไป ไม่งั้นใครก็ตั้งสิทธิ์พัสดุให้ตัวเองได้
GRANT SELECT (asset_role) ON public.profiles TO authenticated, anon;

COMMIT;
