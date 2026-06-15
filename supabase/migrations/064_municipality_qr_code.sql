-- เพิ่ม qr_code_url ให้ municipalities เพื่อให้แต่ละหน่วยงานกำหนด QR Code ของตนเองได้
alter table municipalities add column if not exists qr_code_url text;
