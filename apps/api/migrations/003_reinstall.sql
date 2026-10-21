-- set while an OS reinstall is in flight; cleared when the new agent connects
alter table servers add column reinstall_started_at timestamptz;
