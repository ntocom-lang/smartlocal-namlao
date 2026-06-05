alter table municipalities
  add column if not exists latitude  numeric(10, 7),
  add column if not exists longitude numeric(10, 7);

update municipalities
set latitude = 18.259207, longitude = 100.3105803
where slug = 'namlao';
