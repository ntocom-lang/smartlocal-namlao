// กันเลข migration ซ้ำ — supabase/migrations/<เลข>_<ชื่อ>.sql ห้ามใช้เลขนำหน้าเดียวกันสองไฟล์
//
// ทำไม: Supabase CLI ใช้เลขนำหน้าเป็น version ใน supabase_migrations.schema_migrations (primary key)
// สองไฟล์เลขเดียวกัน = ไฟล์ที่สองบันทึกประวัติไม่ได้ / db push ข้ามหรือล้ม และ session อื่นเห็นว่า "รันแล้ว" ทั้งที่ยัง
// เคสจริง: #772 ต้องเปลี่ยนเลข business_registrations_insert_read เพราะชนกับ queue_booking_holidays ที่ merge ไปก่อน
//
// รันในเครื่อง: npm run test:migration-unique · บน CI: .github/workflows/db-function-guard.yml
// ใช้แค่ node builtin ไม่ต่อฐานข้อมูล
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');

// คู่ที่ซ้ำอยู่ก่อนมีด่านนี้ (2026-11-19) — รันบนฐานจริงไปแล้ว ห้ามเปลี่ยนชื่อไฟล์
// เหตุผล: เปลี่ยนชื่อ = CLI เห็นเป็น migration ใหม่ที่ยังไม่รัน แล้วพยายามรันซ้ำ / ประวัติบนฐานไม่ตรงกับรีโป
// ผูกกับชื่อไฟล์เต็มทั้งชุด ⇒ ไฟล์ที่ 3 มาใช้เลขเดียวกัน หรือเปลี่ยนชื่อไฟล์ในคู่ = ล้ม
// ห้ามเพิ่มรายการใหม่ — เลขซ้ำใหม่ให้เปลี่ยนเลขไฟล์ที่ยังไม่รันบนฐานจริงแทน
const KNOWN_DUPLICATES = {
  '20261001120000': [
    '20261001120000_event_assignments_table.sql',
    '20261001120000_restore_keep_citizen_municipality.sql',
  ],
  '20261020150000': [
    '20261020150000_patient_booking_community_other_place.sql',
    '20261020150000_water_daily_summary_table.sql',
  ],
  '20261111100000': [
    '20261111100000_local_plan_monthly_reminder_cron.sql',
    '20261111100000_satisfaction_rated_by_proxy_column.sql',
  ],
  '20261124100000': [
    '20261124100000_fleet_permit_sk1_registry.sql',
    '20261124100000_office_photo_url.sql',
  ],
  '20261211100000': [
    '20261211100000_complaint_change_category.sql',
    '20261211100000_payment_dues_tables.sql',
  ],
};

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const errors = [];
const byVersion = new Map();

for (const f of files) {
  const m = /^(\d+)_/.exec(f);
  if (!m) {
    errors.push(`ชื่อไฟล์ไม่ขึ้นต้นด้วย "<เลข>_": ${f}`);
    continue;
  }
  if (!byVersion.has(m[1])) byVersion.set(m[1], []);
  byVersion.get(m[1]).push(f);
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

// เลขถัดไปที่ว่าง (บวกทีละ 1 ชั่วโมงจากเลข 14 หลักที่ชน) — แค่เสนอ คนเลือกเลขเองได้
function suggestFree(version) {
  if (!/^\d{14}$/.test(version)) return null;
  const y = +version.slice(0, 4), mo = +version.slice(4, 6) - 1, d = +version.slice(6, 8);
  const h = +version.slice(8, 10), mi = +version.slice(10, 12), s = +version.slice(12, 14);
  const t = new Date(Date.UTC(y, mo, d, h, mi, s));
  for (let i = 0; i < 1000; i++) {
    t.setUTCHours(t.getUTCHours() + 1);
    const v = t.toISOString().replace(/\D/g, '').slice(0, 14);
    if (!byVersion.has(v)) return v;
  }
  return null;
}

for (const [version, group] of byVersion) {
  if (group.length < 2) continue;
  const known = KNOWN_DUPLICATES[version];
  if (known && sameSet(group, known)) continue;
  const free = suggestFree(version);
  errors.push(
    `เลข migration ซ้ำ ${version}:\n` +
      group.map((g) => `    - ${g}${known?.includes(g) ? '  (รันบนฐานจริงแล้ว ห้ามเปลี่ยนชื่อ)' : ''}`).join('\n') +
      `\n    วิธีแก้: เปลี่ยนเลขของไฟล์ที่ยังไม่รันบนฐานจริง${free ? ` เช่น ${free}` : ''} (เปิด PR ไปแล้วให้ rename ในสาขาเดิม)`,
  );
}

// รายการยกเว้นต้องตรงกับไฟล์จริงเสมอ — กันรายการค้างโดยไม่มีใครรู้
for (const [version, known] of Object.entries(KNOWN_DUPLICATES)) {
  const actual = byVersion.get(version) ?? [];
  // ซ้ำ ≥2 แต่ไม่ตรงชุด รายงานไปแล้วในลูปบน — ตรงนี้จับกรณีเหลือไฟล์เดียว/ไม่มีเลย
  if (actual.length < 2) {
    errors.push(
      `รายการยกเว้น ${version} ไม่ตรงกับไฟล์จริงแล้ว (พบ: ${actual.join(', ') || 'ไม่มี'}) — ไฟล์ที่รันแล้วถูกเปลี่ยนชื่อ/ลบ? ตรวจก่อน แล้วค่อยแก้ KNOWN_DUPLICATES`,
    );
  }
}

if (errors.length) {
  console.error(`❌ ด่านเลข migration ไม่ผ่าน (${errors.length} ข้อ)\n`);
  for (const e of errors) console.error(`• ${e}\n`);
  process.exit(1);
}

console.log(
  `✅ เลข migration ไม่ซ้ำ — ${files.length} ไฟล์ (${Object.keys(KNOWN_DUPLICATES).length} คู่เก่าอยู่ในรายการยกเว้น)`,
);
