# Cloud Notes

Cloud Notes is a split architecture:

- a static PWA frontend hosted on GitHub Pages
- a tiny Cloudflare Worker backend for signup, login, logout, and notes CRUD
- a private GitHub repository used as the notes store

## What this version does

- create account
- login account
- logout account
- fetch notes from a private GitHub repo after login
- add, edit, and delete notes
- save note changes back into the private repo through the backend

## Architecture

### Frontend

Files:

- `index.html`
- `app.js`
- `styles.css`
- `sw.js`

The frontend never talks to GitHub directly. It only calls the backend API with `credentials: include` so the login session cookie is sent automatically.

### Backend

Files:

- `worker/src/index.js`
- `worker/wrangler.toml`
- `worker/schema.sql`
- `worker/.dev.vars.example`

The backend is responsible for:

- storing users in Cloudflare D1
- hashing passwords
- creating and validating login sessions
- reading and writing encrypted note files in the private GitHub repo

## Notes storage model

Each user gets one encrypted file in the private repo:

- `users/<username>/notes.enc.json`

The backend encrypts the notes payload before writing it to GitHub, so the repo does not contain plaintext note bodies.

## Local frontend config

In `app.js`, replace:

- `https://cloud-notes-api.YOUR-SUBDOMAIN.workers.dev`

with your deployed Worker URL.

## Cloudflare Worker setup

1. Create a Cloudflare D1 database.
2. Put the real D1 database ID into `worker/wrangler.toml`.
3. Run the schema in `worker/schema.sql`.
4. Set Worker secrets and env values:

- `FRONTEND_ORIGIN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_BRANCH`
- `GITHUB_TOKEN`
- `SESSION_SECRET`
- `APP_ENCRYPTION_SECRET`

5. Deploy the Worker.

### Example local dev vars

See `worker/.dev.vars.example`.

## GitHub repo requirements

Use a private repo for notes storage, for example:

- `chocolategoutham-cyber/cloud_notes_vault`

Create a fine-grained token that can write repository contents for that repo only, and store it as the backend secret `GITHUB_TOKEN`.

## Important security note

This setup is secure in a way that a GitHub Pages-only app is not:

- the GitHub token is only on the backend
- the browser never gets direct repo write credentials
- login and account creation happen through backend API routes

## Frontend deployment

The GitHub Pages workflow in `.github/workflows/deploy-pages.yml` still deploys the static frontend.
