> Production backend is Render (Node/Express). Do not use `wrangler deploy` for production.

# Deployment Steps

## Section 1 - Backend Deployment (Render)

1. Push repository to GitHub.
2. Create a Render Web Service.
3. Configure the service:
   - Root directory: `api`
   - Build command: `npm install && npm run build`
   - Start command: `node dist/index.js`
4. Attach a Render Persistent Disk:
   - Mount path: `/var/data`
   - Size: at least 1 GB
5. Set `SQLITE_PATH=/var/data/wedding.db` in Render environment variables.
6. Add remaining environment variables from `api/.env.example`.
7. Deploy and verify startup logs include API boot message and `SQLite DB path: /var/data/wedding.db`.

Render URL format:

`https://disposable-camera-api.onrender.com`

## Section 2 - Backend Post-Deploy Verification

1. Check health endpoint:
   - `GET <render-url>/api/health` should return `status: ok`.
2. Verify migrations are applied automatically:
   - `GET <render-url>/api` should list comments and moderation routes.
   - Create one test session and call comments endpoints to confirm `photo_comments` table is active.
3. Verify admin login and upload toggle routes.

## Section 3 - Frontend Deployment (Firebase)

1. Set backend URL in `frontend/.env.production`:

   `VITE_API_BASE_URL=<Render backend URL>`

2. Build and deploy:

```bash
cd frontend
npm run build
firebase deploy --only hosting
```

## Section 4 - Frontend Smoke Test

1. Open a family URL: `/f/<token>`.
2. Start guest session.
3. Upload one photo and confirm it appears in pending moderation.
4. Approve from `/admin/moderation`.
5. Confirm it appears in `/gallery`.
