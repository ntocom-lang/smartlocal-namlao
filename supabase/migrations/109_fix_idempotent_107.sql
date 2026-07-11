-- 109_fix_idempotent_107.sql
-- แก้ปัญหา migration 107 ที่ CREATE POLICY โดยไม่มี DROP IF EXISTS
-- รัน migration นี้แทน 107 ถ้าเจอ error "policy already exists"

-- ══════════════════════════════════════════════════════════════
-- approval_requests
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "authenticated full access approval_requests" ON approval_requests;
DROP POLICY IF EXISTS "staff read approval_requests"               ON approval_requests;
DROP POLICY IF EXISTS "staff insert approval_requests"             ON approval_requests;
DROP POLICY IF EXISTS "admin update approval_requests"             ON approval_requests;
DROP POLICY IF EXISTS "admin delete approval_requests"             ON approval_requests;

CREATE POLICY "staff read approval_requests" ON approval_requests
  FOR SELECT USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff', 'viewer', 'council')
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "staff insert approval_requests" ON approval_requests
  FOR INSERT WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff', 'council')
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "admin update approval_requests" ON approval_requests
  FOR UPDATE
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer')
      AND municipality_id = get_my_municipality_id()
    )
    OR (
      get_my_role() IN ('staff', 'council')
      AND created_by = auth.uid()
      AND status = 'pending'
      AND municipality_id = get_my_municipality_id()
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer')
      AND municipality_id = get_my_municipality_id()
    )
    OR (
      get_my_role() IN ('staff', 'council')
      AND created_by = auth.uid()
      AND status = 'pending'
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "admin delete approval_requests" ON approval_requests
  FOR DELETE USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() = 'admin'
      AND municipality_id = get_my_municipality_id()
    )
  );

-- ══════════════════════════════════════════════════════════════
-- document_requests
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "public can select document_requests"        ON document_requests;
DROP POLICY IF EXISTS "public can insert document_requests"        ON document_requests;
DROP POLICY IF EXISTS "authenticated can update document_requests" ON document_requests;
DROP POLICY IF EXISTS "read document_requests"                     ON document_requests;
DROP POLICY IF EXISTS "staff update document_requests"             ON document_requests;

CREATE POLICY "public can insert document_requests" ON document_requests
  FOR INSERT WITH CHECK (municipality_id IS NOT NULL);

CREATE POLICY "read document_requests" ON document_requests
  FOR SELECT USING (
    (user_id IS NOT NULL AND user_id = auth.uid())
    OR get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff', 'viewer')
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "staff update document_requests" ON document_requests
  FOR UPDATE
  USING (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff')
      AND municipality_id = get_my_municipality_id()
    )
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff')
      AND municipality_id = get_my_municipality_id()
    )
  );

-- ══════════════════════════════════════════════════════════════
-- complaints — DROP policy เก่าจาก 014 ที่ไม่มี municipality filter
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "admin update complaints" ON complaints;

-- ══════════════════════════════════════════════════════════════
-- events
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "events select by audience" ON events;
DROP POLICY IF EXISTS "staff insert events"        ON events;
DROP POLICY IF EXISTS "staff update events"        ON events;
DROP POLICY IF EXISTS "staff delete events"        ON events;

CREATE POLICY "events select by audience" ON events FOR SELECT USING (
  get_my_role() = 'superadmin'
  OR audience = 'public'
  OR (
    get_my_role() IN ('admin', 'officer', 'viewer', 'council', 'staff', 'technician', 'kamnan')
    AND municipality_id = get_my_municipality_id()
    AND CASE
      WHEN get_my_role() = 'admin'      THEN true
      WHEN get_my_role() = 'officer'    THEN audience IN ('public','staff','council','management')
      WHEN get_my_role() = 'viewer'     THEN audience IN ('public','staff','management')
      WHEN get_my_role() = 'council'    THEN audience IN ('public','staff','council')
      WHEN get_my_role() = 'kamnan'     THEN audience IN ('public','staff','kamnan')
      WHEN get_my_role() = 'technician' THEN audience IN ('public','staff')
      WHEN get_my_role() = 'staff'      THEN audience IN ('public','staff')
      ELSE false
    END
  )
);

CREATE POLICY "staff insert events" ON events
  FOR INSERT WITH CHECK (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'viewer', 'council', 'officer', 'staff')
      AND municipality_id = get_my_municipality_id()
    )
  );

CREATE POLICY "staff update events" ON events FOR UPDATE
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() IN ('viewer','council','officer','staff') AND created_by = auth.uid() AND municipality_id = get_my_municipality_id())
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() IN ('viewer','council','officer','staff') AND created_by = auth.uid() AND municipality_id = get_my_municipality_id())
  );

CREATE POLICY "staff delete events" ON events FOR DELETE
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() = 'admin' AND municipality_id = get_my_municipality_id())
    OR (get_my_role() IN ('viewer','council','officer','staff') AND created_by = auth.uid() AND municipality_id = get_my_municipality_id())
  );

-- ══════════════════════════════════════════════════════════════
-- posts
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "staff read drafts"   ON posts;
DROP POLICY IF EXISTS "staff insert posts"  ON posts;
DROP POLICY IF EXISTS "staff update posts"  ON posts;
DROP POLICY IF EXISTS "staff delete posts"  ON posts;

CREATE POLICY "staff read drafts" ON posts FOR SELECT TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() IN ('admin','officer','staff','viewer','council','technician') AND municipality_id = get_my_municipality_id())
  );

CREATE POLICY "staff insert posts" ON posts FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (get_my_role() IN ('admin','officer','staff') AND municipality_id = get_my_municipality_id())
  );

CREATE POLICY "staff update posts" ON posts FOR UPDATE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() IN ('admin','officer','staff') AND municipality_id = get_my_municipality_id())
  )
  WITH CHECK (
    get_my_role() = 'superadmin'
    OR (get_my_role() IN ('admin','officer','staff') AND municipality_id = get_my_municipality_id())
  );

CREATE POLICY "staff delete posts" ON posts FOR DELETE TO authenticated
  USING (
    get_my_role() = 'superadmin'
    OR (get_my_role() IN ('admin','officer','staff') AND municipality_id = get_my_municipality_id())
  );

-- ══════════════════════════════════════════════════════════════
-- payment-slips storage
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "staff read payment slips" ON storage.objects;
CREATE POLICY "staff read payment slips"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-slips'
    AND get_my_role() IN ('superadmin','admin','officer','staff','viewer')
  );

-- ══════════════════════════════════════════════════════════════
-- complaint-attachments QR path
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "admin can upload municipality qr"          ON storage.objects;
DROP POLICY IF EXISTS "admin can update municipality qr"          ON storage.objects;
DROP POLICY IF EXISTS "allow public upload complaint attachments"  ON storage.objects;

CREATE POLICY "admin can upload municipality qr"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'complaint-attachments'
    AND name LIKE 'municipality-qr/%'
    AND get_my_role() IN ('superadmin','admin')
  );

CREATE POLICY "admin can update municipality qr"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'complaint-attachments'
    AND name LIKE 'municipality-qr/%'
    AND get_my_role() IN ('superadmin','admin')
  );

CREATE POLICY "allow public upload complaint attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'complaint-attachments'
    AND name NOT LIKE 'municipality-qr/%'
  );

-- ══════════════════════════════════════════════════════════════
-- complaint_timeline
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "timeline_select" ON complaint_timeline;

CREATE POLICY "timeline_select" ON complaint_timeline FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM complaints c
    WHERE c.id = complaint_timeline.complaint_id AND c.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM complaints c
    JOIN profiles p ON p.id = auth.uid()
    WHERE c.id = complaint_timeline.complaint_id
      AND c.municipality_id = p.municipality_id
      AND p.role IN ('superadmin','admin','officer','staff','technician','viewer','council')
  )
);

-- ══════════════════════════════════════════════════════════════
-- satisfaction_ratings
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "anyone can insert satisfaction" ON public.satisfaction_ratings;
CREATE POLICY "anyone can insert satisfaction" ON public.satisfaction_ratings
  FOR INSERT WITH CHECK (
    municipality_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.municipalities WHERE id = municipality_id)
  );

-- ══════════════════════════════════════════════════════════════
-- fleet_audit_log
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "faudit_insert" ON public.fleet_audit_log;
CREATE POLICY "faudit_insert" ON public.fleet_audit_log FOR INSERT
  WITH CHECK (
    municipality_id = (SELECT mun_id FROM public.my_fleet())
    AND (SELECT frole FROM public.my_fleet()) IN ('fleet_admin','fleet_staff')
  );
