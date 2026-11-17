-- A8: customers confirm that they own their email address with a 6-digit code.
-- This is separate from users.is_verified, which gates staff sign-in.
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;

-- Accounts that existed before verification was introduced are not asked to
-- verify retroactively. A later email change clears this and asks again.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- One pending code per account. Only its hash is stored.
CREATE TABLE email_verification_codes (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE email_verification_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE email_verification_codes FROM PUBLIC;
