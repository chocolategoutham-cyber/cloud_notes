# Cloud Vault

Cloud Vault is now a phone-number OTP password vault built with:

- GitHub Pages for the frontend
- Cloudflare Workers for the backend API
- Cloudflare D1 for phone sessions, OTP codes, and password vault data

## Product flow

1. Enter a phone number
2. Request an OTP
3. Verify the OTP
4. View, search, add, edit, delete, and save password entries
5. Logout when finished

## Important note

Cloudflare can store OTPs and verify them, but it cannot send SMS by itself. The current app is wired in `OTP_DEV_MODE`, so the Worker returns the OTP in the API response for testing. To make this real on a phone, you still need an SMS provider later.

## Backend tables

- `phone_users`
- `otp_codes`
- `phone_sessions`
- `password_vaults`

## Deployment

1. Apply `worker/schema.sql` to the D1 database.
2. Deploy the Worker.
3. GitHub Pages continues to deploy the frontend from `.github/workflows/deploy-pages.yml`.
