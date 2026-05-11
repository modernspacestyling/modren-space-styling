-- ============================================================
-- MSS — Supabase setup v2 (fresh project: wmkbzmrgtkcksucwallj)
-- Run in: Supabase Dashboard → SQL Editor → New query → Paste → Run
-- Idempotent: safe to re-run.
-- Includes customer fields for invoicing (added 2026-05-05).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── PRICING CONFIG ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_config (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  base_price    NUMERIC(10,2) NOT NULL DEFAULT 800.00,
  base_weeks    INTEGER       NOT NULL DEFAULT 6,
  bedroom_rate  NUMERIC(10,2) NOT NULL DEFAULT 250.00,
  bathroom_rate NUMERIC(10,2) NOT NULL DEFAULT 150.00,
  living_rate   NUMERIC(10,2) NOT NULL DEFAULT 200.00,
  dining_rate   NUMERIC(10,2) NOT NULL DEFAULT 150.00,
  garage_rate   NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  weekly_rate   NUMERIC(10,2) NOT NULL DEFAULT 200.00,
  travel_surcharge   NUMERIC(10,2) NOT NULL DEFAULT 50.00,
  occupied_surcharge NUMERIC(10,2) NOT NULL DEFAULT 300.00,
  gst_rate      NUMERIC(5,4)  NOT NULL DEFAULT 0.10,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO pricing_config (id) VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

-- ─── AGENTS (legacy/optional) ───────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  agency TEXT,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','agent','staff')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── VERIFIED SMS NUMBERS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS verified_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  phone_number TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'installer' CHECK (role IN ('admin','transport','designer','installer')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO verified_numbers (name, phone_number, role) VALUES
  ('Team Lead', '+61400000001', 'installer'),
  ('Transport', '+61400000002', 'transport'),
  ('Designer',  '+61400000003', 'designer')
ON CONFLICT DO NOTHING;

-- ─── BOOKINGS (with customer fields + final_price built in) ─
CREATE TABLE IF NOT EXISTS bookings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_number      TEXT UNIQUE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','on_the_way','arrived','active','pickup_ready','closed','cancelled')),

  -- Agent (the booker, usually a real estate agent)
  agent_name      TEXT NOT NULL,
  agent_phone     TEXT NOT NULL,
  agent_email     TEXT NOT NULL,
  agency          TEXT,

  -- Customer (the homeowner / vendor — invoice goes to them)
  customer_name    TEXT,
  customer_email   TEXT,
  customer_phone   TEXT,
  customer_address TEXT,

  -- Property
  address         TEXT NOT NULL,
  install_date    DATE NOT NULL,
  install_time    TEXT,
  bedrooms        INTEGER NOT NULL DEFAULT 0,
  bathrooms       INTEGER NOT NULL DEFAULT 0,
  living_areas    INTEGER NOT NULL DEFAULT 0,
  dining_areas    INTEGER NOT NULL DEFAULT 0,
  garage          BOOLEAN NOT NULL DEFAULT FALSE,
  vacant          BOOLEAN NOT NULL DEFAULT TRUE,
  lockbox_enc     TEXT,
  notes           TEXT,
  start_date      DATE,
  end_date        DATE,
  estimated_price NUMERIC(10,2),
  final_price     NUMERIC(10,2),
  manual_entry    BOOLEAN DEFAULT FALSE,
  created_by      TEXT,
  floorplan_url   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent column adds (in case bookings already exists from earlier run)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_name    TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_email   TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_phone   TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_address TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS final_price      NUMERIC(10,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS manual_entry     BOOLEAN DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_by       TEXT;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_updated_at ON bookings;
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── INVENTORY ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
DROP TRIGGER IF EXISTS inventory_updated_at ON inventory;
CREATE TRIGGER inventory_updated_at BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO inventory (name, category, total, available) VALUES
  ('Queen Beds','bedroom',12,12),
  ('King Beds','bedroom',8,8),
  ('Single Beds','bedroom',6,6),
  ('3-Seat Sofas','lounge',10,10),
  ('2-Seat Sofas','lounge',8,8),
  ('Dining Tables','dining',8,8),
  ('Dining Chairs','dining',40,40),
  ('Rugs','decor',15,15),
  ('Artwork Pieces','decor',30,30),
  ('Coffee Tables','lounge',10,10),
  ('Outdoor Sets','outdoor',4,4),
  ('Decor Items (Box)','decor',20,20)
ON CONFLICT DO NOTHING;

-- ─── SMS LOG ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  to_number TEXT, from_number TEXT,
  body TEXT NOT NULL,
  job_number TEXT,
  status TEXT DEFAULT 'sent',
  twilio_sid TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ACTIVITY LOG ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message TEXT NOT NULL,
  actor TEXT DEFAULT 'System',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── SMS TEMPLATES ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO sms_templates (key, name, body) VALUES
  ('booking_received','Booking Received','Hi {agentName}, your staging request {jobNumber} for {address} has been received. A confirmed quote will follow shortly. — Modern Space Styling'),
  ('booking_confirmed','Booking Confirmed','Hi {agentName}, your staging {jobNumber} at {address} is confirmed for {date} at {time}. Lockbox code has been securely stored. — Modern Space Styling'),
  ('team_dispatch','Team Dispatch','NEW JOB {jobNumber}: {address}. Install: {date} {time}. Reply CONFIRMED {jobNumber} to acknowledge.'),
  ('job_completed','Job Completed','Hi {agentName}, staging is complete at {address} ({jobNumber}). 6-week period ends {endDate}. — Modern Space Styling'),
  ('extension_warn','5-Day Warning','Hi {agentName}, staging at {address} ({jobNumber}) ends in 5 days on {endDate}. Reply EXTEND {jobNumber} 1W or 2W to extend. $200+GST/wk.'),
  ('extension_confirm','Extension Confirmed','Hi {agentName}, {jobNumber} at {address} extended. New end date: {endDate}. — Modern Space Styling'),
  ('pickup_alert','Pickup Alert','PICKUP REQUIRED: {jobNumber} at {address} staging period ended. Please arrange collection immediately.'),
  ('admin_new_booking','Admin — New Booking','NEW BOOKING {jobNumber}: {agentName} ({agency}) — {address}. Install: {date} {time}. Beds: {bedrooms}. Login to approve.')
ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body;

-- ─── PHOTO BOOKINGS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo_bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_number TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
         CHECK (status IN ('pending','confirmed','scheduled','completed','delivered','cancelled')),
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  client_email TEXT NOT NULL,
  agency TEXT,
  address TEXT NOT NULL,
  property_type TEXT NOT NULL DEFAULT 'sale' CHECK (property_type IN ('sale','rent')),
  preferred_date DATE NOT NULL,
  preferred_time TEXT,
  package TEXT NOT NULL CHECK (package IN ('essential','premium','ultimate','rental')),
  bedrooms INTEGER NOT NULL DEFAULT 0,
  bathrooms INTEGER NOT NULL DEFAULT 0,
  addons JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  estimated_price NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
DROP TRIGGER IF EXISTS photo_bookings_updated_at ON photo_bookings;
CREATE TRIGGER photo_bookings_updated_at BEFORE UPDATE ON photo_bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── INVOICES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number TEXT UNIQUE NOT NULL,
  job_number TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('staging','photo')),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  agency TEXT,
  address TEXT,
  service_date DATE,
  due_date DATE NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal_ex_gst NUMERIC(10,2) NOT NULL DEFAULT 0,
  gst_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_inc_gst NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending'
                 CHECK (payment_status IN ('pending','paid','overdue','partial','waived')),
  paid_date DATE,
  paid_amount NUMERIC(10,2),
  payment_method TEXT,
  payment_notes TEXT,
  email_sent BOOLEAN DEFAULT FALSE,
  email_sent_at TIMESTAMPTZ,
  reminder_sent BOOLEAN DEFAULT FALSE,
  reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
DROP TRIGGER IF EXISTS invoices_updated_at ON invoices;
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RLS ────────────────────────────────────────────────────
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE verified_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read pricing" ON pricing_config;
CREATE POLICY "Public can read pricing" ON pricing_config FOR SELECT USING (true);

-- ─── INDEXES ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bookings_job_number ON bookings (job_number);
CREATE INDEX IF NOT EXISTS idx_bookings_status     ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_end_date   ON bookings (end_date);
CREATE INDEX IF NOT EXISTS idx_sms_log_job_number  ON sms_log  (job_number);
CREATE INDEX IF NOT EXISTS idx_agents_email        ON agents   (email);
CREATE INDEX IF NOT EXISTS idx_photo_job_number    ON photo_bookings (job_number);
CREATE INDEX IF NOT EXISTS idx_photo_status        ON photo_bookings (status);
CREATE INDEX IF NOT EXISTS idx_invoices_job_number      ON invoices (job_number);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number   ON invoices (invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status   ON invoices (payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date         ON invoices (due_date);

-- DONE. You should see a success row count.
