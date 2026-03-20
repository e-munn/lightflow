-- LightFlow Sessions Table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Untitled Session',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Flow editor state
  flow_nodes JSONB DEFAULT '[]'::jsonb,
  flow_edges JSONB DEFAULT '[]'::jsonb,

  -- Mixer parameters
  mixer_params JSONB DEFAULT '{
    "bassWeight": 0.5,
    "drumsWeight": 0.35,
    "vocalsWeight": 0.15,
    "attackMs": 30,
    "releaseMs": 400,
    "sensitivity": 1.0,
    "threshold": 0.05,
    "beatBoost": 0.2,
    "smoothing": 0.3
  }'::jsonb
);

-- Enable Row Level Security (optional, for multi-user later)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations for now (no auth required)
CREATE POLICY "Allow all access" ON sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS sessions_updated_at_idx ON sessions (updated_at DESC);
