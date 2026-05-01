# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mobile-first wedding photo platform with QR-based guest entry, moderated uploads, and swipe gallery interactions. Guests access the platform via family-specific QR tokens, upload photos that require admin approval, and interact with approved photos in a gallery.

## Architecture

**Frontend**: React + Vite (Firebase Hosting)
**Backend**: Node.js + Express + TypeScript (Render)
**Database**: SQLite (`api/data/wedding.db`)
**Media Storage**: AWS S3 (or compatible endpoint via `S3_ENDPOINT`)

### Backend Architecture

The backend is organized into modular layers:

- **HTTP Layer** (`api/src/index.ts`): Express routes, middleware, and request handling
- **Database Layer** (`api/src/db/`): Modular database operations with type-safe queries
- **Storage Layer** (`api/src/storage/`): Abstracted storage operations (S3, validation, URL handling)
- **Auth Layer** (`api/src/auth.ts`): Authentication and session management

### Key Data Model

- **families**: Wedding families with unique QR tokens for guest access
- **guest_sessions**: Time-limited guest sessions tied to families
- **photos**: Uploaded photos with moderation status (pending/approved/rejected)
- **reactions**: Guest reactions to photos
- **comments**: Photo comments with family-scoped access control
- **moderation_actions**: Admin moderation history

### Request Flow

User → Firebase Hosting (frontend) → Render backend API → AWS S3

## Development Setup

### Backend (API)

```bash
cd api
npm install
npm run dev  # Runs on http://127.0.0.1:8787
```

### Frontend

```bash
cd frontend
npm install
npm run dev  # Runs on http://127.0.0.1:5173
```

Set `frontend/.env` with `VITE_API_BASE_URL=http://127.0.0.1:8787`

## Quality Checks

```bash
cd api
npm run typecheck
npm run lint

cd ../frontend
npm run lint
npm run build
```

## Key API Routes

**Guest Access**: `/api/token/validate`, `/api/session/start`
**Uploads**: `/api/uploads/sign`, `/api/uploads/direct`, `/api/photos/register`
**Gallery**: `/api/gallery/approved`, `/api/photos/:id/reaction`, `/api/photos/:id/comments`
**Admin**: `/api/admin/login`, `/api/admin/photos/pending`, `/api/admin/photos/bulk-approve`

## Database Management

- SQLite database at `api/data/wedding.db` (or `SQLITE_PATH` env var)
- Migrations in `api/migrations/` run automatically on API startup
- Default families seeded via `0002_seed_families.sql`
- Foreign keys enabled: `db.pragma('foreign_keys = ON')`

### Database Layer Structure

The database layer is organized into modular files in `api/src/db/`:

- **types.ts**: TypeScript interfaces for all database entities
- **families.ts**: Family lookup, creation, and token validation
- **sessions.ts**: Guest session creation, validation, and expiry checks
- **photos.ts**: Photo CRUD operations, status updates, and filtering
- **comments.ts**: Comment CRUD operations and photo-specific queries
- **reactions.ts**: Reaction creation and photo-specific queries
- **moderation.ts**: Moderation actions and bulk operations
- **settings.ts**: App settings (upload toggle, etc.)
- **index.ts**: Database initialization and exports

All database operations are type-safe and reusable, with no inline `db.prepare()` calls in route handlers.

## Environment Variables

**Backend** (`api/.env`):
- `PORT`: API server port (default 8787)
- `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`: S3 configuration
- `UPLOAD_SIGNING_SECRET`: Secret for upload signing
- `ADMIN_PASSWORD`: Admin authentication
- `SQLITE_PATH`: Database file path (use `/var/data/wedding.db` on Render)
- `MAX_UPLOAD_BYTES`: Upload size limit (default 8MB)

**Frontend** (`frontend/.env`):
- `VITE_API_BASE_URL`: Backend API URL

## Deployment

**Backend**: Render Web Service with persistent disk for SQLite database
**Frontend**: Firebase Hosting

See `DEPLOYMENT_STEPS.md` for detailed deployment instructions.

## Security Notes

- Upload MIME type validation restricted to: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- In-memory rate limiting for admin login, uploads, and comments
- CORS configured for production Firebase domains and localhost in development
- Reactions/comments restricted to photos from the same family session
- Admin routes protected by `ADMIN_PASSWORD` via `x-admin-token` header

### Storage Layer Structure

The storage layer is organized into modular files in `api/src/storage/`:

- **types.ts**: Storage interfaces and type definitions
- **s3.ts**: S3 implementation with AWS SDK
- **validation.ts**: Upload validation (MIME types, size limits, file extensions)
- **index.ts**: Storage client factory and exports

Storage operations are abstracted through a common interface, allowing for easy provider switching (S3 → R2 → local). All upload validation and URL formatting are centralized in the storage layer.

## Frontend Architecture

Single-page React app (`frontend/src/App.jsx`) with route-based views:
- `/f/:token`: Guest entry and upload interface
- `/admin/moderation`: Admin photo moderation dashboard
- `/gallery`: Public gallery with swipe interactions

Uses QR code scanning (`jsqr`) and generation (`qrcode`) libraries for family access.