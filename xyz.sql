-- Run this in Supabase SQL Editor (one shot)
-- Purpose: support "already trained" check from DB.

-- 1) Add training state columns to students table
alter table public.students
add column if not exists model_trained boolean not null default false;

alter table public.students
add column if not exists model_trained_at timestamptz;

-- 2) Optional: set existing students to untrained so they can train once again
update public.students
set model_trained = false,
    model_trained_at = null;

-- 3) Verify
select reg_number, name, model_trained, model_trained_at
from public.students
order by registered_date desc;
