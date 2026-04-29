# Cloud Vault

Cloud Vault is now an email-OTP password vault built with:

- GitHub Pages for the frontend
- Cloudflare Workers for the backend API
- Cloudflare D1 for email sessions, OTP codes, and password vault data

## Product flow

1. Enter an email address
2. Request an OTP
3. Verify the OTP
4. View, search, add, edit, delete, and save password entries
5. Logout when finished

## Email delivery

The Worker supports two modes:

- `OTP_DEV_MODE="true"`
  The API returns `devCode` so you can test instantly.
- Resend configured
  Set `RESEND_API_KEY` and `OTP_EMAIL_FROM` and the Worker will send the OTP email automatically.

If email delivery is not configured, the app still works in dev mode and shows the OTP in the UI.

## Backend tables

- `email_users`
- `otp_codes`
- `email_sessions`
- `password_vaults`

## Deployment

1. Apply `worker/schema.sql` to the D1 database.
2. Add Worker secrets and vars if you want real email delivery.
3. Deploy the Worker.
4. GitHub Pages deploys the frontend from `.github/workflows/deploy-pages.yml`.
