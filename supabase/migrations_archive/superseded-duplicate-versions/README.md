# ไฟล์ต้นฉบับที่ version ชนกับไฟล์ที่กู้จาก DB

ย้ายมาที่นี่เมื่อ 2026-08-28 ระหว่างซ่อม migration history drift

## เกิดอะไรขึ้น

การซ่อม migration history รอบ 2026-07-29 (ดู `docs/database/migration-history-repair-20260729.md`)
ได้กู้ SQL ของ migration บางตัวออกมาจากคอลัมน์ `statements` ใน
`supabase_migrations.schema_migrations` ของ production แล้วเขียนเป็นไฟล์ใหม่
ในชื่อ `<timestamp>_<name>.sql` — แต่ไม่ได้ลบไฟล์ต้นฉบับ `<timestamp>_<เลขเดิม>_<name>.sql`
ออก ทำให้แต่ละ version มีไฟล์สองตัว

ผลคือ `supabase migration list` แสดง version เหล่านี้ซ้ำสองแถว (แถวหนึ่งจับคู่กับ remote ได้
อีกแถวไม่มีคู่) และ `supabase db push` ปฏิเสธการทำงานด้วย LegacyDbPushMissingRemoteError

## ทำไมเก็บตัวที่กู้จาก DB ไว้ ไม่ใช่ต้นฉบับ

ไฟล์ที่กู้จาก DB สะท้อน **สิ่งที่รันจริงบน production** ไม่ใช่สิ่งที่ตั้งใจจะรัน
สังเกตได้จาก `;;` ซ้ำท้ายไฟล์ ซึ่งเป็นลายเซ็นของการประกอบกลับด้วย
`array_to_string(statements, ';\n')` และหลายตัวเขียนแบบ idempotent
(`drop policy if exists` ก่อน `create`) ต่างจากต้นฉบับที่เป็น `CREATE` เปล่าๆ

ไฟล์ในโฟลเดอร์นี้เก็บไว้อ้างอิงเจตนาเดิมเท่านั้น **ห้ามย้ายกลับเข้า
`supabase/migrations/`** เพราะ version จะชนกันอีก
