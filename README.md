# disposableCamera

Mobile-first wedding photo platform with QR-based guest entry, moderated uploads, and swipe gallery interactions.

## Stack

- Frontend: React + Vite (Firebase Hosting)
- Backend: Node.js + Express + TypeScript (Render)
- Database: SQLite (`api/data/wedding.db`)
- Media: AWS S3 (or compatible endpoint)

## Local Setup

### 1) API

```bash
cd api
npm install
npm run dev
```

API default: `http://127.0.0.1:8787`

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend default: `http://127.0.0.1:5173`

Set `frontend/.env` or equivalent with:

`VITE_API_BASE_URL=http://127.0.0.1:8787`

## Core Routes

- Guest entry: `/f/:token`
- Admin moderation: `/admin/moderation`
- Gallery: `/gallery`

## Deployment

- Backend deployment: Render (see `DEPLOYMENT_STEPS.md`)
- Frontend deployment: Firebase Hosting (see `DEPLOYMENT_STEPS.md`)
- Architecture notes: `DEPLOYMENT_ARCHITECTURE.md`

## Quality Checks

```bash
cd api
npm run typecheck
npm run lint

cd ../frontend
npm run lint
npm run build
```
