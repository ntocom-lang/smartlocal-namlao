-- 20260829113107_seed_demo_tenant.sql
--
-- สร้าง อปท. ทดสอบ "demo" ให้เป็นสนามซ้อมของทั้งระบบ
--
-- ที่มา: ก่อนหน้านี้ไม่มีสนามซ้อมเลย สคริปต์ทดสอบทุกตัวชี้ไปที่ 'namlao' ซึ่งเป็น
-- เทศบาลที่มีคำร้องจริงของประชาชนอยู่ ส่วนตำหนักธรรม/ทุ่งแค้วเตรียมส่งมอบให้ อปท.
-- ทั้งสามเจ้าจึงใช้ทดสอบไม่ได้แล้ว
--
-- แนวคิด: คัดลอกเฉพาะ "ค่าตั้งค่า" (กอง/ฝ่าย, หมวดหมู่, SLA) จากน้ำเลามาเป็นต้นแบบ
-- เพื่อให้สนามซ้อมมีโครงเหมือนของจริง แต่ **ห้ามคัดลอกข้อมูลบุคคลใดๆ ทั้งสิ้น** (PDPA)
-- ไม่แตะ complaints / profiles / staff / documents / posts / audit_logs
--
-- อ้างอิง อปท. ด้วย slug ไม่ใช่ uuid เพราะ uuid generate ต่อ environment
-- รันซ้ำได้ ทุกขั้นตอนมี NOT EXISTS คุมไว้ ไม่ได้พึ่ง unique constraint ของตาราง

DO $$
DECLARE
  v_src_id  uuid;   -- น้ำเลา = ต้นแบบ (อ่านอย่างเดียว ห้ามเขียนกลับ)
  v_demo_id uuid;
  v_dept    int;
  v_cat     int;
  v_asg     int;
BEGIN
  SELECT id INTO v_src_id FROM public.municipalities WHERE slug = 'namlao';
  IF v_src_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบ อปท. ต้นแบบ slug=namlao — migration นี้ต้องมีต้นแบบให้คัดลอก';
  END IF;

  -- ── 1. แถว อปท. ทดสอบ ──────────────────────────────────────────────────────
  -- is_active ต้องเป็น true ไม่งั้น policy "public can read active municipalities"
  -- จะบล็อก แล้วหน้าเว็บขึ้น "ไม่พบรหัสหน่วยงาน"
  -- enabled_modules คัดลอกจากน้ำเลาเพื่อให้ได้ครบ 18 คีย์เท่า อปท. อื่น ไม่ต้องมาไล่ sync ทีหลัง
  -- system_name ต้องเป็น NULL ห้ามคัดลอกจากต้นแบบ — เป็นชื่อเฉพาะของหน่วยงาน ไม่ใช่ค่าตั้งค่ากลาง
  -- ของเดิมคัดลอก m.system_name มา ทำให้หน้า /auth ของสนามซ้อมขึ้น "เข้าสู่ระบบเทศบาลตำบลน้ำเลา"
  -- (เจอตอน E2E 2026-08-30) ปล่อย NULL ไว้ หน้าเว็บจะ fallback เป็น "<ชื่อ อปท.> One Data" เอง
  -- แถวที่สร้างไปแล้วแก้ด้วย 20260901140000_fix_demo_tenant_system_name.sql
  INSERT INTO public.municipalities
    (slug, name, org_type, province, theme_color, is_active, enabled_modules, system_name)
  SELECT
    'demo',
    'เทศบาลตำบลสาธิต',
    'เทศบาลตำบล',
    'แพร่',
    '#0f766e',          -- สีเขียวน้ำทะเล ต่างจากทุก อปท. จริง เห็นแล้วรู้ทันทีว่าอยู่สนามซ้อม
    true,
    m.enabled_modules,
    NULL
  FROM public.municipalities m
  WHERE m.id = v_src_id
    AND NOT EXISTS (SELECT 1 FROM public.municipalities WHERE slug = 'demo');

  SELECT id INTO v_demo_id FROM public.municipalities WHERE slug = 'demo';

  -- ── 2. กอง/ฝ่าย ────────────────────────────────────────────────────────────
  INSERT INTO public.departments (municipality_id, code, name, short_name, sort_order, is_active)
  SELECT v_demo_id, d.code, d.name, d.short_name, d.sort_order, d.is_active
  FROM public.departments d
  WHERE d.municipality_id = v_src_id
    AND NOT EXISTS (
      SELECT 1 FROM public.departments x
      WHERE x.municipality_id = v_demo_id AND x.code = d.code
    );
  GET DIAGNOSTICS v_dept = ROW_COUNT;

  -- ── 3. หมวดหมู่เรื่องร้องเรียน ──────────────────────────────────────────────
  -- หมวด 'odor' บังคับปิด (is_active = false) ให้ตรงกับ อปท. อื่นที่ไม่ได้ใช้โครงการนี้
  -- เหตุผลเต็มอยู่ใน 20260828110000_odor_adhoc_namlao_only.sql — สรุปคือหมวดเฉพาะกิจนี้มี RLS
  -- ที่ให้เห็นเฉพาะคนที่ถูก assign พอไม่มีใครถูก assign คำร้องจะหายเงียบโดยไม่มีใครเห็น
  -- สนามซ้อมยังไม่มีเจ้าหน้าที่สักคน ถ้าเปิดไว้จะเจอบั๊กเดิมทันที
  INSERT INTO public.complaint_categories
    (municipality_id, value, label, emoji, color, text_color, sort_order, is_active, is_adhoc)
  SELECT
    v_demo_id, c.value, c.label, c.emoji, c.color, c.text_color, c.sort_order,
    CASE WHEN c.value = 'odor' THEN false ELSE c.is_active END,
    c.is_adhoc
  FROM public.complaint_categories c
  WHERE c.municipality_id = v_src_id
    AND NOT EXISTS (
      SELECT 1 FROM public.complaint_categories x
      WHERE x.municipality_id = v_demo_id AND x.value = c.value
    );
  GET DIAGNOSTICS v_cat = ROW_COUNT;

  -- ── 4. ผังจ่ายงานตามหมวด ────────────────────────────────────────────────────
  -- technician_id ต้องเป็น NULL เด็ดขาด — ค่าต้นทางคือ uuid ของเจ้าหน้าที่ตัวจริงในน้ำเลา
  -- คัดลอกมาตรงๆ = ผังจ่ายงานของสนามซ้อมชี้ไปที่คนของ อปท. จริง (ผิด PDPA และงานเด้งผิดคน)
  -- ข้าม 'odor' เพราะหมวดถูกปิดไปแล้วในข้อ 3
  INSERT INTO public.category_assignments (municipality_id, category, technician_id, sla_days)
  SELECT v_demo_id, a.category, NULL, a.sla_days
  FROM public.category_assignments a
  WHERE a.municipality_id = v_src_id
    AND a.category <> 'odor'
    AND NOT EXISTS (
      SELECT 1 FROM public.category_assignments x
      WHERE x.municipality_id = v_demo_id AND x.category = a.category
    );
  GET DIAGNOSTICS v_asg = ROW_COUNT;

  -- ไม่ต้องสร้าง complaint_seq — trigger ใน 053_ref_no_sla.sql สร้างเองตอนมีคำร้องแรก
  -- ⚠️ ref_no ของสนามซ้อม "หน้าตาเหมือนของจริงทุกประการ" (ES-69-0001 / OS-69-0001)
  -- เพราะ 129_complaint_channel_ref_no.sql เลิกใช้ slug เป็น prefix แล้ว เปลี่ยนไปใช้ช่องทางแทน
  -- ห้ามใช้เลขที่คำร้องเป็นตัวแยกว่าอันไหนของทดสอบ ต้องดูที่ municipality_id เท่านั้น
  -- ไม่ต้องสร้าง public_holidays — ทั้งระบบไม่มีข้อมูลในตารางนี้ โหลดจาก src/lib/holidaysSource.js

  RAISE NOTICE 'อปท. ทดสอบ demo พร้อมใช้งาน id=% | เพิ่มกอง/ฝ่าย % | หมวดหมู่ % | ผังจ่ายงาน %',
    v_demo_id, v_dept, v_cat, v_asg;
END $$;
