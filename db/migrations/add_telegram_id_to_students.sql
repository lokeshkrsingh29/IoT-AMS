-- Migration: add Telegram ID to students
-- Run in Supabase SQL Editor

alter table public.students
add column if not exists telegram_id text;

-- Make existing rows safe before enforcing NOT NULL.
update public.students
set telegram_id = coalesce(nullif(trim(telegram_id), ''), concat('@', reg_number))
where telegram_id is null or trim(telegram_id) = '';

alter table public.students
alter column telegram_id set not null;

