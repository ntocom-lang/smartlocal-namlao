// ชั้นเรียกฐานข้อมูลของเมนู "แผนพัฒนาท้องถิ่น" (หน้าจอไม่เรียก supabase ตรงๆ)
// ตรรกะคำนวณ/สิทธิ์ฝั่งหน้าจออยู่ที่ localPlanView.js (pure) · ตัวบังคับจริงคือ RLS + trigger (migration 20261109100200)
//
// ⚠️ ทุก query กรอง municipality_id เองเสมอ (RLS กันข้าม อปท. อยู่แล้ว แต่ superadmin อ่านได้ทุก อปท. — ไม่กรองจะเห็นปนกัน)
// ⚠️ PostgREST ตัดผลลัพธ์ที่ 1,000 แถว: รายการ/วงเงินรายปี/ประวัติอาจเกิน จึงอ่านผ่าน fetchAll() ที่ไล่ทีละหน้า
// ⚠️ ประกาศ/ยกเลิกประกาศต้องผ่าน RPC เท่านั้น — UPDATE status ตรงๆ ถูก trigger ปฏิเสธ
import { supabase } from './supabase'

const PAGE = 1000

/** ไล่อ่านทีละ 1,000 แถวจนครบ · build() ต้องคืน query ใหม่ทุกครั้ง และต้องมี order ที่คงที่ (ไม่งั้นแถวซ้ำ/หายระหว่างหน้า) */
async function fetchAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE) return { data: rows, error: null }
  }
}

/**
 * ข้อความผิดพลาดภาษาไทยที่เจ้าหน้าที่อ่านรู้เรื่อง
 * trigger ของฐานข้อมูลส่งข้อความไทยมาเองอยู่แล้ว (เช่น "แผนพัฒนาที่ประกาศใช้แล้วแก้ช่อง … ไม่ได้") → แสดงตรงๆ
 */
export function friendlyError(error) {
  if (!error) return ''
  const message = String(error.message ?? '')
  const code = error.code
  const isThai = /[฀-๿]/.test(message)
  if (isThai && ['42501', '23514', '22023', '22001', '23503', 'P0002'].includes(code)) return message
  if (code === '42501' || /row-level security/i.test(message)) {
    return 'คุณไม่มีสิทธิ์แก้ข้อมูลนี้ (ต้องเป็นนักวิเคราะห์ฯ ที่ได้รับสิทธิ์จัดการแผน หรือแอดมิน)'
  }
  if (code === '23505') return 'มีข้อมูลนี้อยู่แล้ว (ซ้ำ)'
  // ฐานจริงคืน 23503 (ไม่ใช่ 23001) ตอนลบทะเบียนที่ civil_projects.registry_ref อ้างอยู่ — ตรวจบน demo 2569-11-09 → ข้อความนี้ครอบคลุมทั้งแผนดำเนินงานและงานก่อสร้าง
  if (code === '23503') return 'ลบไม่ได้เพราะมีข้อมูลอื่นอ้างถึงอยู่ (เช่น โครงการที่ถูกรายการในแผนการดำเนินงานอ้าง หรือถูกผูกกับโครงการก่อสร้างของกองช่าง — ให้กองช่างเลิกผูกก่อน)'
  // เผื่อฐานบางตัวคืน restrict_violation (23001) สำหรับ FK เดียวกัน
  if (code === '23001') return 'ลบไม่ได้เพราะโครงการนี้ถูกผูกกับงานก่อสร้างของกองช่างอยู่ — ให้กองช่างเลิกผูกก่อน'
  if (code === 'PGRST205' || code === '42P01') return 'ระบบยังไม่ได้ติดตั้งตารางของเมนูนี้ในฐานข้อมูล — แจ้งผู้ดูแลระบบ'
  if (isThai) return message
  return `เกิดข้อผิดพลาด${message ? ` (${message})` : ''}`
}

const text = value => {
  const s = String(value ?? '').trim()
  return s === '' ? null : s
}

// ── อ่านข้อมูล ─────────────────────────────────────────────────────────────

/** ผู้ใช้จัดการแผนได้ไหม (RPC เดียวกับที่ RLS ใช้) — ผิดพลาด = false ไม่ใช่ true (ปุ่มที่ซ่อนผิดดีกว่าปุ่มที่กดแล้วล้ม) */
export async function fetchIsManager(municipalityId) {
  const { data, error } = await supabase.rpc('local_plan_is_manager', { p_municipality_id: municipalityId })
  return { isManager: error ? false : data === true, error }
}

export async function fetchDevPlans(municipalityId) {
  const { data, error } = await supabase.from('local_dev_plans').select('*')
    .eq('municipality_id', municipalityId).order('year_from', { ascending: false })
  return { plans: data ?? [], error }
}

/** แผนที่เมนูแสดง (ใช้ตั้งชื่อเมนู) — อ่านเบาๆ เฉพาะช่วงปี โหลดไม่ได้ = null */
export async function fetchCurrentPlanYears(municipalityId) {
  const { data, error } = await supabase.from('local_dev_plans').select('year_from, year_to')
    .eq('municipality_id', municipalityId).eq('is_current', true).maybeSingle()
  return { plan: error ? null : data, error }
}

export async function fetchDepartments(municipalityId) {
  const { data, error } = await supabase.from('departments').select('id, name, short_name, sort_order')
    .eq('municipality_id', municipalityId).order('sort_order')
  return { departments: data ?? [], error }
}

/** ข้อมูลของแผนพัฒนา 1 ฉบับ: ทะเบียนโครงการ + วงเงินรายปี + แผนดำเนินงานทุกฉบับ + รายการแบบเบา (ไว้นับเตือน/ล็อก) */
export async function fetchPlanData(municipalityId, devPlanId) {
  const [projects, opPlans] = await Promise.all([
    fetchAll(() => supabase.from('local_dev_plan_projects').select('*')
      .eq('municipality_id', municipalityId).eq('dev_plan_id', devPlanId).order('project_code', { nullsFirst: false }).order('id')),
    supabase.from('local_op_plans').select('*').eq('municipality_id', municipalityId).eq('dev_plan_id', devPlanId)
      .order('fiscal_year').order('revision_no'),
  ])
  const failed = projects.error ?? opPlans.error
  if (failed) return { error: failed }

  const projectIds = new Set(projects.data.map(p => p.id))
  const opIds = (opPlans.data ?? []).map(p => p.id)
  const [years, items] = await Promise.all([
    // วงเงินกรองด้วย อปท. แล้วคัดเฉพาะโครงการของแผนนี้ฝั่งเรา (ไม่ส่งรายชื่อโครงการเป็นร้อยตัวไปใน URL)
    fetchAll(() => supabase.from('local_dev_plan_project_years').select('project_id, fiscal_year, amount')
      .eq('municipality_id', municipalityId).order('project_id').order('fiscal_year')),
    opIds.length
      ? fetchAll(() => supabase.from('local_op_plan_items')
        .select('id, op_plan_id, origin_item_id, dev_project_id, source, department_id, amount').eq('municipality_id', municipalityId)
        .in('op_plan_id', opIds).order('id'))
      : Promise.resolve({ data: [], error: null }),
  ])
  const error = years.error ?? items.error
  if (error) return { error }
  return {
    projects: projects.data,
    years: years.data.filter(y => projectIds.has(y.project_id)),
    opPlans: opPlans.data ?? [],
    items: items.data,
  }
}

/** รายการเต็มของแผนดำเนินงาน 1 ฉบับ (เรียง sort_order แล้ว id — การจัดเรียงแสดงผลละเอียดอยู่ sortItems) */
export async function fetchOpItems(municipalityId, opPlanId) {
  const { data, error } = await fetchAll(() => supabase.from('local_op_plan_items').select('*')
    .eq('municipality_id', municipalityId).eq('op_plan_id', opPlanId).order('sort_order').order('id'))
  return { items: data ?? [], error }
}

/** ประวัติ: ของ entity นั้นเอง (+ ลูกของมันถ้า includeChildren) ใหม่→เก่า */
export async function fetchEvents(municipalityId, entityId, { includeChildren = false, limit = 200 } = {}) {
  let query = supabase.from('local_plan_events').select('id, entity, entity_id, action, changes, reason, actor, created_at')
    .eq('municipality_id', municipalityId)
  query = includeChildren ? query.or(`entity_id.eq.${entityId},parent_id.eq.${entityId}`) : query.eq('entity_id', entityId)
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
  return { events: data ?? [], error }
}

/** ชื่อผู้ทำรายการ — อ่านไม่ได้ (RLS ของ profiles) ก็คืนว่าง ผู้เรียกใช้ "ผู้ใช้" แทน */
export async function fetchProfileNames(ids) {
  const unique = [...new Set((ids ?? []).filter(Boolean))]
  if (!unique.length) return {}
  const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', unique)
  if (error) return {}
  return Object.fromEntries((data ?? []).filter(p => p.full_name).map(p => [p.id, p.full_name]))
}

// ── แผนพัฒนา ───────────────────────────────────────────────────────────────

function devPlanColumns(form) {
  return {
    title: String(form.title ?? '').trim(),
    year_from: Number(form.year_from),
    year_to: Number(form.year_to),
    is_current: Boolean(form.is_current),
    note: text(form.note),
  }
}

/** ตั้ง/แก้แผน · แผนที่ประกาศแล้วส่งเฉพาะช่องที่ trigger ให้แก้ (หมายเหตุ/ฉบับที่เมนูแสดง) */
export async function saveDevPlan(municipalityId, form, existing = null) {
  if (!existing) {
    const { data, error } = await supabase.from('local_dev_plans')
      .insert({ ...devPlanColumns(form), municipality_id: municipalityId }).select().single()
    return { plan: data, error }
  }
  const columns = existing.status === 'published'
    ? { is_current: Boolean(form.is_current), note: text(form.note) }
    : devPlanColumns(form)
  const { data, error } = await supabase.from('local_dev_plans').update(columns).eq('id', existing.id).select().single()
  return { plan: data, error }
}

/** ประกาศใช้/ยกเลิกประกาศ — status: 'published' | 'draft' */
export async function setDevPlanStatus({ planId, status, publishedOn = null, announceRefNo = null, reason = null }) {
  const { error } = await supabase.rpc('local_dev_plan_set_status', {
    p_plan_id: planId, p_status: status, p_published_on: publishedOn, p_announce_ref_no: text(announceRefNo), p_reason: text(reason),
  })
  return { error }
}

// ── ทะเบียนโครงการ ─────────────────────────────────────────────────────────

/** เพิ่ม/แก้โครงการ (ไม่รวมวงเงินรายปี) · form ผ่านการตรวจที่คอมโพเนนต์แล้ว ที่นี่แค่แปลงช่องว่างเป็น null */
export async function saveProject(devPlanId, columns, existingId = null) {
  const row = {
    official_name: String(columns.official_name ?? '').trim(),
    project_code: text(columns.project_code),
    strategy: text(columns.strategy),
    department_id: columns.department_id || null,
    status: columns.status || 'active',
    added_in_revision: Number(columns.added_in_revision ?? 0),
    revision_ref_no: text(columns.revision_ref_no),
    note: text(columns.note),
  }
  if (!existingId) {
    const { data, error } = await supabase.from('local_dev_plan_projects').insert({ ...row, dev_plan_id: devPlanId }).select().single()
    return { project: data, error }
  }
  // dev_plan_id ไม่ส่ง (ย้ายแผนไม่ได้) · โครงการที่ล็อกแล้วฐานข้อมูลปฏิเสธช่องที่ห้ามแก้ — ส่งครบเพราะค่าที่ไม่เปลี่ยนไม่ถูกนับ
  const { data, error } = await supabase.from('local_dev_plan_projects').update(row).eq('id', existingId).select().single()
  return { project: data, error }
}

export async function deleteProject(id) {
  const { error } = await supabase.from('local_dev_plan_projects').delete().eq('id', id)
  return { error }
}

/**
 * บันทึกวงเงินรายปีเฉพาะปีที่เปลี่ยน — upserts: [{ fiscal_year, amount }] · removes: [fiscal_year]
 * (ไม่ส่งปีที่ไม่เปลี่ยน เพราะโครงการที่ล็อกแล้วฐานข้อมูลปฏิเสธการเขียนวงเงินทุกแถวแม้ค่าเท่าเดิม)
 */
export async function saveProjectYears(projectId, { upserts = [], removes = [] }) {
  if (upserts.length) {
    const { error } = await supabase.from('local_dev_plan_project_years')
      .upsert(upserts.map(y => ({ project_id: projectId, fiscal_year: y.fiscal_year, amount: y.amount })), { onConflict: 'project_id,fiscal_year' })
    if (error) return { error }
  }
  if (removes.length) {
    const { error } = await supabase.from('local_dev_plan_project_years').delete().eq('project_id', projectId).in('fiscal_year', removes)
    if (error) return { error }
  }
  return { error: null }
}

// ── แผนการดำเนินงาน ────────────────────────────────────────────────────────

/** ช่องของฉบับที่ผู้จัดการแก้ได้ (ฉบับที่ประกาศแล้วแก้ได้เฉพาะ note — ผู้เรียกส่งมาแค่นั้น) */
export async function saveOpPlan(id, columns) {
  const { data, error } = await supabase.from('local_op_plans').update(columns).eq('id', id).select().single()
  return { opPlan: data, error }
}

/**
 * สร้างแผนการดำเนินงานฉบับร่าง · copyFromId = คัดรายการจากฉบับนั้นมาด้วย (ฉบับแก้ไข)
 * ถ้าคัดรายการล้มเหลว ลบฉบับที่เพิ่งสร้างทิ้ง (ไม่ให้เหลือฉบับเปล่าที่ทำให้เลขครั้งถัดไปข้าม)
 * คัดแล้วจำต้นทาง: ฉบับ → source_op_plan_id · แต่ละแถว → origin_item_id (ต้นสาย) ให้ผลติดตามที่กองกดไว้ตามมาด้วย
 * (ฐานข้อมูลแปลง id แถวใดในสายเป็นต้นสายเอง และบังคับว่าต้นทางต้องเป็นฉบับครั้งก่อนของปีเดียวกัน — 20261110100100)
 * copyItems = รายการเต็มที่จะคัด (ถ้าส่งมาใช้แทนการอ่านจาก copyFromId) — ฉบับแก้ไขต้องคัด "ชุดรวมทั้งปี" (ฉบับหลัก + เพิ่มเติม)
 *   ไม่ใช่เฉพาะรายการในฉบับล่าสุด (ถ้าล่าสุดเป็นฉบับเพิ่มเติม มีแต่รายการใหม่ → รายการหลักจะหายจากฉบับแก้ไข) · copyFromId ยังเป็นฉบับล่าสุด
 */
export async function createOpPlan({ municipalityId, devPlanId, fiscalYear, kind = 'main', revisionNo = 0, copyFromId = null, copyItems = null }) {
  const { data: plan, error } = await supabase.from('local_op_plans')
    .insert({ municipality_id: municipalityId, dev_plan_id: devPlanId, fiscal_year: fiscalYear, kind, revision_no: revisionNo,
      source_op_plan_id: copyFromId || null })
    .select().single()
  if (error) return { opPlan: null, error }
  if (!copyFromId) return { opPlan: plan, error: null }

  const source = Array.isArray(copyItems) ? { items: copyItems, error: null } : await fetchOpItems(municipalityId, copyFromId)
  if (source.error) {
    await supabase.from('local_op_plans').delete().eq('id', plan.id)
    return { opPlan: null, error: source.error }
  }
  if (source.items.length) {
    const rows = source.items.map(i => ({
      op_plan_id: plan.id, municipality_id: municipalityId, department_id: i.department_id, dev_project_id: i.dev_project_id,
      source: i.source, external_agency: i.external_agency, seq_no: i.seq_no, sort_order: i.sort_order, item_name: i.item_name,
      amount: i.amount, month_from: i.month_from, month_to: i.month_to, note: i.note,
      origin_item_id: i.origin_item_id ?? i.id,
    }))
    for (let from = 0; from < rows.length; from += 200) {
      const { error: copyError } = await supabase.from('local_op_plan_items').insert(rows.slice(from, from + 200))
      if (copyError) {
        await supabase.from('local_op_plans').delete().eq('id', plan.id)
        return { opPlan: null, error: copyError }
      }
    }
  }
  return { opPlan: plan, error: null }
}

export async function setOpPlanStatus({ opPlanId, status, publishedOn = null, announceRefNo = null, reason = null }) {
  const { error } = await supabase.rpc('local_op_plan_set_status', {
    p_op_plan_id: opPlanId, p_status: status, p_published_on: publishedOn, p_announce_ref_no: text(announceRefNo), p_reason: text(reason),
  })
  return { error }
}

// ── รายการในแผนการดำเนินงาน ────────────────────────────────────────────────

/** เพิ่มรายการ (ผู้จัดการเท่านั้น) */
export async function createOpItem(opPlanId, municipalityId, columns) {
  const { data, error } = await supabase.from('local_op_plan_items')
    .insert({ ...columns, op_plan_id: opPlanId, municipality_id: municipalityId }).select().single()
  return { item: data, error }
}

/**
 * นำเข้ารายการหลายแถวจากพรีวิว (ผู้จัดการเท่านั้น · ฉบับร่างเท่านั้น — RLS/trigger บังคับ)
 * rows = values ของพรีวิว { seq_no, item_name, amount, department_id, month_from, month_to, note, dev_project_id }
 * sort_order = startSortOrder + ลำดับในไฟล์ (ผู้เรียกส่ง max ของรายการเดิม + ช่วงห่าง) · source = 'local' เสมอ
 * insert ทีละ 200 แถว · ชุดไหนล้ม → ลบรายการที่เพิ่ม insert สำเร็จไปแล้วทั้งหมด (ไม่ให้เหลือครึ่งๆ กลางๆ) แล้วคืน error
 * คืน { count, error } · ลบย้อนไม่สำเร็จด้วย → เพิ่ม leftover = จำนวนรายการที่ยังค้างในฉบับ (ผู้เรียกต้องบอกให้เจ้าหน้าที่ตรวจเอง)
 */
export async function importOpItems({ opPlanId, municipalityId, rows, startSortOrder = 0 }) {
  const payload = (rows ?? []).map((r, i) => ({
    op_plan_id: opPlanId,
    municipality_id: municipalityId,
    source: 'local',
    department_id: r.department_id ?? null,
    dev_project_id: r.dev_project_id ?? null,
    seq_no: r.seq_no ?? null,
    sort_order: Number(startSortOrder) + i,
    item_name: r.item_name,
    amount: r.amount ?? null,
    month_from: r.month_from ?? null,
    month_to: r.month_to ?? null,
    note: r.note ?? null,
  }))
  const inserted = []
  for (let from = 0; from < payload.length; from += 200) {
    const { data, error } = await supabase.from('local_op_plan_items').insert(payload.slice(from, from + 200)).select('id')
    if (error) {
      // ลบทีละ 100 id — id ละ ~39 ตัวอักษรใน URL ส่งทีเดียวหลักพัน id เกินความยาว URL ที่เซิร์ฟเวอร์รับ
      let leftover = 0
      for (let at = 0; at < inserted.length; at += 100) {
        const ids = inserted.slice(at, at + 100)
        const { error: rollbackError } = await supabase.from('local_op_plan_items').delete().in('id', ids)
        if (rollbackError) leftover += ids.length
      }
      return leftover ? { count: 0, error, leftover } : { count: 0, error }
    }
    inserted.push(...(data ?? []).map(r => r.id))
  }
  return { count: inserted.length, error: null }
}

/** แก้รายการ — คนที่แก้ได้แค่เดือน/หมายเหตุ ผู้เรียกต้องส่งเฉพาะ { month_from, month_to, note } */
export async function updateOpItem(id, columns) {
  const { data, error } = await supabase.from('local_op_plan_items').update(columns).eq('id', id).select().single()
  return { item: data, error }
}

export async function deleteOpItem(id) {
  const { error } = await supabase.from('local_op_plan_items').delete().eq('id', id)
  return { error }
}

/** เขียน sort_order หลายแถว [{ id, sort_order }] — ลำดับแสดงผลไม่ลงประวัติ */
export async function saveItemOrder(changes) {
  const results = await Promise.all(changes.map(c => supabase.from('local_op_plan_items').update({ sort_order: c.sort_order }).eq('id', c.id)))
  return { error: results.find(r => r.error)?.error ?? null }
}

// ── ติดตามผล (แท็บ "ติดตามผล") ─────────────────────────────────────────────

/** ผลดำเนินการรายสายของปีงบ (1 แถวต่อ 1 สาย) · ไม่มีแถว = ยังไม่ได้ดำเนินการ */
export async function fetchProgress(municipalityId, fiscalYear) {
  const { data, error } = await fetchAll(() => supabase.from('local_op_item_progress').select('*')
    .eq('municipality_id', municipalityId).eq('fiscal_year', fiscalYear).order('lineage_id'))
  return { progress: data ?? [], error }
}

/**
 * บันทึกผลของสาย (upsert) — lineageItemId = id แถวใดก็ได้ในสาย (ฐานข้อมูลแปลงเป็นต้นสายเอง · ผู้เรียกควรส่งต้นสายตรงๆ)
 * ส่งครบ 5 ช่องเสมอ (ช่องที่ว่างส่ง null เพื่อล้างค่าเดิม) · อปท./ปีงบ/กอง ฐานข้อมูลคัดเองจากรายการ ไม่ต้องส่ง
 * columns: { status, started_on, done_on, reason, note }
 */
export async function saveProgress(lineageItemId, columns) {
  const row = {
    lineage_id: lineageItemId,
    status: columns.status,
    started_on: text(columns.started_on),
    done_on: text(columns.done_on),
    reason: text(columns.reason),
    note: text(columns.note),
  }
  const { data, error } = await supabase.from('local_op_item_progress').upsert(row, { onConflict: 'lineage_id' }).select().single()
  return { progress: data, error }
}

/** ลบผล = กลับเป็น "ยังไม่ดำเนินการ" · RLS ปฏิเสธแล้วไม่มีแถวถูกลบ (ไม่ error) จึงนับแถวที่ลบจริง */
export async function deleteProgress(lineageId) {
  const { data, error } = await supabase.from('local_op_item_progress').delete().eq('lineage_id', lineageId).select('lineage_id')
  if (error) return { error }
  if (!data?.length) return { error: { code: '42501', message: 'ลบผลไม่ได้ — ไม่มีสิทธิ์ หรือมีผู้อื่นลบไปแล้ว' } }
  return { error: null }
}

/** ข้อมูลรายงานติดตามและประเมินผลของปีงบ (มีได้ 1 แถวต่อปี) — ยังไม่มี = null */
export async function fetchEvaluation(municipalityId, fiscalYear) {
  const { data, error } = await supabase.from('local_plan_evaluations').select('*')
    .eq('municipality_id', municipalityId).eq('fiscal_year', fiscalYear).maybeSingle()
  return { evaluation: error ? null : data, error }
}

/**
 * บันทึกข้อมูลรายงานประจำปี (ผู้จัดการเท่านั้น — RLS) · existingId มี = แก้ · ไม่มี = เพิ่ม (UNIQUE อปท.+ปีงบ)
 * columns: disbursed_total, disbursed_as_of, disbursed_source, committee_met_on, reported_to_exec_on, presented_on, announced_on,
 *          announce_ref_no, observations, recommendations, note — ผู้เรียกตรวจแล้ว ที่นี่แปลงช่องว่างเป็น null
 */
export async function saveEvaluation(municipalityId, fiscalYear, columns, existingId = null) {
  const row = {
    disbursed_total: columns.disbursed_total === '' || columns.disbursed_total === undefined ? null : columns.disbursed_total,
    disbursed_as_of: text(columns.disbursed_as_of),
    disbursed_source: text(columns.disbursed_source),
    committee_met_on: text(columns.committee_met_on),
    reported_to_exec_on: text(columns.reported_to_exec_on),
    presented_on: text(columns.presented_on),
    announced_on: text(columns.announced_on),
    announce_ref_no: text(columns.announce_ref_no),
    observations: text(columns.observations),
    recommendations: text(columns.recommendations),
    note: text(columns.note),
  }
  if (!existingId) {
    const { data, error } = await supabase.from('local_plan_evaluations')
      .insert({ ...row, municipality_id: municipalityId, fiscal_year: fiscalYear }).select().single()
    return { evaluation: data, error }
  }
  const { data, error } = await supabase.from('local_plan_evaluations').update(row).eq('id', existingId).select().single()
  return { evaluation: data, error }
}

/**
 * ขั้นของโครงการก่อสร้างที่ผูกทะเบียนโครงการ (RPC — ไม่คืน id โครงการก่อสร้าง) · fiscalYear ว่าง = ทุกปี
 * ⚠️ RPC กรองปีด้วยข้อความตรงตัว (btrim(fiscal_year) = '2570') — ผู้เรียกที่ต้องการ "ผูกไว้ทุกปี" ให้เรียกแบบไม่ส่งปี แล้วคัดปีเอง
 */
export async function fetchCivilStages(municipalityId, fiscalYear = null) {
  const { data, error } = await supabase.rpc('local_plan_civil_stages', { p_municipality_id: municipalityId, p_fiscal_year: fiscalYear })
  return { rows: error ? [] : (data ?? []), error }
}

/**
 * ทะเบียนโครงการของแผนพัฒนาฉบับที่เมนูแสดง (is_current) ของ อปท. นี้ — ไว้ให้โมดูลก่อสร้างเลือกผูก
 * อ่านเบาๆ เฉพาะช่องที่ใช้ · ไม่มีแผน/อ่านไม่ได้ (RLS) = projects ว่าง + error ผู้เรียกซ่อนช่องเงียบๆ
 * ⚠️ กรอง municipality_id เองเสมอ (superadmin อ่านได้ทุก อปท. — ไม่กรองจะเห็นปนกัน)
 */
export async function fetchRegistryForLinking(municipalityId) {
  const { data: plan, error: planError } = await supabase.from('local_dev_plans').select('id')
    .eq('municipality_id', municipalityId).eq('is_current', true).maybeSingle()
  if (planError || !plan) return { projects: [], years: [], error: planError ?? null }
  const projects = await fetchAll(() => supabase.from('local_dev_plan_projects')
    .select('id, project_code, official_name, status, strategy, department_id')
    .eq('municipality_id', municipalityId).eq('dev_plan_id', plan.id).order('project_code', { nullsFirst: false }).order('id'))
  if (projects.error) return { projects: [], years: [], error: projects.error }
  const ids = new Set(projects.data.map(p => p.id))
  const years = await fetchAll(() => supabase.from('local_dev_plan_project_years').select('project_id, fiscal_year, amount')
    .eq('municipality_id', municipalityId).order('project_id').order('fiscal_year'))
  if (years.error) return { projects: projects.data, years: [], error: null }   // วงเงินอ่านไม่ได้ = ยังเดาคู่ได้ด้วยชื่ออย่างเดียว
  return { projects: projects.data, years: years.data.filter(y => ids.has(y.project_id)), error: null }
}
