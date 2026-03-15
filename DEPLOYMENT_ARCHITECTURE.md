> Production stack is Render + Firebase Hosting. Cloudflare Wrangler files are legacy development artifacts and are not part of production deploy.

# disposableCamera Deployment Architecture

## Project Stack

### Frontend
- Framework: Vite + React
- Hosting: Firebase Hosting
- CDN: Google CDN

### Backend
- Framework: Node.js + Express (TypeScript)
- Hosting: Render Web Service
- Root directory: `api`
- Runtime port: `process.env.PORT || 8080`
- Start command: `node dist/index.js`

### Storage
- AWS S3 (or compatible endpoint using optional `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE`)

### Database
- SQLite file on service disk: `api/data/wedding.db`
- Migrations are executed automatically on API startup via `applyMigrations()`.

## Request Flow

User -> Firebase Hosting (frontend) -> Render backend API -> AWS S3

## Frontend Environment

Set `VITE_API_BASE_URL` to your Render backend URL in `frontend/.env.production`.

Example:

`VITE_API_BASE_URL=https://disposable-camera-api.onrender.com`

## Security and Hardening Notes

- API includes upload MIME/size validation.
- API includes lightweight in-memory rate limiting for admin login, upload routes, and comment creation.
- Reactions/comments are restricted to photos from the same family session.
