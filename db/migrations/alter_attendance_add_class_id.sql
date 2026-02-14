-- Migration: link attendance rows to classes and support per-class attendance notifications
-- Run in Supabase SQL Editor

alter table public.attendance
add column if not exists class_id bigint;

drop index if exists attendance_date_reg_number_key;

create unique index if not exists attendance_class_reg_key
    on public.attendance (class_id, reg_number);

create index if not exists attendance_class_id_idx
    on public.attendance (class_id);

alter table public.attendance
drop constraint if exists attendance_class_id_fkey;

alter table public.attendance
add constraint attendance_class_id_fkey
foreign key (class_id)
references public.classes (id)
on update cascade
on delete set null;

