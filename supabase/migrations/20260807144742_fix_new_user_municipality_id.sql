-- แก้บั๊ก: สมัครสมาชิกได้ แต่ municipality_id ของโปรไฟล์เป็น null ค้างถาวร ทำให้ใช้งานผิดปกติหลังจากนั้น
-- (เช่น มองไม่เห็นหมวดคำร้อง/ข้อมูลของเทศบาลตัวเอง, อัปโหลดไฟล์ผ่าน drive-upload โดน 403 ไม่พบเทศบาล)
--
-- สาเหตุ: handle_new_user() trigger (รันตอน INSERT ลง auth.users, SECURITY DEFINER ข้าม RLS ได้)
-- ไม่เคยอ่าน/ตั้งค่า municipality_id เลย ทั้งที่ AuthPage.jsx ส่ง municipality_id มาใน
-- raw_user_meta_data ตอน signUp() อยู่แล้ว — ต้องพึ่งโค้ดฝั่ง client (AuthPage.jsx บรรทัด 160,
-- App.jsx's checkAndFixProfile) มา upsert เติมทีหลัง ซึ่งต้องผ่าน RLS ("auth.uid() = id") และต้องมี
-- session พร้อมใช้งาน ณ ตอนนั้นจริงๆ — มี race condition/timing ที่ทำให้ไม่ผ่านได้ (ยืนยันจากการ
-- ทดสอบจริง: สมัครเสร็จ login สำเร็จ แต่ municipality_id ยังเป็น null ค้างอยู่แม้ผ่าน SIGNED_IN event
-- ที่ควรจะ self-heal ไปแล้วก็ตาม)
--
-- แก้ให้ตั้งค่า municipality_id ตั้งแต่ตอน trigger สร้างโปรไฟล์เลย (SECURITY DEFINER ไม่ติด RLS/
-- ไม่ต้องรอ session) — เชื่อถือได้กว่าพึ่งโค้ด client ทั้งหมด โค้ด client เดิมที่ upsert ซ้ำทีหลัง
-- ยังเก็บไว้ได้ตามเดิม (ไม่มีผลเสีย แค่กลายเป็นการอัปเดตซ้ำที่ไม่จำเป็นอีกต่อไป)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, full_name, phone, role, municipality_id)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'name'), '')
    ),
    new.raw_user_meta_data->>'phone',
    'citizen',
    nullif(new.raw_user_meta_data->>'municipality_id', '')::uuid
  )
  on conflict (id) do update set
    full_name = coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      public.profiles.full_name
    ),
    -- อย่าทับ municipality_id ที่มีอยู่แล้วของคนเดิม (กันกรณี trigger ทำงานซ้ำจาก OAuth link ภายหลัง)
    municipality_id = coalesce(public.profiles.municipality_id, nullif(new.raw_user_meta_data->>'municipality_id', '')::uuid);
  return new;
end;
$function$;
