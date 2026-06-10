-- MindNode — Phase E: planning workflows.
--
-- Adds progress state for plan steps and a 'plan' node origin so a staged
-- plan can live on the canvas as a reviewable, trackable branch.
-- Additive only.

-- 1. Extend nodes.origin CHECK with 'plan'.
alter table nodes drop constraint nodes_origin_check;
alter table nodes add constraint nodes_origin_check
  check (origin in ('manual', 'memory', 'ai_pinned', 'imported',
                    'document_ai', 'document_root', 'document_section',
                    'chat_suggested', 'plan'));

-- 2. plan_status: null for ordinary nodes; a tracked state for plan steps.
alter table nodes add column plan_status text
  constraint nodes_plan_status_check
  check (plan_status is null or plan_status in ('todo', 'doing', 'done'));

-- 3. Partial index for the (small) set of plan nodes.
create index nodes_plan_status_idx
  on nodes (user_id, plan_status)
  where plan_status is not null;
