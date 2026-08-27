-- แก้เวลาของการเดินทางที่บันทึกไว้ก่อนแก้บั๊ก timezone (เพี้ยนไป +7 ชม.)
--
-- ที่มา: FleetTrips.jsx ส่งค่าจากช่อง <input type="datetime-local"> ดิบๆ เข้าคอลัมน์ timestamptz
-- ค่าที่ส่งไม่มี timezone ("2026-08-27T12:45") Postgres จึงตีความว่าเป็น UTC
-- เวลาที่เจ้าหน้าที่กรอก 12:45 (เวลาไทย) จึงถูกเก็บเป็น 12:45Z = 19:45 ตามเวลาไทย
-- แล้วหน้าจอก็แสดง 19:45 กลับมา — คลาดจากที่กรอก 7 ชม. เต็ม
--
-- แก้ที่โค้ดแล้วด้วย helper toISO() แต่ระเบียนที่บันทึกไว้ก่อนหน้ายังคลาดอยู่ ต้องเลื่อนกลับ
-- ประเทศไทยใช้ UTC+7 คงที่ ไม่มี DST การลบ 7 ชม. จึงตรงเสมอ ไม่ต้องแยกตามฤดู
--
-- ทำไมระบุ id เจาะจงแทนการเลื่อนตาม created_at:
--   ตอนเขียน migration นี้มีการเดินทางในระบบทั้งหมด 2 รายการ ตรวจค่าทีละแถวแล้ว
--   การไล่เลื่อนตามช่วงเวลาเสี่ยงไปโดนระเบียนที่บันทึกผ่าน RPC จองแทนที่ฉุกเฉิน
--   (fleet_override_booking แปลง timezone ถูกต้องมาตั้งแต่ต้น) ซึ่งจะกลายเป็นเพี้ยนย้อนกลับ
--
-- เงื่อนไข WHERE ผูกกับค่าเดิมที่ตรวจสอบแล้ว → รันซ้ำจะไม่มีแถวไหนเข้าเงื่อนไข (idempotent)
--
-- ⚠️ ถ้ามีเจ้าหน้าที่บันทึกการเดินทางเพิ่มหลังจากตรวจค่าแต่ก่อน deploy โค้ดใหม่ขึ้น production
--    ระเบียนนั้นจะยังเพี้ยนอยู่และไม่ถูกแก้โดย migration นี้ — ต้องตรวจซ้ำหลัง deploy ด้วย query
--    ท้ายไฟล์ แล้วแก้แยกเป็นรายกรณี

-- รถตู้บรรทุกส่วนบุคคล — ฟาร์มภูตะวัน ม.1 และ ฟาร์มสมศักดิ์ ม.5
UPDATE public.fleet_trips
   SET planned_departure = planned_departure - interval '7 hours',
       planned_return    = planned_return    - interval '7 hours',
       started_at        = started_at        - interval '7 hours',
       returned_at       = returned_at       - interval '7 hours'
 WHERE id = 'd8198523-8f2f-4a64-8813-859426e32b83'
   AND planned_departure = '2026-08-27T12:45:00+00'::timestamptz
   AND planned_return    = '2026-08-27T13:45:00+00'::timestamptz
   AND started_at        = '2026-08-27T14:20:00+00'::timestamptz
   AND returned_at       = '2026-08-27T22:30:00+00'::timestamptz;

-- รถยนต์นั่งส่วนบุคคล — อำเภอร้องกวาง
UPDATE public.fleet_trips
   SET planned_departure = planned_departure - interval '7 hours',
       planned_return    = planned_return    - interval '7 hours',
       started_at        = started_at        - interval '7 hours',
       returned_at       = returned_at       - interval '7 hours'
 WHERE id = 'b0cf0c97-2974-4144-b403-30fa88f4f322'
   AND planned_departure = '2026-08-26T21:30:00+00'::timestamptz
   AND planned_return    = '2026-08-26T22:01:00+00'::timestamptz
   AND started_at        = '2026-08-27T11:38:00+00'::timestamptz
   AND returned_at       = '2026-08-27T19:41:00+00'::timestamptz;

-- ── ตรวจซ้ำหลัง deploy ────────────────────────────────────────────────────
-- รันคำสั่งนี้ใน SQL Editor เพื่อหาระเบียนที่อาจถูกบันทึกในช่วงรอยต่อก่อน deploy
-- เวลาที่ดูสมเหตุสมผลของราชการคือช่วง 06:00–20:00 น. ตามเวลาไทย
-- แถวที่ออกเดินทาง "ตี 1 ถึง ตี 5" หรือ "สี่ทุ่มขึ้นไป" มักเป็นอาการของบั๊กนี้ ไม่ใช่ภารกิจจริง
--
--   SELECT id, destination,
--          planned_departure AT TIME ZONE 'Asia/Bangkok' AS ออกจริงตามเวลาไทย,
--          started_at        AT TIME ZONE 'Asia/Bangkok' AS เริ่มจริงตามเวลาไทย,
--          created_at
--     FROM public.fleet_trips
--    WHERE created_at > '2026-08-27T15:00:00+00'::timestamptz
--    ORDER BY created_at;
