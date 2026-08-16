-- ============================================================
--  火星档案馆 · 共享后端 Schema（Supabase 新版项目）
--  适用：使用 sb_publishable_ 格式 key 的新项目（接口表默认在 api schema）
--  在 Supabase 后台 → SQL Editor 中一次性粘贴执行即可。
--  若你的项目接口表默认在 public（老项目），把下面所有 api. 改成 public. 即可。
-- ============================================================

create schema if not exists api;

-- 1) 到场记录表
create table if not exists api.attendance (
  id uuid primary key default gen_random_uuid(),
  show_id text not null,
  device_id text not null,
  city text,
  province text,
  created_at timestamptz default now()
);
create index if not exists attendance_show_idx on api.attendance(show_id);

-- 2) 共享照片表（url 允许为空：纯文字「火星小故事」可以没有图）
create table if not exists api.photos (
  id uuid primary key default gen_random_uuid(),
  show_id text not null,
  device_id text not null,
  url text,
  story text,
  created_at timestamptz default now()
);
create index if not exists photos_show_idx on api.photos(show_id);

-- 3) 开启行级安全（RLS）
alter table api.attendance enable row level security;
alter table api.photos enable row level security;

-- 4) 公开读取：任何人都能看回忆墙
drop policy if exists "attendance public read" on api.attendance;
create policy "attendance public read" on api.attendance for select using (true);
drop policy if exists "photos public read" on api.photos;
create policy "photos public read" on api.photos for select using (true);

-- 5) 匿名可写入：粉丝无需登录即可共享
drop policy if exists "attendance anon insert" on api.attendance;
create policy "attendance anon insert" on api.attendance for insert with check (true);
drop policy if exists "photos anon insert" on api.photos;
create policy "photos anon insert" on api.photos for insert with check (true);

-- 6) 撤下用 RPC（SECURITY DEFINER，按 device_id 精确删除，匿名无法直接删他人）
create or replace function api.remove_shared(p_show text, p_device text)
returns void language plpgsql security definer as $$
begin
  delete from api.attendance where show_id = p_show and device_id = p_device;
  delete from api.photos where show_id = p_show and device_id = p_device;
end; $$;

create or replace function api.remove_photo(p_id uuid, p_device text)
returns void language plpgsql security definer as $$
begin
  delete from api.photos where id = p_id and device_id = p_device;
end; $$;

-- 7) 回忆墙聚合查询
create or replace function api.wall_stats()
returns jsonb language sql security definer as $$
  select jsonb_build_object(
    'per_show', coalesce((select jsonb_agg(row_to_json(t)) from (
      select show_id, count(*)::int as cnt from api.attendance group by show_id
    ) t), '[]'::jsonb),
    'people', (select count(distinct device_id) from api.attendance)
  );
$$;

create or replace function api.wall_photos(p_limit int default 80)
returns table(id uuid, show_id text, url text, created_at timestamptz)
language sql security definer as $$
  select id, show_id, url, created_at from api.photos order by created_at desc limit p_limit;
$$;

-- 8) 授权匿名角色：读取表、调用 RPC、上传到存储桶
grant select, insert on api.attendance to anon;
grant select, insert on api.photos to anon;
grant execute on function api.remove_shared(text,text) to anon;
grant execute on function api.remove_photo(uuid,text) to anon;
grant execute on function api.wall_stats() to anon;
grant execute on function api.wall_photos(int) to anon;

-- 9) 图片存储桶（公开读，匿名可上传）
insert into storage.buckets (id, name, public)
  values ('mars-photos','mars-photos', true)
  on conflict (id) do update set public = true;
grant insert on storage.objects to anon;
drop policy if exists "mars-photos public read" on storage.objects;
create policy "mars-photos public read" on storage.objects for select using (bucket_id = 'mars-photos');
drop policy if exists "mars-photos anon upload" on storage.objects;
create policy "mars-photos anon upload" on storage.objects for insert with check (bucket_id = 'mars-photos');

-- ============================================================
--  升级已有项目（表已存在时）：执行下面两句即可启用「火星小故事」
--  —— 让 url 允许为空（纯文字故事无图），并新增 story 文字列。
--  前端会在开启共享后自动探测 story 列是否存在并启用文字故事；
--  未执行这两句前，你写的故事只保存在本机「仅自己可见」。
-- ============================================================
alter table api.photos alter column url drop not null;
alter table api.photos add column if not exists story text;
