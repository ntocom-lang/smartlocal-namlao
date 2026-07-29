# Supabase migration history repair — 2026-07-29

## เหตุผล

Local repository ใช้ version แบบเลขสั้น (`001`–`150`) เป็นหลัก แต่ remote
`supabase_migrations.schema_migrations` เปลี่ยนไปใช้ timestamp ตั้งแต่ migration
กลุ่ม `120` เป็นต้นมา และ migration `014`–`119` จำนวนมากเคยถูก apply โดยตรงโดย
ไม่ได้บันทึก history ทำให้ `supabase db push --dry-run` ปฏิเสธการทำงาน

การ repair ครั้งนี้แก้เฉพาะ migration history metadata ตามแนวทาง Supabase CLI
และไม่รัน/ย้อนกลับ DDL รวมทั้งไม่แตะข้อมูลใน application tables

## Snapshot ก่อน repair

- Local unique versions: `150`
- Remote history rows: `33`
- Local versions ที่ remote history ไม่มี: `117`
- Remote-only timestamp versions: `21`
- มี local version ซ้ำ: `040`, `111`, `146`
- มี legacy SQL ที่ไม่มี version และถูก CLI ข้าม: `approval_portal.sql`,
  `staff_portal.sql`, `telegram_notify.sql`, `tourism_reviews.sql`

## การจับคู่ remote timestamp กับ local file

จับคู่จาก migration name และ semantic MD5 (ตัด comment, whitespace, semicolon)
ก่อนเปลี่ยนชื่อไฟล์:

| Remote version | Local logical migration |
|---|---|
| `20260719060554` | `120_users_role_filter_pagination_staff_link` |
| `20260719072303` | `121_rename_fleet_departments_to_departments` |
| `20260719072839` | `122_users_with_department_info` |
| `20260719095349` | `123_structured_address_fields` |
| `20260719095428` | `124_users_rpc_structured_address` |
| `20260721142858` | `125_events_attachment_urls_array` |
| `20260724012225` | `126_events_audiences_array` |
| `20260727084013`–`20260727120850` | logical migrations `135`–`143` |
| `20260728115101` | `145_building_permit_form_data` |
| `20260728134549` | `146_superadmin_delete_document_requests` |
| `20260729033002`–`20260729041628` | logical migrations `147`–`149` |

หมายเหตุ: migration `146_superadmin_delete_document_requests` ต่างจาก remote
เฉพาะ local เพิ่ม `DROP POLICY IF EXISTS` เพื่อให้ idempotent; คำสั่งสร้าง policy
ตรงกัน

## การแก้ local files

- เปลี่ยนชื่อไฟล์ที่จับคู่ได้ให้ใช้ remote timestamp เดิม
- แก้ version ซ้ำ:
  - `040_add_address_to_profiles` → `20260604215030_add_address_to_profiles`
  - `111_add_theme_presets` → `20260712052719_add_theme_presets`
- `146_superadmin_delete_document_requests` ใช้ remote timestamp ทำให้
  `146_public_complaint_map_pins` คง version `146` ได้โดยไม่ซ้ำ
- ย้าย legacy unversioned SQL ไป `supabase/migrations_archive/unversioned/`
  โดยไม่ลบเนื้อหา

## Remote history repair

ใช้ `supabase migration repair --linked --status applied` กับ set difference
117 versions เท่านั้น โดยมี safety check ว่าจำนวนต้องเท่ากับ `117` ก่อนรัน

รายการนี้รวม logical versions `014`–`119` (ยกเว้นเลขที่ไม่มีไฟล์), `127`–`134`,
`144`, `146`, `150`, `20260604215030` และ `20260712052719`

## ผลตรวจหลัง repair

- `supabase migration list --linked`: local และ remote ตรงกันทุก version
- `supabase db push --linked --dry-run`: `Remote database is up to date`
- ไม่มี pending migration, seed หรือ role changes

## ข้อกำหนดต่อจากนี้

1. Migration ใหม่ต้องสร้างด้วย `supabase migration new <name>` เพื่อใช้ timestamp
   14 หลัก ห้ามกลับไปใช้เลขสั้น
2. ห้าม apply SQL ตรงบน remote โดยไม่สร้าง migration file และบันทึกใน Git
3. `migration repair` แก้เฉพาะ history; ไม่ใช่คำสั่ง apply/revert schema
4. Legacy files ใน `migrations_archive` ใช้เพื่ออ้างอิงเท่านั้น ห้ามย้ายกลับเข้า
   `supabase/migrations` โดยไม่มี version และการตรวจ schema
