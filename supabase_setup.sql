-- ═══════════════════════════════════════════════════════════
-- PORTE - Supabase Database Setup
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── institutes ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS institutes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  code       TEXT UNIQUE NOT NULL,
  gps        JSONB DEFAULT '{"lat":0,"lng":0,"range":100}'::jsonb,
  doors      JSONB DEFAULT '[]'::jsonb,
  schedule   JSONB DEFAULT '{}'::jsonb,
  alerts     JSONB DEFAULT '{"rc":true,"open":false}'::jsonb,
  history    JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── users ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  phone         TEXT UNIQUE NOT NULL,
  pw            TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','super_admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  inst_id       UUID REFERENCES institutes(id) ON DELETE SET NULL,
  expire_date   TIMESTAMPTZ,
  push_sub      JSONB,
  note          TEXT,
  schedule      JSONB,
  schedule_mode TEXT DEFAULT 'inherit' CHECK (schedule_mode IN ('inherit','custom','always')),
  last_loc      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─── door_state ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS door_state (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  value      TEXT NOT NULL,
  source     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── app_commands ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_commands (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id  TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_inst ON users(inst_id);
CREATE INDEX IF NOT EXISTS idx_door_state_created ON door_state(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_device ON app_commands(device_id);

-- ─── RLS Policies ─────────────────────────────────────────────
ALTER TABLE institutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE door_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_commands ENABLE ROW LEVEL SECURITY;

-- Service role bypass (used by server.js)
CREATE POLICY "service_role_all" ON institutes FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON users FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON door_state FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON app_commands FOR ALL TO service_role USING (true);

-- ─── Seed Data ───────────────────────────────────────────────
-- Insert Lycee4 institute
INSERT INTO institutes (id, name, code)
VALUES ('00000000-0000-0000-0000-000000000001', 'Lycee4', '00004')
ON CONFLICT (code) DO NOTHING;

-- Insert Super Admin (phone: 22630506)
INSERT INTO users (name, phone, pw, role, status)
VALUES ('Super Admin', '22630506', 'admin123', 'super_admin', 'active')
ON CONFLICT (phone) DO NOTHING;

-- ─── Helper Function ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION append_history(inst_id UUID, entry JSONB)
RETURNS VOID AS $$
DECLARE
  current_history JSONB;
BEGIN
  SELECT history INTO current_history FROM institutes WHERE id = inst_id;
  current_history := COALESCE(current_history, '[]'::jsonb) || entry;
  -- Keep last 500 entries
  IF jsonb_array_length(current_history) > 500 THEN
    current_history := current_history -> (jsonb_array_length(current_history) - 500);
  END IF;
  UPDATE institutes SET history = current_history WHERE id = inst_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
