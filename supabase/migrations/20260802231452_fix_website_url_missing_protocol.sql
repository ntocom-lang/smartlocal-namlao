update municipalities
set website_url = 'https://' || website_url
where website_url is not null
  and website_url !~* '^https?://';;
