// คอลัมน์ที่ "ผู้ไม่ล็อกอิน (anon)" อ่านได้ ของ 11 ตารางที่มี uuid ผู้ใช้ปนอยู่ — แหล่งความจริงเดียว
//
// เหตุผล: uuid ของเจ้าหน้าที่/ประชาชน (created_by, updated_by, verified_by, user_id) ไม่ควรแจกให้ผู้ที่ไม่ได้ล็อกอิน
//   เพราะเป็นวัตถุดิบของการปลอมผู้อนุมัติ/ไล่ตามตัวบุคคล · migration 20261219100000_anon_hide_user_uuid_columns.sql ถอน SELECT ทั้งตารางจาก anon แล้ว GRANT SELECT
//   รายคอลัมน์ให้เฉพาะชื่อใน ANON_COLUMN_LIST (ผู้ล็อกอิน/authenticated ยังอ่านได้ทุกคอลัมน์เหมือนเดิม)
//
// ⚠️ หน้าที่ผู้ไม่ล็อกอินเปิดได้ ห้าม select('*') หรือ select() เปล่ากับ 11 ตารางนี้ — วันที่ถอนสิทธิ์ PostgREST จะตอบ 42501
//    ทั้งคำสั่ง หน้าสาธารณะว่างทุก อปท. · ห้ามอ้างคอลัมน์ที่ซ่อน (ใน select / filter / order / embed ผ่าน FK ของคอลัมน์นั้น)
//    ถ้าต้องใช้คอลัมน์ที่ซ่อนเฉพาะตอนล็อกอิน ให้ต่อท้ายเมื่อมี session เท่านั้น
//    (ตัวอย่าง: src/pages/EventsPage.jsx, src/pages/TourismDetailPage.jsx)
//
// ⚠️ เพิ่มคอลัมน์ใหม่ในตารางเหล่านี้ = ต้องเพิ่มชื่อที่นี่ (ANON_COLUMN_LIST หรือ ANON_HIDDEN_COLUMNS) +
//    เขียน migration `GRANT SELECT (<col>) ON public.<table> TO anon` ไม่งั้นหน้าสาธารณะว่าง (42501)
//    — กับดักเดียวกับ municipalities ใน docs/ai/NOTES.md ข้อ 4 · เทสต์ `npm run test:anon-columns` ตรวจรายชื่อ
//
// รายชื่อตรวจกับฐานจริง 2026-11-19 · migration 20261219100000_anon_hide_user_uuid_columns.sql ใช้รายชื่อชุดเดียวกัน (เทสต์เทียบให้)

export const ANON_COLUMN_LIST = Object.freeze({
  data_center_entries: Object.freeze([
    'id', 'municipality_id', 'group_name', 'category', 'name', 'description', 'latitude', 'longitude', 'photo_urls',
    'external_url', 'status', 'created_at', 'updated_at', 'location', 'route_points', 'route_color', 'department_id',
    'verified_at', 'shape', 'import_batch_id',
  ]),
  events: Object.freeze([
    'id', 'municipality_id', 'title', 'description', 'event_date', 'event_time', 'end_date', 'location', 'category',
    'is_all_day', 'created_at', 'updated_at', 'attachment_url', 'end_time', 'attachment_urls', 'audiences', 'department_id',
  ]),
  infrastructure_works: Object.freeze([
    'id', 'municipality_id', 'title', 'category', 'description', 'budget', 'work_year', 'work_date', 'latitude',
    'longitude', 'location_name', 'photos', 'status', 'complaint_id', 'created_at', 'work_type', 'contractor',
    'contract_no', 'location', 'department_id',
  ]),
  org_project_updates: Object.freeze([
    'id', 'project_id', 'municipality_id', 'update_type', 'title', 'body', 'update_date', 'photos', 'created_at',
    'links', 'note',
  ]),
  org_projects: Object.freeze([
    'id', 'municipality_id', 'title', 'subtitle', 'category', 'description', 'status', 'start_date', 'end_date',
    'cover_image_url', 'is_public', 'tags', 'sort_order', 'created_at', 'updated_at', 'department_id',
  ]),
  posts: Object.freeze([
    'id', 'municipality_id', 'type', 'title', 'excerpt', 'image_url', 'event_date', 'is_published', 'created_at',
    'updated_at', 'image_position', 'department_id',
  ]),
  public_holidays: Object.freeze([
    'id', 'municipality_id', 'holiday_date', 'name', 'is_working_day', 'note', 'updated_at', 'created_at',
  ]),
  service_faqs: Object.freeze([
    'id', 'municipality_id', 'department_id', 'question', 'answer', 'keywords', 'link_url', 'link_label',
    'is_published', 'sort_order', 'created_at', 'updated_at',
  ]),
  service_forms: Object.freeze([
    'id', 'municipality_id', 'department_id', 'title', 'description', 'file_url', 'drive_file_id', 'file_name',
    'content_type', 'keywords', 'is_published', 'sort_order', 'created_at', 'updated_at',
  ]),
  tourism_places: Object.freeze([
    'id', 'municipality_id', 'name', 'category', 'image_url', 'description', 'is_active', 'display_order', 'created_at',
    'address', 'maps_url', 'gallery', 'phone', 'service_type', 'online_service', 'online_url', 'has_delivery', 'department_id',
    'latitude', 'longitude', 'opening_hours', 'hours_note', 'facebook_url', 'line_id', 'is_featured', 'village_no',
    'price_range', 'updated_at',
  ]),
  tourism_reviews: Object.freeze([
    'id', 'place_id', 'municipality_id', 'rating', 'comment', 'created_at', 'reviewer_name',
  ]),
})

// คอลัมน์ที่ซ่อนจาก anon (uuid ผู้ใช้) — ผู้ล็อกอินอ่านได้ตามเดิม
export const ANON_HIDDEN_COLUMNS = Object.freeze({
  data_center_entries: Object.freeze(['created_by', 'verified_by']),
  events: Object.freeze(['created_by']),
  infrastructure_works: Object.freeze(['created_by']),
  org_project_updates: Object.freeze(['created_by']),
  org_projects: Object.freeze(['created_by']),
  posts: Object.freeze(['created_by']),
  public_holidays: Object.freeze(['updated_by']),
  service_faqs: Object.freeze(['created_by', 'updated_by']),
  service_forms: Object.freeze(['created_by', 'updated_by']),
  tourism_places: Object.freeze(['created_by']),
  tourism_reviews: Object.freeze(['user_id']),
})

/** สตริงสำหรับ supabase.from(table).select(...) ฝั่งสาธารณะ (ผู้ไม่ล็อกอิน) — ตารางไม่รู้จัก = throw */
export function anonColumns(table) {
  const list = Object.prototype.hasOwnProperty.call(ANON_COLUMN_LIST, table) ? ANON_COLUMN_LIST[table] : null
  if (!list) throw new Error(`anonColumns: ไม่รู้จักตาราง "${table}"`)
  return list.join(', ')
}
