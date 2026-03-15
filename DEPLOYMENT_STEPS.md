> This project currently uses Render for backend hosting. Google Cloud Run is NOT part of the production infrastructure.

# Deployment Steps

## SECTION 1 - Backend Deployment (Render)

1. Push repository to GitHub.
2. Create a Render Web Service.
3. Configure the service:
   - Root directory: `api`
   - Build command: `npm install && npm run build`
   - Start command: `node dist/index.js`
4. Add environment variables from `api/.env.example`.

Render will produce a URL like:

`https://disposable-camera-api.onrender.com`

## SECTION 2 - Frontend Deployment (Firebase)

1. Set the frontend backend URL in `frontend/.env.production`:

   `VITE_API_BASE_URL=<Render backend URL>`

2. Build and deploy:

```bash
cd frontend
npm run build
firebase deploy --only hosting
```
