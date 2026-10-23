-- allow multiple queued jobs per server; they execute serially via onJobDone chaining
drop index jobs_one_active_per_server;
-- explicit ordering column so the panel dispatches jobs in arrival order
alter table jobs add column queued_position bigserial;
