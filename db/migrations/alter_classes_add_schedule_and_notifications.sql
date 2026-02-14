-- Migration: add class scheduling + notification fields to existing classes table
-- Run in Supabase SQL Editor

alter table public.classes
add column if not exists class_start_at timestamptz;

alter table public.classes
add column if not exists class_end_at timestamptz;

alter table public.classes
add column if not exists notification_status text default 'pending';

alter table public.classes
add column if not exists notification_scheduled_for timestamptz;

alter table public.classes
add column if not exists notification_sent_at timestamptz;

alter table public.classes
add column if not exists attendance_notification_status text default 'pending';

alter table public.classes
add column if not exists attendance_notification_sent_at timestamptz;

update public.classes
set class_start_at = coalesce(
      class_start_at,
      date_trunc('day', created_at) + class_time
    ),
    class_end_at = coalesce(
      class_end_at,
      (date_trunc('day', created_at) + class_time) + make_interval(mins => duration_minutes)
    ),
    notification_status = coalesce(notification_status, 'pending'),
    attendance_notification_status = coalesce(attendance_notification_status, 'pending')
where class_start_at is null
   or class_end_at is null
   or notification_status is null
   or attendance_notification_status is null;

alter table public.classes
alter column class_start_at set not null;

alter table public.classes
alter column class_end_at set not null;

alter table public.classes
alter column notification_status set not null;

alter table public.classes
alter column attendance_notification_status set not null;

create index if not exists classes_start_end_idx
    on public.classes (class_start_at, class_end_at);
