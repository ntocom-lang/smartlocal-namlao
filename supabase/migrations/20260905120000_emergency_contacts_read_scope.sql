-- 20260905120000_emergency_contacts_read_scope.sql
--
-- policy อ่านสาธารณะของ emergency_contacts เป็น USING (is_active = true) ล้วนมาตั้งแต่
-- migration 018 — ไม่แตะ municipality_id เลย ผลคือ anon ที่ยิง PostgREST ตรงๆ
-- ได้เบอร์ของทุก อปท. ในคำขอเดียว รวมถึงแถวของ อปท. ที่ถูกลบไปแล้ว
--
-- ไฟล์นี้ปิดครึ่งหลัง: บังคับว่าแถวต้องสังกัด อปท. ที่ยังมีอยู่จริงและเปิดใช้งาน
-- (ครึ่งแรก — ลบ orphan + ใส่ FK — อยู่ใน 20260905100000/20260905110000)
--
-- ทำไมไม่กรองเป็นราย อปท. ไปเลย: RLS ไม่มีทางรู้ว่าผู้เยี่ยมชมที่ไม่ล็อกอินกำลังเปิดเว็บ
-- ของ อปท. ไหน ไม่มี JWT claim ให้อ่าน การกรองรายเทแนนต์ทำได้ทางเดียวคือย้ายไปเป็น
-- RPC ที่รับ _municipality_id แล้ว REVOKE SELECT ตรงจาก anon ซึ่งต้องแก้ฝั่งหน้าเว็บด้วย
-- (EmergencyGrid / EmergencyPage / DirectoryPage / geminiChat ทุกตัวส่ง municipality_id
-- มาอยู่แล้ว จึงเปลี่ยนได้ไม่ยากถ้าตัดสินใจทำ) — ยังไม่ทำในไฟล์นี้
--
-- ความเสี่ยงที่ยังเหลือหลังไฟล์นี้: คนที่ถือ anon key และเขียนคำขอเองยังดึงข้ามทุก อปท. ได้
-- แต่ละเบอร์เป็นข้อมูลที่ อปท. เจตนาเผยแพร่อยู่แล้ว ประเด็นที่เหลือคือการรวบยกชุด
-- ซึ่งสำคัญขึ้นเมื่อสมุด directory เก็บเบอร์ส่วนตัวของผู้นำท้องถิ่น (มี consent_at กำกับ)
--
-- ผลกระทบต่อผู้ใช้จริง: ตรวจแล้ว municipalities ทั้ง 5 แถวเป็น is_active = true
-- จึงไม่มีเว็บไหนเบอร์หาย  แอดมิน/superadmin อ่านของตัวเองผ่าน policy
-- "admin manage own emergency contacts" (PERMISSIVE, รวมแบบ OR) จึงไม่ถูกรัดตาม
--
-- anon มี SELECT column grant บน municipalities(id, is_active, slug) และ policy
-- "public can read active municipalities" อยู่แล้ว subquery ข้างล่างจึงมองเห็นแถว
-- ไม่ต้อง GRANT เพิ่ม (ดูบทเรียนเรื่อง column grant ใน 20260902... municipalities)

begin;

drop policy if exists "public read active emergency contacts" on public.emergency_contacts;

create policy "public read active emergency contacts"
  on public.emergency_contacts for select
  using (
    is_active = true
    and exists (
      select 1 from public.municipalities m
      where m.id = emergency_contacts.municipality_id
        and m.is_active = true
    )
  );

commit;
