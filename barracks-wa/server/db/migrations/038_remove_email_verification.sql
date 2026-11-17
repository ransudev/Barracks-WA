-- Email verification (037) was withdrawn. Remove its objects wherever 037 ran.
-- users.is_verified, which gates staff sign-in, is unrelated and stays.
DROP TABLE IF EXISTS email_verification_codes;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;
