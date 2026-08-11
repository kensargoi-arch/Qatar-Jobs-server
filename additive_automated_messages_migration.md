-- FindAJob.qa additive migration: editable helper and progress messages.
-- Safe to run more than once. This migration only adds the automated_messages
-- table, its supporting index, and the default rows used by the admin editor.

CREATE TABLE IF NOT EXISTS automated_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_key TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('progress', 'helper')),
  label TEXT NOT NULL,
  body TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automated_messages_visibility
  ON automated_messages(active, category, sort_order);

INSERT INTO automated_messages
  (message_key, category, label, body, active, sort_order)
VALUES
  ('access_helper', 'helper', 'Reference lookup helper', 'Forgot your reference number? Use the email address you used when applying.', true, 1),
  ('chat_locked_helper', 'helper', 'Locked chat helper', 'Enter your application reference or email to securely open your chat.', true, 2),
  ('employer_review', 'progress', 'Employer review', 'Your profile is now being reviewed by the employer for this role.', true, 10),
  ('interview_scheduled', 'progress', 'Interview scheduled', 'Your interview has been scheduled. The employer will share the time and meeting details with you shortly.', true, 20),
  ('job_offer', 'progress', 'Job offer', 'Your job offer has been issued. Please review the offer and employment contract carefully before signing.', true, 30),
  ('visa_processing', 'progress', 'Visa processing', 'Your visa is now being processed. Your employer has submitted the Qatar work visa application on your behalf. We will update you when there is progress.', true, 40),
  ('visa_approved', 'progress', 'Visa approved', 'Your Qatar work visa has been approved. Your entry permit and next travel instructions will be shared with you.', true, 50),
  ('flight_prep', 'progress', 'Flight preparation', 'Your flight preparation is now underway. Your employer or agency will confirm your travel arrangements with you.', true, 60),
  ('arrived', 'progress', 'Arrived in Qatar', 'You have been marked as arrived in Qatar. Your employer will guide you through onboarding and required registrations.', true, 70),
  ('employed', 'progress', 'Employment started', 'Your employment has started. Welcome to your new role in Qatar!', true, 80),
  ('rejected', 'progress', 'Application not selected', 'Your application was not selected for this opportunity. FindAJob.qa wishes you success with your next application.', true, 90),
  ('cancelled', 'progress', 'Application cancelled', 'This application has been cancelled. Please contact FindAJob.qa if you believe this was a mistake.', true, 100)
ON CONFLICT (message_key) DO NOTHING;