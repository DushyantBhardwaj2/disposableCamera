# disposableCamera Frontend

React + Vite frontend for the wedding photo experience.

## Features Implemented

- Family QR-based guest entry via `/f/:token`
- Guest session start with optional name
- Multi-photo upload with client compression and disposable-camera style transform
- Admin moderation dashboard at `/admin/moderation`
- Approved gallery with swipe interactions, reactions, and comments drawer

## Local Development

1. Install dependencies:

```bash
npm install
```

1. Set API base URL in `.env.example` or local env file:

`VITE_API_BASE_URL=http://127.0.0.1:8787`

Use `.env.local` to override API URL for local runs when needed.

1. Start frontend:

```bash
npm run dev
```

## Build and Checks

```bash
npm run lint
npm run typecheck
npm run build
```

## Production

- Set `VITE_API_BASE_URL` in `frontend/.env.production` to your Render backend URL.
- Deploy using Firebase Hosting (see root deployment docs).

## Production Deployment Architecture

User -> Firebase Hosting frontend -> Render API -> AWS S3 and SQLite metadata DB

No localhost dependency is required in production.

## Production API

`VITE_API_BASE_URL=https://disposable-camera-api.onrender.com`

## Environment Variables

- `.env.production` is loaded automatically by Vite during `npm run build`.
- `.env.local` can be used for local development overrides.
- `.env.example` documents local defaults.

## Firebase Deployment Steps

```bash
npm run build
firebase deploy --only hosting
```
