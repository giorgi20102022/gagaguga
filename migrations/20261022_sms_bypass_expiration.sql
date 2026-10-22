-- Idempotent; also applied by ensureDbBasics for the existing startup migration flow.
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS sms_bypass_expires_at TIMESTAMPTZ;
UPDATE dealers SET require_sms_verification = true, sms_bypass_expires_at = NULL
WHERE require_sms_verification IS NOT TRUE
  AND (sms_bypass_expires_at IS NULL OR NOT isfinite(sms_bypass_expires_at) OR sms_bypass_expires_at <= clock_timestamp());
