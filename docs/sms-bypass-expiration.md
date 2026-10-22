# Temporary dealer SMS bypass

The inverted `require_sms_verification` setting is paired with
`sms_bypass_expires_at` (PostgreSQL `TIMESTAMPTZ`). A saved transition to bypass
sets a server-generated deadline 30 minutes in the future. Repeated ON values
and unrelated saves preserve it. Manual OFF clears it. Admin forms only send
the setting when the administrator changes the switch.

Deploy the backend and frontend together. Apply
`migrations/20261022_sms_bypass_expiration.sql` with your PostgreSQL migration
runner before starting the new version, or let the existing `ensureDbBasics`
startup migration apply the same idempotent SQL. This standalone SQL file is
not a Drizzle journal migration. Existing enabled bypasses with no finite,
future deadline are disabled. No backfill grants a new bypass window.

Cleanup runs at startup and on dealer profile/list reads, including the UI's
15-second refresh. This works with the existing serverless entrypoint without
an always-running timer. Idle database rows can retain expired values until
the next read; SMS authorization always checks the deadline independently.
The conditional SQL update and row-locked admin updates prevent cleanup from
clearing a newly enabled bypass.

Both final submission routes read current settings before accepting a request.
The SMS verification endpoint issues a signed, HttpOnly, two-hour proof bound
to the dealer and normalized phone only after an actual code is verified.
Bypass responses never issue proof, and client `smsVerified` flags are not
trusted. Customers already in a form at deployment may need to verify SMS
again. Verification rejection preserves form data.

Run focused tests:

```
node --import tsx --test server/smsBypass.test.ts server/smsSubmission.test.ts
npm run check
```

HTTP tests use the real registered endpoints with a mocked storage boundary;
they do not contact PostgreSQL, SMSOffice, or submission webhooks. Production
migration execution, concurrent PostgreSQL cleanup, and browser behavior must
be verified in the deployment environment.
