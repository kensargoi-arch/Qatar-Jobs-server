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
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employer_profiles_email ON employer_profiles(email);

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


-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- Enable RLS and add policies
-- ═══════════════════════════════════════════════════════════════

-- Applications: publicly readable only by tracking number via API
-- (all actual access goes through server.js which uses service-role key)
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE employer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_alert_subscribers ENABLE ROW LEVEL SECURITY;

-- Allow server (service role) to do everything
-- The service-role key bypasses RLS — use it in server.js only.
-- For public anon key (frontend-direct), lock everything down.

-- Public can read active jobs
CREATE POLICY "Public read active jobs"
  ON jobs FOR SELECT
  USING (active = true);

-- Everything else handled server-side (server.js uses service-role key)
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

---

## API Endpoints

| Method | Path                                     | Auth          | Description                       |
|--------|------------------------------------------|---------------|-----------------------------------|
| POST   | `/api/applications`                      | Public        | Submit new application            |
| GET    | `/api/applications/check-email?email=`   | Public        | Check if email already applied    |
| GET    | `/api/applications/track/:trackingNumber`| Public        | Get application status + timeline |
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
