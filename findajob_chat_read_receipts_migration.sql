-- FindAJob.qa — Chat read/unread migration
-- Run this once in the Supabase SQL Editor.
-- Safe to re-run: IF NOT EXISTS prevents duplicate-table/index errors.

CREATE TABLE IF NOT EXISTS chat_message_reads (
  message_id   UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  reader_role   TEXT NOT NULL CHECK (reader_role IN ('applicant', 'employer', 'admin')),
  read_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, reader_role)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_reads_reader
  ON chat_message_reads(reader_role, read_at);