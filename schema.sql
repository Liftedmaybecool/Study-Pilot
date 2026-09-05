create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text not null,
  auth_provider text not null default 'email',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  color text not null default '#438b70',
  created_at timestamptz not null default now(),
  unique(profile_id, name)
);

create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  name text not null,
  description text,
  source_text text,
  created_at timestamptz not null default now(),
  unique(subject_id, name)
);

create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  title text not null,
  exam_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists study_materials (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  title text not null,
  source_type text not null check (source_type in ('text','pdf','docx','image','slides','notion')),
  source_url text,
  extracted_text text,
  status text not null default 'queued' check (status in ('queued','processing','ready','failed')),
  created_at timestamptz not null default now()
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  title text not null,
  body text not null default '',
  notion_page_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists topic_mastery (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  mastery numeric(5,2) not null default 0 check (mastery between 0 and 100),
  confidence numeric(5,2) not null default 0 check (confidence between 0 and 100),
  attempts integer not null default 0,
  correct_attempts integer not null default 0,
  misconception text,
  last_studied_at timestamptz,
  next_review_at timestamptz,
  unique(profile_id, topic_id)
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id) on delete cascade,
  prompt text not null,
  question_type text not null check (question_type in ('multiple_choice','true_false','short_answer','fill_blank','matching')),
  difficulty integer not null default 2 check (difficulty between 1 and 5),
  answer jsonb not null,
  explanation text not null,
  created_at timestamptz not null default now()
);

create table if not exists quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  answer jsonb not null,
  is_correct boolean not null,
  response_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists flashcards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  topic_id uuid references topics(id) on delete set null,
  front text not null,
  back text not null,
  interval_days integer not null default 1,
  ease numeric(4,2) not null default 2.50,
  due_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists study_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  topic_id uuid references topics(id) on delete set null,
  activity_type text not null,
  planned_minutes integer not null,
  completed_minutes integer not null default 0,
  scheduled_for timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  topic_id uuid references topics(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists subjects_profile_idx on subjects(profile_id);
create index if not exists topics_subject_idx on topics(subject_id);
create index if not exists mastery_profile_review_idx on topic_mastery(profile_id, next_review_at);
create index if not exists flashcards_profile_due_idx on flashcards(profile_id, due_at);
create index if not exists sessions_profile_schedule_idx on study_sessions(profile_id, scheduled_for);
create index if not exists messages_conversation_created_idx on messages(conversation_id, created_at);
