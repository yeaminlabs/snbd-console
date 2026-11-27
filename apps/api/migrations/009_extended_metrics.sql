alter table heartbeats
  add column if not exists load1  real,
  add column if not exists load5  real,
  add column if not exists load15 real,
  add column if not exists swap_used  bigint,
  add column if not exists swap_total bigint,
  add column if not exists net_in  bigint,
  add column if not exists net_out bigint;
