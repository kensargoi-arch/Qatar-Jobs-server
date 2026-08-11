-- FindAJob.qa updated-file migration
-- Run once in Supabase SQL Editor.
-- This is safe to re-run: it only adds missing columns, tables, and indexes.
-- It does not contain passwords, API keys, or service-role credentials.

-- Employer session, suspension, and presence fields.
ALTER TABLE employer_profiles
  ADD COLUMN IF NOT EXISTS online BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_employer_profiles_status
  ON employer_profiles(status);

-- Application-to-employer/job relationships used by the full employer view.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employer_email TEXT,
  ADD COLUMN IF NOT EXISTS employer_company TEXT;

CREATE INDEX IF NOT EXISTS idx_applications_employer_email
  ON applications(employer_email);

CREATE INDEX IF NOT EXISTS idx_applications_job_id
  ON applications(job_id);

-- Employer comments and uploaded applicant documents.
CREATE TABLE IF NOT EXISTS application_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  employer_email TEXT NOT NULL,
  employer_name TEXT,
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_comments_application
  ON application_comments(application_id);

CREATE TABLE IF NOT EXISTS application_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'application-documents',
  file_url TEXT,
  content_type TEXT,
  file_size INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_documents_application
  ON application_documents(application_id);

-- Chat FAQ editing and chat presence/typing indicators.
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS faq_key TEXT;

CREATE TABLE IF NOT EXISTS chat_faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faq_key TEXT UNIQUE NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  featured BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_faqs_visibility
  ON chat_faqs(active, featured, sort_order);

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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  participant_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('applicant', 'employer', 'admin')),
  display_name TEXT,
  online BOOLEAN NOT NULL DEFAULT false,
  typing BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(application_id, participant_key)
);

CREATE INDEX IF NOT EXISTS idx_chat_presence_application
  ON chat_presence(application_id);

-- Storage buckets are created outside SQL in Supabase Storage:
-- application-documents: private
-- employer-photos: public