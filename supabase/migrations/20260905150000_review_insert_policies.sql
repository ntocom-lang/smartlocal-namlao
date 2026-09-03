-- 20260905150000_review_insert_policies.sql
--
-- ปิด policy INSERT ที่ WITH CHECK (true) 2 ตารางสุดท้ายของ schema นี้ และซ่อม
-- tourism_reviews ที่ใช้งานไม่ได้มาตั้งแต่ต้น
--
-- ── satisfaction_responses ────────────────────────────────────────────────────
-- policy "anyone can insert" เป็น WITH CHECK (true) role public = anon เขียนได้
-- โดยกำหนด municipality_id และ user_id เป็นอะไรก็ได้ (ปลอมเป็น user คนอื่นได้ด้วย)
-- ตารางนี้มี 0 แถวและ **ไม่มีโค้ดไหนในระบบเขียนลงเลย** (อ้างถึงที่เดียวคือป้ายชื่อ
-- ประเภทข้อมูลในหน้า PDPA ของ AdminDashboard) การรัดจึงไม่กระทบอะไร
--
-- รัดเป็น "ต้องล็อกอิน และ user_id ต้องเป็นตัวเอง" ไม่ใช่เปิดให้ anon ต่อ —
-- ถ้าวันหนึ่งต้องการแบบประเมินที่ไม่ต้องล็อกอินจริงๆ ให้ทำเป็น RPC ที่มี rate limit
-- (แบบเดียวกับ 20260905170000) ไม่ใช่เปิด INSERT ตรงให้ anon ซึ่งกันการยิงซ้ำไม่ได้เลย
--
-- ── tourism_reviews ──────────────────────────────────────────────────────────
-- ตารางนี้มี 0 แถวทั้งที่มีสถานที่ท่องเที่ยว 5 แห่ง เพราะฟีเจอร์พังมาตลอด 3 จุด:
--   1. src/pages/TourismDetailPage.jsx ส่งคอลัมน์ reviewer_name ที่ไม่มีในตาราง
--   2. upsert(onConflict: 'place_id,user_id') ต้องมี unique constraint บนคู่นั้น ซึ่งไม่มี
--   3. มีแต่ policy INSERT/SELECT ไม่มี UPDATE → สาขา DO UPDATE ของ upsert ทำไม่ได้
--      และผู้ใช้แก้ไขรีวิวตัวเองไม่ได้ ทั้งที่ UI มีปุ่มแก้ไข
-- แก้ทั้ง 3 จุดในไฟล์นี้ (ข้อ 1 เลือกเพิ่มคอลัมน์ ไม่ใช่ตัดออกจาก payload เพราะ UI
-- แสดงชื่อผู้รีวิว 3 ที่ ถ้าตัดออกรีวิวทุกอันจะขึ้นว่า "นิรนาม")
--
-- policy ใหม่บังคับ 2 อย่างที่ WITH CHECK (true) ปล่อยผ่าน:
--   - user_id ต้องเป็น auth.uid() ของตัวเอง (เดิมปลอมเป็นคนอื่นได้)
--   - municipality_id ต้องตรงกับ อปท. เจ้าของสถานที่ (เดิมยัด อปท. ไหนก็ได้
--     ทำให้รีวิวไปโผล่ใต้ค่าเฉลี่ยดาวของ อปท. อื่น)
-- ยังไม่ใส่ rate limit เพราะ unique (place_id, user_id) จำกัดให้ 1 คน 1 รีวิวต่อสถานที่อยู่แล้ว
--
-- DELETE ให้เฉพาะแอดมินของ อปท. นั้น — TourismManager.jsx บรรทัด 60 ลบรีวิวไม่เหมาะสม

begin;

-- ── satisfaction_responses ────────────────────────────────────────────────────
drop policy if exists "anyone can insert" on public.satisfaction_responses;

create policy "own satisfaction response insert"
  on public.satisfaction_responses for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.municipalities m
      where m.id = municipality_id and m.is_active = true
    )
  );

-- ── tourism_reviews ──────────────────────────────────────────────────────────
alter table public.tourism_reviews
  add column if not exists reviewer_name text;

-- upsert(onConflict: 'place_id,user_id') ต้องมีตัวนี้ถึงจะทำงาน และเป็นตัวจำกัด
-- ไม่ให้คนเดียวรีวิวสถานที่เดิมซ้ำหลายครั้งไปในตัว
create unique index if not exists tourism_reviews_place_user_idx
  on public.tourism_reviews (place_id, user_id);

drop policy if exists "auth insert" on public.tourism_reviews;

create policy "own tourism review insert"
  on public.tourism_reviews for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.tourism_places tp
      where tp.id = place_id and tp.municipality_id = tourism_reviews.municipality_id
    )
  );

create policy "own tourism review update"
  on public.tourism_reviews for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.tourism_places tp
      where tp.id = place_id and tp.municipality_id = tourism_reviews.municipality_id
    )
  );

create policy "admin delete tourism review"
  on public.tourism_reviews for delete
  to authenticated
  using (
    get_my_role() = 'superadmin'
    or (get_my_role() = 'admin' and municipality_id = get_my_municipality_id())
  );

commit;
