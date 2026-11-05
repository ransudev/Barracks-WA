-- Fixed-window counters for login and signup throttling. They live in the
-- database so every serverless instance shares them. Emails and IP addresses
-- are stored only as hashes.
CREATE TABLE auth_attempts (
  key_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_attempts_expires_at_idx ON auth_attempts (expires_at);

-- Internal table, matching the access model from migration 029.
ALTER TABLE auth_attempts ENABLE ROW LEVEL SECURITY;
