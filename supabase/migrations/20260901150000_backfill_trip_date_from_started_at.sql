-- แก้วันที่ใช้รถย้อนหลังให้ตรงกับวันที่ออกเดินทางจริง
--
-- ก่อนหน้านี้ปุ่ม "ออกเดินทาง" (FleetTrips.submitDepart) บันทึกแต่ started_at โดยไม่ sync
-- trip_date ทริปที่เลื่อนออกเร็ว/ช้ากว่าที่จองไว้จึงถูกลงบัญชีเป็น "วันที่จอง" ทั้งที่
-- trip_date คือคอลัมน์ที่รายงานยานพาหนะ สมุดประจำรถ และหน้าภาพรวมใช้กรองทั้งหมด
-- (ถ้าคร่อมเดือน ระยะทางกับค่าน้ำมันจะไปตกเดือน/ปีงบผิด และขัดกับเวลาออกจริงที่บันทึกไว้)
--
-- แก้เฉพาะแถวที่ออกเดินทางแล้วจริง (started_at ไม่ null) และวันที่ยังไม่ตรงเท่านั้น
-- ไม่แตะคำขอที่ยังไม่ออกเดินทาง ไม่แตะรายการบันทึกย้อนหลัง (submitDirect ตั้ง trip_date ถูกอยู่แล้ว)
-- รันซ้ำได้ ครั้งที่สองจะไม่มีแถวเข้าเงื่อนไข
--
-- เวลาไทยเสมอ: started_at เป็น timestamptz ถ้า cast เป็น date ตรงๆ จะได้วันตาม UTC
-- ซึ่งเลื่อนไปวันก่อนหน้าสำหรับทริปที่ออกก่อน 07:00 น.
--
-- trigger ที่เกี่ยวข้อง: trg_fleet_trips_audit บันทึกการแก้ครั้งนี้ลง fleet_audit_log ให้เอง
-- (changed_by = NULL เพราะรันด้วย service role ไม่ใช่ผู้ใช้คนใดคนหนึ่ง)

update public.fleet_trips
   set trip_date = (started_at at time zone 'Asia/Bangkok')::date
 where started_at is not null
   and trip_date is distinct from (started_at at time zone 'Asia/Bangkok')::date;
