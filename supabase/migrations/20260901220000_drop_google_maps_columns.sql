-- ถอด Google Maps ออกจากระบบทั้งหมดแล้ว (ดู commit b5f30b2) ระบบใช้ Leaflet + OpenStreetMap
-- ล้วน ไม่มีโค้ดฝั่งไหนอ่าน 3 คอลัมน์นี้อีก จึงเก็บกวาดออกจาก schema ไม่ให้เป็น credential
-- ที่ค้างอยู่โดยไม่มีใครดูแล
--
-- ⚠️ การลบคอลัมน์ "ไม่ได้" ทำให้ API key ที่เคยเก็บไว้ถูกยกเลิกที่ฝั่ง Google — key ยังใช้งานได้อยู่
--    บน Google Cloud Console ต้องเข้าไป revoke/ลบเองอีกทาง ไม่งั้นเป็นคีย์ลอยที่ถ้าหลุดออกไป
--    จะมีคนเอาไปยิงจนเกิดค่าใช้จ่ายในบัญชีของ อปท. ได้
--
-- ตรวจก่อน apply แล้วว่าไม่มี view / matview / RLS policy / index ที่อ้างถึง 3 คอลัมน์นี้
-- เจออย่างเดียวคือ RPC get_google_cloud_settings ซึ่งจัดการในไฟล์นี้ด้วย

-- 1) ลบ RPC ที่อ่านคอลัมน์เหล่านี้ก่อน — ถ้าปล่อยไว้ function จะยัง "มีอยู่" แต่พังตอนถูกเรียก
--    (plpgsql ผูก schema ตอน runtime ไม่ใช่ตอน CREATE) กลายเป็นกับดักให้คนมาเจอทีหลัง
--    เคยถูกเรียกจาก GoogleMapsSettings.jsx อย่างเดียว ซึ่งถูกลบไปพร้อมกัน
--    ระบุ argument signature ให้ครบ กัน DROP ไปโดนตัวที่ overload ชื่อเดียวกันโดยไม่ตั้งใจ
drop function if exists public.get_google_cloud_settings(uuid);

-- 2) ลบคอลัมน์ — จงใจไม่ใส่ CASCADE เพื่อให้ migration ล้มทันทีถ้ายังมี dependency ที่ตรวจไม่เจอ
--    ดีกว่าปล่อยให้ CASCADE ไปลบ view/constraint ของระบบอื่นทิ้งเงียบๆ
--    column-level GRANT ของคอลัมน์เหล่านี้หายไปเองพร้อมคอลัมน์ ไม่ต้อง REVOKE แยก
alter table public.municipalities
  drop column if exists google_maps_api_key,
  drop column if exists google_cloud_email,
  drop column if exists google_project_id;
