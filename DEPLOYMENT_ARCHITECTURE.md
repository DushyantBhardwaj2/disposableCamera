> This project currently uses Render for backend hosting. Google Cloud Run is NOT part of the production infrastructure.

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
- Dockerfile: optional (not required for Render Node runtime deployment)

### Storage
- AWS S3 for image uploads

### Database
- SQLite file located at `api/data/wedding.db`

## API Flow

User -> Firebase Hosting (frontend) -> Render backend API -> AWS S3

## Frontend Configuration

The frontend must define:

`VITE_API_BASE_URL=<Render backend URL>`

This value is set in:

`frontend/.env.production`

Example:

`VITE_API_BASE_URL=https://disposable-camera-api.onrender.com`
