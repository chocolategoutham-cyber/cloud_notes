# Cloud Notes

Cloud Notes is a GitHub-first progressive web app for private notes, passwords, and sensitive text.

The app is intentionally static so it can be hosted on GitHub Pages without any non-GitHub services. The security model is:

- the app UI is a public static site
- the vault is encrypted in the browser before it is saved anywhere
- local storage keeps only an encrypted vault payload
- GitHub sync stores only the encrypted vault JSON in a private repository

## Features

- installable PWA with offline support
- encrypted local-first vault using Web Crypto API
- three item types: notes, passwords, and private snippets
- GitHub sync through the GitHub Contents API
- auto-lock timer
- password generator
- touch-friendly responsive layout

## Local Development

Because this is a static app, you can open it with a simple local web server.

Examples:

```powershell
python -m http.server 4173
```

Then open `http://localhost:4173`.

## GitHub Setup

1. Create a GitHub repository for this project.
2. Push this code to the repository.
3. Enable GitHub Pages with the included Actions workflow.
4. In the app, configure a private repository for encrypted vault sync.
5. Create a fine-grained personal access token with access only to that sync repository's contents.

Recommended pattern:

- `cloud-notes-app`: public or private source repo that deploys GitHub Pages
- `cloud-notes-vault`: private repo that stores only `vault/cloud-notes.enc.json`

You can also use one repo, but separating app hosting from encrypted data is cleaner.

## Sync Notes

- The app never sends plaintext vault data to GitHub.
- Use the same passphrase across devices so the same encrypted vault can be unlocked everywhere.
- Deletions are tracked with tombstones so pull/merge is safer across devices.
- The GitHub token is intentionally not persisted to disk by the app.

## Deployment

The workflow in `.github/workflows/deploy-pages.yml` deploys the static app directly to GitHub Pages.
