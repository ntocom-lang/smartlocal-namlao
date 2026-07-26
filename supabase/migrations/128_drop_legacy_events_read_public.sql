-- SmartLocal 128: ปิดช่องโหว่ policy เก่าที่ตกค้างอยู่ — "events_read_public" (qual: true)
-- อนุญาตให้ใครก็ได้ (รวม anon ที่ไม่ได้ login) อ่าน event ทุกแถวแบบไม่มีเงื่อนไขเลย
-- ซ้อนทับกับ policy "events select by audience" ที่ตั้งใจจำกัดสิทธิ์ไว้ (RLS ใช้กฎ OR ระหว่าง
-- policy ที่เป็น permissive ด้วยกัน — มี policy ไหนอนุญาตก็อนุญาตเลย ต่อให้ policy อื่นเข้มงวดแค่ไหน)
-- เป็นรูรั่วที่มีมาตั้งแต่ก่อนจะมีระบบ audience เลย ทำให้ event ทุก audience หลุดถึง anon ได้ตรงๆ

drop policy if exists "events_read_public" on events;
