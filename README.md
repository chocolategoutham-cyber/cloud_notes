# Cloud Notes

Cloud Notes is a GitHub-first progressive web app for encrypted notes only.

## Security model

- the app UI is a static GitHub Pages site
- notes are encrypted in the browser before local save
- the same encrypted payload is pushed to a separate private GitHub repository
- notes become searchable only after the vault is unlocked with the master password

## This build

This build is wired to a fixed private vault repository target:

- owner: `chocolategoutham-cyber`
- repo: `cloud_notes_vault`
- branch: `main`
- path: `vault/notes.enc.json`

The repo target is internal to the code. Authentication is still user-side for security reasons, because a GitHub Pages app cannot safely hide a write-capable GitHub credential inside browser code.

## Features

- installable PWA
- offline support through a service worker
- encrypted local vault using Web Crypto API
- secure note search after unlock
- note create, edit, duplicate, delete
- encrypted GitHub sync to a dedicated private repo
- auto-lock timer

## Local development

```powershell
python -m http.server 4173
```

Open `http://localhost:4173`.
