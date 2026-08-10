# FindAJob.qa — Supabase Database Documentation

## Setup Instructions

1. Go to [https://supabase.com](https://supabase.com) and create a free account
2. Create a new project
3. Copy your **Project URL** and **anon/service-role key** from Settings → API
4. Set the environment variables in your server:
   ```
   SUPABASE_URL=https://xxxxxxxxxxxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ADMIN_PASSWORD=3462Abel
   ```
5. Open the **SQL Editor** in Supabase and run the SQL below to create all tables

---

## Full Database Schema (SQL)

Run this entire block in the Supabase SQL Editor:

```sql
-- ═══════════════════════════════════════════════════════════════
-- TABLE: applications
-- Stores all job applications submitted by users
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS applications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number      TEXT UNIQUE NOT NULL,

  -- Step 1: Personal Information
  full_name            TEXT NOT NULL,
  gender               TEXT,
  dob                  DATE,
  nationality          TEXT,
  marital_status       TEXT,
  religion             TEXT,
  country_of_residence TEXT,
  current_address      TEXT,
  phone                TEXT NOT NULL,
  email                TEXT,

  -- Step 2: Passport & Visa
  passport_number      TEXT,
  passport_expiry      DATE,
  has_passport         TEXT,
  worked_qatar         TEXT,
  denied_visa          TEXT,
  has_qatar_visa       TEXT,

  -- Step 3: Job Preferences
  job_title            TEXT,
  job_location         TEXT,
  industry             TEXT[] DEFAULT '{}',
  expected_salary      TEXT,
  start_date           DATE,
  experience           TEXT,

  -- Step 4: Education & Work
  education            TEXT,
  school_name          TEXT,
  graduation_year      INTEGER,
  field_of_study       TEXT,
  current_employer     TEXT,
  current_job_title    TEXT,
  employment_period    TEXT,
  current_country      TEXT,
  previous_employers   TEXT,
  responsibilities     TEXT,

  -- Step 5: Skills
  languages            TEXT,
  english_level        TEXT,
  driving_licence      TEXT,
  driving_years        TEXT,
  computer_skills      TEXT,
  professional_certs   TEXT,
  trade_skills         TEXT,
  additional_message   TEXT,

  -- Step 7: Emergency Contact
  emergency_name         TEXT,
  emergency_relationship TEXT,
  emergency_phone        TEXT,
  emergency_country      TEXT,
  emergency_address      TEXT,

  -- Status & Admin
  status        TEXT NOT NULL DEFAULT 'submitted',
  -- Possible values:
  --   submitted | documents_review | employer_review
  --   interview_scheduled | job_offer | visa_processing
  --   visa_approved | flight_prep | arrived | employed | rejected

  status_step   INTEGER DEFAULT 1,
  -- Maps to timeline step (1–10)

  admin_notes   TEXT,
  agent_id      UUID,

  submitted_at  TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Index for fast email lookup (email is unique per application)
CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(email);
CREATE INDEX IF NOT EXISTS idx_applications_tracking ON applications(tracking_number);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);


-- ═══════════════════════════════════════════════════════════════
-- TABLE: status_history
-- Full audit trail of every status change per application
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS status_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  status           TEXT NOT NULL,
  note             TEXT,
  changed_by       TEXT DEFAULT 'System',
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_history_application ON status_history(application_id);


-- ═══════════════════════════════════════════════════════════════
-- TABLE: agents
-- Qatar-based agents who can represent applicants and process applications
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  email               TEXT UNIQUE NOT NULL,
  phone               TEXT,
  whatsapp            TEXT,
  nationality         TEXT,

  -- Agent location (where they are based)
  location_city       TEXT,
  location_area       TEXT,
  area_in_qatar       TEXT,   -- Which area in Qatar they cover

  spoken_languages    TEXT,
  experience_years    TEXT,
  current_occupation  TEXT,
  why_agent           TEXT,

  admin_note          TEXT,

  -- Status workflow: pending → approved → active | rejected
  status              TEXT NOT NULL DEFAULT 'pending',

  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_email ON agents(email);

ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_agent_id_fkey;
ALTER TABLE applications
  ADD CONSTRAINT applications_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;


-- ═══════════════════════════════════════════════════════════════
-- TABLE: jobs
-- Job listings posted by employers
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS jobs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Employer/Contact info
  company_name         TEXT NOT NULL,
  contact_name         TEXT,
  contact_email        TEXT,
  contact_phone        TEXT,

  -- Job details
  job_title            TEXT NOT NULL,
  category             TEXT,
  location             TEXT,
  salary_min           NUMERIC,
  salary_max           NUMERIC,
  contract_type        TEXT,
  description          TEXT,
  requirements         TEXT,
  experience_required  TEXT,
  positions_available  INTEGER DEFAULT 1,

  -- Benefits
  accommodation        BOOLEAN DEFAULT false,
  transport            BOOLEAN DEFAULT false,
  medical              BOOLEAN DEFAULT false,
  benefits              TEXT,
  visa_sponsor          BOOLEAN DEFAULT true,

  active               BOOLEAN DEFAULT false,   -- Admin must approve

  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(active);
CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category);

-- ═══════════════════════════════════════════════════════════════
-- EMPLOYER WORKFLOW TABLES AND APPLICATION RELATIONSHIPS
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE applications ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS employer_email TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS employer_company TEXT;
CREATE INDEX IF NOT EXISTS idx_applications_employer_email ON applications(employer_email);
CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications(job_id);

CREATE TABLE IF NOT EXISTS employer_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  company_name  TEXT NOT NULL,
  phone         TEXT,
  job_title     TEXT,
  location      TEXT,
  website       TEXT,
  about         TEXT,
  photo_path    TEXT,
  photo_url     TEXT,
  online        BOOLEAN DEFAULT false,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employer_profiles_email ON employer_profiles(email);
ALTER TABLE employer_profiles ADD COLUMN IF NOT EXISTS online BOOLEAN DEFAULT false;
ALTER TABLE employer_profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE employer_profiles ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE employer_profiles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS idx_employer_profiles_status ON employer_profiles(status);

CREATE TABLE IF NOT EXISTS application_comments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  employer_email  TEXT NOT NULL,
  employer_name   TEXT,
  comment         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_comments_application ON application_comments(application_id);

CREATE TABLE IF NOT EXISTS application_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  document_type   TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  storage_path    TEXT NOT NULL,
  bucket          TEXT NOT NULL DEFAULT 'application-documents',
  file_url        TEXT,
  content_type    TEXT,
  file_size       INTEGER,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_application_documents_application ON application_documents(application_id);

-- ═══════════════════════════════════════════════════════════════
-- CHAT: encrypted messages, private attachments, and presence
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id     UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  sender_role        TEXT NOT NULL CHECK (sender_role IN ('applicant','employer','admin','system')),
  sender_name        TEXT NOT NULL,
  sender_email       TEXT,
  body               TEXT,
  body_ciphertext    TEXT,
  encryption_iv      TEXT,
  is_encrypted       BOOLEAN DEFAULT true,
  message_type       TEXT NOT NULL DEFAULT 'text',
  faq_key            TEXT,
  link_url           TEXT,
  link_title         TEXT,
  link_description   TEXT,
  attachment_path    TEXT,
  attachment_bucket  TEXT,
  attachment_name    TEXT,
  attachment_type    TEXT,
  attachment_size    INTEGER,
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_application ON chat_messages(application_id, created_at);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS faq_key TEXT;

-- ═══════════════════════════════════════════════════════════════
-- CHAT FAQ / BOT QUESTIONS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_faqs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faq_key     TEXT UNIQUE NOT NULL,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  featured    BOOLEAN NOT NULL DEFAULT false,
  active      BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_faqs_visibility ON chat_faqs(active, featured, sort_order);

INSERT INTO chat_faqs (faq_key, question, answer, featured, sort_order)
VALUES
  ('track', 'Track my job application', 'Please enter your reference number above to see the latest application and visa progress. Your recruiter will update each step here.', true, 1),
  ('agent', 'Talk to an agent', 'Please share your name and email address and a FindAJob.qa agent will contact you.', true, 2),
  ('documents', 'Which documents do I need?', 'Your passport copy, passport photo, and CV are required first. Your recruiter may request certificates, police clearance, or medical documents later.', true, 3),
  ('employer', 'Who is reviewing my application?', 'Your application is reviewed by the employer connected to the job you selected and the FindAJob.qa recruitment team.', false, 4),
  ('timeline', 'What do the progress steps mean?', 'Each step shows where your application is in the review, interview, offer, visa, and arrival process.', false, 5),
  ('interview', 'When will my interview be?', 'The employer will send an interview update in this chat once your application has been selected.', false, 6),
  ('visa', 'How does the Qatar work visa work?', 'The employer sponsors the work visa and will request any additional documents needed for processing. Never pay for a job or visa.', false, 7),
  ('fees', 'Do I need to pay a recruitment fee?', 'No. Never send money to anyone promising a job or visa. Report suspicious requests to FindAJob.qa.', false, 8),
  ('contact', 'How quickly will someone reply?', 'A recruiter usually replies within 24 hours during working days.', false, 9)
ON CONFLICT (faq_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS chat_presence (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  participant_key   TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('applicant','employer','admin')),
  display_name      TEXT,
  online            BOOLEAN DEFAULT false,
  typing            BOOLEAN DEFAULT false,
  last_seen_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(application_id, participant_key)
);
CREATE INDEX IF NOT EXISTS idx_chat_presence_application ON chat_presence(application_id);

CREATE TABLE IF NOT EXISTS contact_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  category    TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_alert_subscribers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Create these buckets in Storage before using uploads:
--   application-documents (private; server creates one-hour signed URLs)
--   employer-photos (public; applicant dashboards display profile photos)


-- RLS is intentionally disabled for this deployment. All access goes
-- through server.js, which validates tracking references/employer email.
-- Note: chat text is encrypted in the browser using a key derived from the
-- tracking reference. This protects stored message content from casual
-- database exposure, but it is not a full public-key E2EE system because
-- the reference is also the applicant's access credential.
ALTER TABLE applications DISABLE ROW LEVEL SECURITY;
ALTER TABLE status_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE agents DISABLE ROW LEVEL SECURITY;
ALTER TABLE jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE employer_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE application_comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE application_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_presence DISABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE job_alert_subscribers DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_faqs DISABLE ROW LEVEL SECURITY;
```

---

## Table Relationships

```
applications ──< status_history   (one application → many status entries)
applications >── agents           (many applications → one agent)
```

---

## Status Values & Meanings

| Status               | Step | Meaning                                         |
|----------------------|------|-------------------------------------------------|
| `submitted`          | 1    | Application received, awaiting review           |
| `documents_review`   | 2    | Documents being reviewed by team                |
| `employer_review`    | 3    | Profile shared with employer                    |
| `interview_scheduled`| 4    | Interview arranged                              |
| `job_offer`          | 5    | Job offer issued                                |
| `visa_processing`    | 6    | Qatar work visa being processed                 |
| `visa_approved`      | 7    | Visa approved, travel documents ready           |
| `flight_prep`        | 8    | Flight arrangements being made                  |
| `arrived`            | 9    | Arrived in Qatar                                |
| `employed`           | 10   | Employment started                              |
| `rejected`           | —    | Application rejected                            |
| `cancelled`          | —    | Application cancelled                           |

---

## API Endpoints

| Method | Path                                     | Auth          | Description                       |
|--------|------------------------------------------|---------------|-----------------------------------|
| POST   | `/api/applications`                      | Public        | Submit new application            |
| GET    | `/api/applications/check-email?email=`   | Public        | Check if email already applied    |
| GET    | `/api/applications/track/:trackingNumber`| Public        | Get application status + timeline |
| GET    | `/api/applications/track/:trackingNumber/messages` | Reference | Load the encrypted support chat |
| POST   | `/api/applications/:trackingNumber/messages` | Reference/employer | Send encrypted message, link, or attachment |
| POST   | `/api/applications/:trackingNumber/presence` | Reference/employer | Update online, last-seen, and typing state |
| GET    | `/api/admin/applications`                | Admin         | List all applications             |
| GET    | `/api/admin/applications/:id`            | Admin         | Get application detail            |
| PUT    | `/api/admin/applications/:id/status`     | Admin         | Update status & add note          |
| DELETE | `/api/admin/applications/:id`            | Admin         | Delete application                |
| POST   | `/api/agents/apply`                      | Public        | Apply to become an agent          |
| GET    | `/api/admin/agents`                      | Admin         | List all agent applications       |
| PUT    | `/api/admin/agents/:id/status`           | Admin         | Approve/reject/activate agent     |
| GET    | `/api/jobs`                              | Public        | List active job listings          |
| POST   | `/api/jobs`                              | Public        | Post a job (pending admin approval)|
| GET    | `/api/admin/jobs`                        | Admin         | List all jobs (including inactive)|
| PUT    | `/api/admin/jobs/:id/activate`           | Admin         | Activate/deactivate a job         |
| GET    | `/api/admin/stats`                       | Admin         | Dashboard statistics              |
| POST   | `/api/employers/profile`                 | Public        | Register or update an employer profile |
| POST   | `/api/employers/login`                   | Public        | Sign in with employer email and PIN |
| GET    | `/api/employers/me`                       | Employer      | Get the authenticated approved employer |
| GET    | `/api/employers/access`                   | Employer      | List only that employer's applications |
| GET    | `/api/employers/jobs`                     | Employer      | List that employer's jobs |
| PUT    | `/api/employers/applications/:id/decision`| Employer      | Update applicant progress and add a note |
| GET    | `/api/faqs`                               | Public        | Read active applicant bot questions |
| GET/POST| `/api/admin/faqs`                         | Admin         | List or create bot questions |
| PUT/DELETE| `/api/admin/faqs/:faqKey`               | Admin         | Edit or remove a bot question |
| GET    | `/api/admin/employers`                    | Admin         | List employer profiles without PIN hashes |
| PUT    | `/api/admin/employers/:id/status`         | Admin         | Approve, reject, or suspend an employer |

**Admin authentication:** Pass header `X-Admin-Password: your-password` with every admin request.

---

## Environment Variables

| Variable          | Required | Description                              |
|-------------------|----------|------------------------------------------|
| `SUPABASE_URL`    | ✅ Yes   | Supabase project URL                     |
| `SUPABASE_KEY`    | ✅ Yes   | Supabase service-role key (server only)  |
| `ADMIN_PASSWORD`  | ✅ Yes   | Password for admin dashboard             |
| `PORT`            | No       | HTTP port (default: 3000)               |

---

## Tracking Number Format

`FJQ-YYYY-XXXXXXXX` (e.g. `FJQ-2026-K3PNM7QR`)

- `FJQ` — FindAJob Qatar prefix
- `YYYY` — Year of submission
- `XXXXXXXX` — 8-character random alphanumeric code (no ambiguous characters like 0/O, 1/I)
