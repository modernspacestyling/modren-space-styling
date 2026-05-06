-- ============================================================
-- MSS — Expenses table migration (added 2026-05-06)
-- Run in: Supabase Dashboard → SQL Editor → New query → Paste → Run
-- Idempotent: safe to re-run.
-- Powers: /admin/expenses.html, /api/admin-list-expenses,
--         /api/telegram-webhook (Mini/Sony send receipts via Telegram)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS expenses (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- What & when
  date         DATE NOT NULL,
  description  TEXT NOT NULL,
  category     TEXT NOT NULL
               CHECK (category IN ('rent','insurance','truck','designer','supplies','photography','software','other')),
  type         TEXT NOT NULL DEFAULT 'one-off'
               CHECK (type IN ('fixed','variable','one-off')),

  -- Money (AUD, all stored separately for proper accounting)
  amount       NUMERIC(10,2) NOT NULL,   -- ex GST
  gst          NUMERIC(10,2) NOT NULL DEFAULT 0,
  total        NUMERIC(10,2) NOT NULL,   -- amount + gst

  -- Optional link to a booking (for variable per-job expenses)
  job_number   TEXT,

  -- Provenance — how the expense was added
  source       TEXT NOT NULL DEFAULT 'manual'
               CHECK (source IN ('manual','telegram_photo','telegram_text')),
  receipt_url  TEXT,           -- Supabase Storage URL when a photo is attached
  created_by   TEXT,           -- admin email or telegram chat_id

  -- Telegram dedup / undo
  telegram_message_id BIGINT,  -- so we can undo by reference

  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date     ON expenses (date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (category);
CREATE INDEX IF NOT EXISTS idx_expenses_source   ON expenses (source);
CREATE INDEX IF NOT EXISTS idx_expenses_tg_msg   ON expenses (telegram_message_id) WHERE telegram_message_id IS NOT NULL;

-- Storage bucket for receipt photos (run separately if bucket missing)
-- Supabase Studio → Storage → New bucket → name: 'receipts' → Public: NO
