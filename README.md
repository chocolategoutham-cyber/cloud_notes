# Cloud Vault

Cloud Vault is a password-manager style PWA built with:

- GitHub Pages for the frontend
- Cloudflare Workers for the backend API
- Cloudflare D1 for account and encrypted vault storage

## Product flow

1. Create an account with `username + login password`
2. Log in
3. Create or unlock a separate master-password vault
4. Save website, username, password, and notes entries
5. The vault is encrypted in the browser before upload
6. Cloudflare stores only the encrypted vault blob

## Architecture

### Frontend

Files:

- `index.html`
- `app.js`
- `styles.css`
- `sw.js`

The frontend handles:

- login and signup UI
- master-password vault creation and unlock
- browser-side vault encryption and decryption
- password generation and search

### Backend

Files:

- `worker/src/index.js`
- `worker/wrangler.toml`
- `worker/schema.sql`
- `worker/.dev.vars.example`

The backend handles:

- account creation
- login / logout
- session cookies
- storing the encrypted vault blob in D1

## D1 schema

Tables:

- `users`
- `sessions`
- `vaults`

Each user has one encrypted vault row in `vaults`.

## Security model

- login password is hashed server-side
- session is managed by secure HTTP-only cookie
- vault is encrypted in the browser with the master password
- backend stores encrypted vault JSON only
- plaintext passwords are not intended to persist outside the active browser session

## Cloudflare setup

1. Create a D1 database.
2. Put the real D1 database ID into `worker/wrangler.toml`.
3. Apply `worker/schema.sql`.
4. Set Worker variables/secrets from `worker/.dev.vars.example`.
5. Deploy the Worker.
6. Replace `API_BASE` in `app.js` with your real Worker URL.

## Frontend deployment

The GitHub Pages workflow in `.github/workflows/deploy-pages.yml` still deploys the static frontend.
