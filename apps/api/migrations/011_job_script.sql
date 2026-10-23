-- Store the script so queue re-dispatch uses the original (preserves compose app user params)
alter table jobs add column if not exists script text not null default '';
