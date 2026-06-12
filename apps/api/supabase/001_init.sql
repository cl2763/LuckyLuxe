begin;

create table if not exists stores (
  id text primary key,
  name text not null,
  address text,
  phone text,
  timezone text not null default 'America/Toronto',
  currency text not null default 'CAD',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists business_hours (
  store_id text not null references stores(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  open_time text not null,
  close_time text not null,
  is_closed boolean not null default false,
  primary key (store_id, weekday)
);

create table if not exists technicians (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  name text not null,
  title text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists services (
  id text primary key,
  type text not null check (type in ('NAIL', 'LASH')),
  category text not null,
  name_zh text not null,
  name_en text not null,
  description_zh text not null,
  description_en text not null,
  image_url text,
  price_cents integer not null check (price_cents >= 0),
  deposit_cents integer not null default 5000 check (deposit_cents >= 0),
  base_duration_min integer not null check (base_duration_min > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  process_json jsonb not null default '[]'::jsonb,
  notice_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists technician_services (
  technician_id text not null references technicians(id) on delete cascade,
  service_id text not null references services(id) on delete cascade,
  primary key (technician_id, service_id)
);

create table if not exists users (
  id text primary key,
  display_name text not null,
  phone text,
  email text,
  wechat_open_id text unique,
  google_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists technician_schedules (
  technician_id text not null references technicians(id) on delete cascade,
  date date not null,
  start_time text not null,
  end_time text not null,
  is_working boolean not null default true,
  primary key (technician_id, date)
);

create table if not exists bookings (
  id text primary key,
  public_code text not null unique,
  user_id text references users(id),
  store_id text not null references stores(id),
  technician_id text not null references technicians(id),
  service_id text not null references services(id),
  status text not null check (status in ('PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'AFTER_SALES')),
  appointment_start timestamptz not null,
  appointment_end timestamptz not null,
  addons_json jsonb not null default '[]'::jsonb,
  reference_images_json jsonb not null default '[]'::jsonb,
  work_images_json jsonb not null default '[]'::jsonb,
  approved_work_images_json jsonb not null default '[]'::jsonb,
  gallery_status text not null default 'draft',
  gallery_locked_at timestamptz,
  source_channel text,
  notes text,
  service_price_cents integer not null check (service_price_cents >= 0),
  deposit_cents integer not null check (deposit_cents >= 0),
  final_due_cents integer not null check (final_due_cents >= 0),
  total_duration_min integer not null check (total_duration_min > 0),
  payment_expires_at timestamptz,
  cancelled_at timestamptz,
  cancellation_fee_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists booking_slots (
  id text primary key,
  booking_id text not null references bookings(id) on delete cascade,
  technician_id text not null references technicians(id) on delete cascade,
  starts_at timestamptz not null,
  unique (technician_id, starts_at)
);

create table if not exists payments (
  id text primary key,
  booking_id text not null references bookings(id) on delete cascade,
  provider text not null check (provider in ('MOCK', 'WECHAT_PAY', 'STRIPE', 'EMT', 'OFFLINE')),
  status text not null check (status in ('REQUIRES_PAYMENT', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'CAD',
  transaction_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists booking_status_history (
  id text primary key,
  booking_id text not null references bookings(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_bookings_user_id on bookings(user_id);
create index if not exists idx_bookings_store_start on bookings(store_id, appointment_start);
create index if not exists idx_bookings_technician_start on bookings(technician_id, appointment_start);
create index if not exists idx_booking_slots_booking_id on booking_slots(booking_id);
create index if not exists idx_payments_booking_id on payments(booking_id);

alter table bookings add column if not exists reference_images_json jsonb not null default '[]'::jsonb;
alter table bookings add column if not exists work_images_json jsonb not null default '[]'::jsonb;
alter table bookings add column if not exists approved_work_images_json jsonb not null default '[]'::jsonb;
alter table bookings add column if not exists gallery_status text not null default 'draft';
alter table bookings add column if not exists gallery_locked_at timestamptz;
alter table bookings add column if not exists source_channel text;

insert into stores (id, name, address, phone, timezone, currency, is_active)
values ('store-ontario-01', 'Lucky Luxe Ontario', 'Address TBD', 'Phone TBD', 'America/Toronto', 'CAD', true)
on conflict (id) do update set
  name = excluded.name,
  address = excluded.address,
  phone = excluded.phone,
  timezone = excluded.timezone,
  currency = excluded.currency,
  is_active = excluded.is_active;

insert into business_hours (store_id, weekday, open_time, close_time, is_closed)
values
  ('store-ontario-01', 0, '10:00', '19:00', false),
  ('store-ontario-01', 1, '10:00', '19:00', true),
  ('store-ontario-01', 2, '10:00', '19:00', false),
  ('store-ontario-01', 3, '10:00', '19:00', false),
  ('store-ontario-01', 4, '10:00', '19:00', false),
  ('store-ontario-01', 5, '10:00', '19:00', false),
  ('store-ontario-01', 6, '10:00', '19:00', false)
on conflict (store_id, weekday) do update set
  open_time = excluded.open_time,
  close_time = excluded.close_time,
  is_closed = excluded.is_closed;

insert into technicians (id, store_id, name, title, is_active)
values
  ('tech-mia', 'store-ontario-01', 'Mia Chen', 'Nail Artist', true),
  ('tech-ava', 'store-ontario-01', 'Ava Lin', 'Lash Artist', true),
  ('tech-lina', 'store-ontario-01', 'Lina Zhou', 'Senior Artist', true)
on conflict (id) do update set
  store_id = excluded.store_id,
  name = excluded.name,
  title = excluded.title,
  is_active = excluded.is_active;

insert into services (
  id, type, category, name_zh, name_en, description_zh, description_en, image_url,
  price_cents, deposit_cents, base_duration_min, sort_order, is_active, process_json, notice_json
)
values
  ('nail-french-01', 'NAIL', '法式系列', '经典奶油法式', 'Classic Cream French', '柔和奶油底色搭配细线法式边，适合通勤与约会场景。', 'Soft cream base with a delicate French line for daily wear and special dates.', '/assets/images/nail-french.png', 16800, 5000, 120, 1, true, '["甲型修整","基础护理","底色上色","法式线条","封层护理"]'::jsonb, '["服务前请尽量避免自行修剪过短","如需卸甲请在预约时勾选加项"]'::jsonb),
  ('nail-luxe-01', 'NAIL', '轻奢设计', '柔金贝母设计', 'Soft Gold Shell Design', '贝母片与柔金线条组合，保留高级感，也适合日常穿搭。', 'Mother-of-pearl accents and soft gold lines for an elevated everyday style.', '/assets/images/nail-luxe.png', 23800, 5000, 150, 2, true, '["甲面护理","底色铺设","贝母定位","金线装饰","加固封层"]'::jsonb, '["复杂设计耗时较长，请预留完整服务时间"]'::jsonb),
  ('nail-jp-01', 'NAIL', '日式款', '日式微闪渐变', 'Japanese Shimmer Gradient', '细腻微闪从甲根自然过渡，温柔显白，适合短甲。', 'A subtle shimmer gradient that looks soft, clean, and flattering on short nails.', '/assets/images/nail-jp.png', 19800, 5000, 120, 3, true, '["手部清洁","甲型调整","渐变叠色","微闪点缀","封层"]'::jsonb, '["渐变色可到店根据肤色调整"]'::jsonb),
  ('nail-care-01', 'NAIL', '基础护理', '手部基础护理', 'Basic Hand Care', '修型、软化、死皮护理与营养油养护，适合定期维护。', 'Shape, soften, clean cuticles, and nourish for regular maintenance.', '/assets/images/nail-care.png', 8800, 5000, 120, 4, true, '["清洁消毒","修型","软化护理","死皮修整","营养油"]'::jsonb, '["此项目不含甲油胶上色"]'::jsonb),
  ('lash-natural-01', 'LASH', '自然款', '裸感自然睫', 'Bare Natural Lash', '轻盈自然，放大眼神但保留原生感。', 'Light, natural lashes that open the eyes while keeping a bare-skin look.', '/assets/images/lash-natural.png', 19800, 5000, 120, 1, true, '["眼型沟通","清洁隔离","睫毛嫁接","梳理定型","护理说明"]'::jsonb, '["服务后 6 小时内尽量避免接触水汽"]'::jsonb),
  ('lash-volume-01', 'LASH', '浓密款', '轻盈浓密睫', 'Soft Volume Lash', '在自然舒适的基础上增强存在感，适合拍照和重要场合。', 'Comfortable volume with stronger presence for photos and special occasions.', '/assets/images/lash-volume.png', 26800, 5000, 120, 2, true, '["眼型设计","分层嫁接","密度调整","梳理检查","护理说明"]'::jsonb, '["敏感眼型请提前备注"]'::jsonb)
on conflict (id) do update set
  type = excluded.type,
  category = excluded.category,
  name_zh = excluded.name_zh,
  name_en = excluded.name_en,
  description_zh = excluded.description_zh,
  description_en = excluded.description_en,
  image_url = excluded.image_url,
  price_cents = excluded.price_cents,
  deposit_cents = excluded.deposit_cents,
  base_duration_min = excluded.base_duration_min,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  process_json = excluded.process_json,
  notice_json = excluded.notice_json;

insert into technician_services (technician_id, service_id)
values
  ('tech-mia', 'nail-french-01'),
  ('tech-mia', 'nail-luxe-01'),
  ('tech-mia', 'nail-jp-01'),
  ('tech-mia', 'nail-care-01'),
  ('tech-lina', 'nail-french-01'),
  ('tech-lina', 'nail-luxe-01'),
  ('tech-lina', 'nail-jp-01'),
  ('tech-lina', 'nail-care-01'),
  ('tech-ava', 'lash-natural-01'),
  ('tech-ava', 'lash-volume-01'),
  ('tech-lina', 'lash-natural-01'),
  ('tech-lina', 'lash-volume-01')
on conflict (technician_id, service_id) do nothing;

insert into users (id, display_name, phone, email, wechat_open_id, google_id)
values ('user-demo', 'Lucky Member', '+1 000 000 0000', 'member@luckyluxe.demo', 'demo-wechat-openid', null)
on conflict (id) do update set
  display_name = excluded.display_name,
  phone = excluded.phone,
  email = excluded.email,
  wechat_open_id = excluded.wechat_open_id,
  google_id = excluded.google_id;

commit;
