-- MindNode — Source-Grounded Chat Brain MVP.
--
-- Adds a reasoning companion layer on top of the existing graph + sources:
--   * chat_conversations   — one row per conversation thread.
--   * chat_messages        — user/assistant turns, with the context used.
--   * chat_graph_suggestions — AI-proposed nodes/edges awaiting approval.
--
-- Additive only. Extends nodes.origin and edges.origin CHECK constraints
-- with 'chat_suggested' so chat-approved graph growth is traceable.

-- 1. Extend nodes.origin CHECK with 'chat_suggested'.
alter table nodes drop constraint nodes_origin_check;
alter table nodes add constraint nodes_origin_check
  check (origin in ('manual', 'memory', 'ai_pinned', 'imported',
                    'document_ai', 'document_root', 'document_section',
                    'chat_suggested'));

-- 2. Extend edges.origin CHECK with 'chat_suggested'.
alter table edges drop constraint edges_origin_check;
alter table edges add constraint edges_origin_check
  check (origin in ('manual', 'auto_keyword', 'ai_pinned', 'ai_suggested',
                    'document_ai', 'document_structure', 'chat_suggested'));

-- 3. chat_conversations
create table chat_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'New conversation',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 4. chat_messages
create table chat_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references chat_conversations(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  role              text not null
    constraint chat_messages_role_check check (role in ('user', 'assistant')),
  content           text not null,
  citations_json    jsonb not null default '[]'::jsonb,
  used_context_json jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

-- 5. chat_graph_suggestions
create table chat_graph_suggestions (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  message_id      uuid references chat_messages(id) on delete set null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  suggestion_json jsonb not null,
  status          text not null default 'pending'
    constraint chat_graph_suggestions_status_check
    check (status in ('pending', 'applied', 'dismissed')),
  created_at      timestamptz not null default now(),
  applied_at      timestamptz
);

-- 6. Indexes
create index chat_conversations_user_idx
  on chat_conversations (user_id, updated_at desc);
create index chat_messages_conversation_idx
  on chat_messages (conversation_id, created_at);
create index chat_messages_user_idx on chat_messages (user_id);
create index chat_graph_suggestions_conversation_idx
  on chat_graph_suggestions (conversation_id, created_at desc);
create index chat_graph_suggestions_user_status_idx
  on chat_graph_suggestions (user_id, status);

-- 7. updated_at trigger for chat_conversations (reuses existing helper).
create trigger chat_conversations_set_updated_at
  before update on chat_conversations
  for each row
  execute function mindnode_set_updated_at();

-- 8. RLS
alter table chat_conversations enable row level security;
alter table chat_messages enable row level security;
alter table chat_graph_suggestions enable row level security;

-- chat_conversations policies
create policy chat_conversations_select_own on chat_conversations for select using (auth.uid() = user_id);
create policy chat_conversations_insert_own on chat_conversations for insert with check (auth.uid() = user_id);
create policy chat_conversations_update_own on chat_conversations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy chat_conversations_delete_own on chat_conversations for delete using (auth.uid() = user_id);

-- chat_messages policies
create policy chat_messages_select_own on chat_messages for select using (auth.uid() = user_id);
create policy chat_messages_insert_own on chat_messages for insert with check (auth.uid() = user_id);
create policy chat_messages_update_own on chat_messages for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy chat_messages_delete_own on chat_messages for delete using (auth.uid() = user_id);

-- chat_graph_suggestions policies
create policy chat_graph_suggestions_select_own on chat_graph_suggestions for select using (auth.uid() = user_id);
create policy chat_graph_suggestions_insert_own on chat_graph_suggestions for insert with check (auth.uid() = user_id);
create policy chat_graph_suggestions_update_own on chat_graph_suggestions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy chat_graph_suggestions_delete_own on chat_graph_suggestions for delete using (auth.uid() = user_id);
