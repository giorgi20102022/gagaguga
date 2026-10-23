CREATE TABLE IF NOT EXISTS final_submissions (
  submission_id UUID PRIMARY KEY,
  dealer_id INTEGER NOT NULL REFERENCES dealers(id),
  state TEXT NOT NULL CHECK (state IN ('processing', 'completed', 'uncertain')),
  request_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  dispatch_attempt INTEGER NOT NULL DEFAULT 1,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
