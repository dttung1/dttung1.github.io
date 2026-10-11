-- KidTime: schema Supabase cho tính năng lõi.
-- Chạy trong Supabase → SQL Editor. Sau đó điền URL + anon key vào config.js.

create table public.devices (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  child_name  text not null,
  status      jsonb not null default '{}',   -- app đang dùng, locked, lockReason, parentLock...
  last_seen   timestamptz,
  created_at  timestamptz not null default now()
);

create table public.policies (
  device_id   uuid primary key references public.devices on delete cascade,
  data        jsonb not null,                -- limits, schedule, study, web, blockedApps
  version     int  not null default 1,
  updated_at  timestamptz not null default now()
);

create table public.usage_daily (
  device_id   uuid references public.devices on delete cascade,
  day         date not null,
  data        jsonb not null,                -- used, study, bonus, byApp (phút)
  primary key (device_id, day)
);

create table public.commands (
  id          uuid primary key,
  device_id   uuid not null references public.devices on delete cascade,
  type        text not null check (type in ('lock','unlock','add_time','study_start','study_stop')),
  payload     jsonb not null default '{}',
  status      text not null default 'sent' check (status in ('sent','done','failed')),
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);

create table public.time_requests (
  id           uuid primary key,
  device_id    uuid not null references public.devices on delete cascade,
  minutes      int  not null check (minutes between 5 and 240),
  reason       text,
  status       text not null default 'pending' check (status in ('pending','approved','denied')),
  grant_min    int,
  created_at   timestamptz not null default now(),
  responded_at timestamptz
);

create table public.alerts (
  id          uuid primary key,
  device_id   uuid not null references public.devices on delete cascade,
  type        text not null,
  text        text not null,
  created_at  timestamptz not null default now()
);

create index on public.commands (device_id, created_at desc);
create index on public.time_requests (device_id, created_at desc);
create index on public.alerts (device_id, created_at desc);

-- Row Level Security: mỗi phụ huynh chỉ thấy laptop của mình.
alter table public.devices       enable row level security;
alter table public.policies      enable row level security;
alter table public.usage_daily   enable row level security;
alter table public.commands      enable row level security;
alter table public.time_requests enable row level security;
alter table public.alerts        enable row level security;

create policy "own devices" on public.devices
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.owns_device(d uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from devices where id = d and owner_id = auth.uid())
$$;

create policy "own policies" on public.policies      for all using (owns_device(device_id)) with check (owns_device(device_id));
create policy "own usage"    on public.usage_daily   for all using (owns_device(device_id)) with check (owns_device(device_id));
create policy "own commands" on public.commands      for all using (owns_device(device_id)) with check (owns_device(device_id));
create policy "own requests" on public.time_requests for all using (owns_device(device_id)) with check (owns_device(device_id));
create policy "own alerts"   on public.alerts        for all using (owns_device(device_id)) with check (owns_device(device_id));

-- Bật Realtime cho các bảng.
alter publication supabase_realtime add table
  public.devices, public.policies, public.usage_daily, public.commands, public.time_requests, public.alerts;

-- Dọn dữ liệu cũ (tối thiểu hóa dữ liệu trẻ em): chạy định kỳ bằng pg_cron nếu muốn.
-- delete from public.usage_daily where day < current_date - 90;
-- delete from public.alerts      where created_at < now() - interval '30 days';
-- delete from public.commands    where created_at < now() - interval '7 days';
