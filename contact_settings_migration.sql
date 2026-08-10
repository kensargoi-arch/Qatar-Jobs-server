-- FindAJob.qa — Contact settings migration
-- Run this once in the Supabase SQL Editor.
-- The server stores one row and the admin dashboard updates it.

CREATE TABLE IF NOT EXISTS contact_settings (
  setting_key      TEXT PRIMARY KEY CHECK (setting_key = 'default'),
  whatsapp_number  TEXT NOT NULL DEFAULT '',
  call_number      TEXT NOT NULL DEFAULT '',
  whatsapp_message TEXT NOT NULL DEFAULT 'Hello, I would like to ask about available jobs in Qatar.',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO contact_settings (setting_key)
VALUES ('default')
ON CONFLICT (setting_key) DO NOTHING;

ALTER TABLE contact_settings DISABLE ROW LEVEL SECURITY;