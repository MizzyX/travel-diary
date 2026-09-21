-- 旅行日记 · 云同步表结构
-- 用法：Supabase 控制台 → SQL Editor → 粘贴全部内容 → Run（只需执行一次）

-- 1. 业务记录表：所有实体（旅行/行程/日记/轨迹/账单/照片元数据）统一存这里
create table if not exists public.diary_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  store text not null,          -- trips / plans / journals / tracks / expenses / photos
  id text not null,             -- 本地生成的记录 id
  data jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0,   -- 毫秒时间戳，用于增量同步与冲突判定
  deleted boolean not null default false, -- 删除墓碑
  primary key (user_id, store, id)
);

create index if not exists diary_records_sync_idx
  on public.diary_records (user_id, updated_at);

-- 2. 行级安全：每人只能读写自己的数据
alter table public.diary_records enable row level security;

drop policy if exists "diary_records_own" on public.diary_records;
create policy "diary_records_own" on public.diary_records
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. 照片存储桶（公开读，路径 = 用户id/照片id，链接可分享但不可枚举）
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "photos_public_read" on storage.objects;
create policy "photos_public_read" on storage.objects
  for select using (bucket_id = 'photos');

drop policy if exists "photos_insert_own" on storage.objects;
create policy "photos_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "photos_update_own" on storage.objects;
create policy "photos_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "photos_delete_own" on storage.objects;
create policy "photos_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 4. 可选：注册后不需要邮箱确认（Authentication → Providers → Email → Confirm email 关掉）
--    关掉后手机/电脑注册即登录，不用去邮箱点链接。
