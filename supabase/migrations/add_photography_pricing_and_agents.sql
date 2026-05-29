-- ============================================================
-- Photography Pricing & Agent Registration
-- Run this migration in Supabase Dashboard → SQL Editor
-- ============================================================

-- ============================================================
-- PHOTOGRAPHY PRICING (Individual Services)
-- ============================================================
CREATE TABLE IF NOT EXISTS photography_pricing (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_name    TEXT UNIQUE NOT NULL,
  service_key     TEXT UNIQUE NOT NULL, -- e.g., 'day_photos', 'dusk_photos'
  base_price      NUMERIC(10,2) NOT NULL,
  gst_included    BOOLEAN NOT NULL DEFAULT FALSE,
  description     TEXT,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Insert photography services
INSERT INTO photography_pricing (service_name, service_key, base_price, gst_included, description, sort_order) VALUES
  ('Day Time Photos', 'day_photos', 120.00, FALSE, 'Professionally edited interior and exterior photos.', 1),
  ('Dusk Time Photos', 'dusk_photos', 180.00, FALSE, 'High-resolution photos with creative angles and wide shots.', 2),
  ('Instagram Reels', 'instagram_reels', 80.00, TRUE, 'Cinematic short-form content for social media.', 3),
  ('Cinematic Video Tour', 'cinematic_video', 450.00, FALSE, 'Professional video walkthrough of the property.', 4),
  ('Twilight Video Shoot', 'twilight_video', 550.00, FALSE, 'Captures property during golden hour for warm, inviting look.', 5),
  ('Aerial Drone Photos', 'aerial_drone', 140.00, FALSE, 'Aerial shots showing property and surroundings.', 6),
  ('Floor Plan', 'floor_plan', 90.00, TRUE, 'Professional 2D floor plan layout.', 7),
  ('Rental Photo Shoot', 'rental_photos', 90.00, TRUE, 'Streamlined photo package for rental properties.', 8),
  ('Virtual Staging (per image)', 'virtual_staging', 35.00, FALSE, 'Virtual furniture placement in empty rooms.', 9),
  ('Declutter (per image)', 'declutter', 5.00, FALSE, 'Professional image cleanup and decluttering.', 10)
ON CONFLICT (service_key) DO NOTHING;

CREATE TRIGGER photography_pricing_updated_at BEFORE UPDATE ON photography_pricing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- PHOTOGRAPHY BUNDLES
-- ============================================================
CREATE TABLE IF NOT EXISTS photography_bundles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bundle_name     TEXT UNIQUE NOT NULL,
  bundle_key      TEXT UNIQUE NOT NULL, -- e.g., 'starter', 'essentials'
  description     TEXT,
  service_keys    TEXT[] NOT NULL, -- array of service_keys included
  regular_price   NUMERIC(10,2) NOT NULL,
  agent_price     NUMERIC(10,2) NOT NULL, -- locked price for agents
  discount_pct    NUMERIC(5,2) NOT NULL, -- calculated discount %
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Insert bundle packages
INSERT INTO photography_bundles (bundle_name, bundle_key, description, service_keys, regular_price, agent_price, discount_pct, sort_order) VALUES
  ('Starter', 'starter', 'Day Photos + Floor Plan', ARRAY['day_photos', 'floor_plan'], 210.00, 189.00, 10.00, 1),
  ('Essentials', 'essentials', 'Day + Dusk Photos + Floor Plan', ARRAY['day_photos', 'dusk_photos', 'floor_plan'], 390.00, 346.00, 11.28, 2),
  ('Video Basics', 'video_basics', 'Day Photos + Cinematic Video Tour', ARRAY['day_photos', 'cinematic_video'], 570.00, 513.00, 10.00, 3),
  ('Complete Package', 'complete', 'Day + Dusk + Aerial + Floor Plan + Video Tour', ARRAY['day_photos', 'dusk_photos', 'aerial_drone', 'floor_plan', 'cinematic_video'], 980.00, 833.00, 15.00, 4),
  ('Full Production', 'full_production', 'Complete Package + Instagram Reel + Virtual Staging', ARRAY['day_photos', 'dusk_photos', 'aerial_drone', 'floor_plan', 'cinematic_video', 'instagram_reels', 'virtual_staging'], 1095.00, 915.00, 16.44, 5)
ON CONFLICT (bundle_key) DO NOTHING;

CREATE TRIGGER photography_bundles_updated_at BEFORE UPDATE ON photography_bundles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- AGENT REGISTRATIONS (Locked Pricing)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_registrations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_name      TEXT NOT NULL,
  agency_name     TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  phone           TEXT,
  agent_code      TEXT UNIQUE NOT NULL, -- generated unique code
  pricing_tier    TEXT NOT NULL DEFAULT 'agent' CHECK (pricing_tier IN ('regular', 'agent')),
  locked_until    DATE NOT NULL, -- expiry date (1 year from registration)
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'expired')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER agent_registrations_updated_at BEFORE UPDATE ON agent_registrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE agent_registrations ENABLE ROW LEVEL SECURITY;

-- Index for fast code lookup
CREATE INDEX IF NOT EXISTS idx_agent_registrations_code ON agent_registrations (agent_code);
CREATE INDEX IF NOT EXISTS idx_agent_registrations_email ON agent_registrations (email);

-- ============================================================
-- Update photo_bookings table to support agent pricing
-- ============================================================
ALTER TABLE photo_bookings ADD COLUMN IF NOT EXISTS agent_code TEXT REFERENCES agent_registrations(agent_code) ON DELETE SET NULL;
ALTER TABLE photo_bookings ADD COLUMN IF NOT EXISTS pricing_tier TEXT DEFAULT 'regular' CHECK (pricing_tier IN ('regular', 'agent'));
ALTER TABLE photo_bookings ADD COLUMN IF NOT EXISTS final_price NUMERIC(10,2);

-- ============================================================
-- RLS POLICIES
-- ============================================================
CREATE POLICY "Public can read photography pricing" ON photography_pricing FOR SELECT USING (true);
CREATE POLICY "Public can read photography bundles" ON photography_bundles FOR SELECT USING (true);
