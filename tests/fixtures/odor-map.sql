-- Local PGlite fixture only. No credentials or connection to Supabase.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid
$$;
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.role', true), '')
$$;
CREATE FUNCTION public.get_my_municipality_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.muni', true), '')::uuid
$$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  role text, municipality_id uuid, full_name text, email text
);
CREATE TABLE public.complaint_categories (
  municipality_id uuid, value text, label text, is_adhoc boolean
);
CREATE FUNCTION public.complaint_category_is_adhoc(p_municipality_id uuid, p_category text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.complaint_categories
    WHERE municipality_id = p_municipality_id AND value = p_category AND is_adhoc)
$$;
CREATE TABLE public.complaints (
  id uuid PRIMARY KEY, municipality_id uuid, category text, subject text, status text,
  latitude double precision, longitude double precision, created_at timestamptz DEFAULT now(),
  detail text, extra_data jsonb, assigned_to uuid REFERENCES public.profiles ON DELETE SET NULL
);
CREATE TABLE public.data_center_entries (
  id uuid, municipality_id uuid, group_name text, category text, name text, status text,
  latitude double precision, longitude double precision, created_at timestamptz DEFAULT now(),
  description text, route_points jsonb, route_color text, photo_urls text[]
);
CREATE TABLE public.business_registrations (
  id uuid, municipality_id uuid, business_type text, business_name text, status text,
  latitude double precision, longitude double precision, created_at timestamptz DEFAULT now(),
  description text
);
CREATE TABLE public.infrastructure_works (
  id uuid, municipality_id uuid, category text, title text, status text,
  latitude double precision, longitude double precision, created_at timestamptz DEFAULT now(),
  description text
);
CREATE TABLE public.civil_projects (
  id uuid, municipality_id uuid, project_type text, title text, status text,
  latitude double precision, longitude double precision, created_at timestamptz DEFAULT now(),
  description text
);
