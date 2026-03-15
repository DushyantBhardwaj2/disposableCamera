# AI Vibe Coding Execution Plan

## Purpose
This document is an execution playbook for an AI coding assistant to build the wedding photo platform end-to-end with minimal ambiguity.

## Product Snapshot
Build a mobile-first React web app for one-day wedding use:
- QR token based guest entry (strict gating)
- Easy multi-photo upload from sticky bottom action button
- Disposable camera visual style on uploaded images
- Moderation queue before photos become public
- Swipe gallery for approved photos

## Locked Constraints
- Event runtime: one day
- Storage target: max 5 GB
- Scale: about 75 families, 350 guests, 200 photos
- Cost strategy: free-tier first, avoid paid services unless hard limits are hit
- Guest auth: QR token only, no classic login
- Comments: phase 2 (not MVP)
- Swipe behavior: left = skip, right = like, up = open comments placeholder
- Upload controls: moderators can manually switch uploads on or off

## Recommended Free-First Stack
- Frontend: React + Vite + TypeScript (Cloudflare Pages)
- Backend API: Cloudflare Workers
- Database: Cloudflare D1
- Image storage: Cloudflare R2
- Realtime strategy: polling every 10 to 20 seconds for approved gallery updates

## AI Working Rules
1. Ship vertical slices that are runnable at all times.
2. Never break existing flows while adding new features.
3. Prefer simple working implementation over premature optimization.
4. Add basic validation and error handling for every API route.
5. Keep code modular and readable, avoid over-engineered patterns.
6. After each milestone, run tests and manual verification.

## Definition of Done (MVP)
- A guest can open via valid QR token and reach the app.
- Guest can upload multiple photos from phone gallery/camera.
- Uploaded photos appear in pending moderation.
- Moderator can approve or reject (and bulk approve).
- Approved photos appear in swipe gallery.
- Guests can like with swipe-right.
- Upload toggle can be switched on or off by moderator.
- App works on Android Chrome and iPhone Safari.

## Milestone Plan

### Milestone 1: Project Foundation
Goal: Create runnable app shell and API skeleton.

Tasks:
1. Initialize frontend (React + Vite + TypeScript).
2. Initialize worker API project.
3. Add shared env config and base routing.
4. Add lint + format + typecheck scripts.
5. Add basic health endpoint and frontend health page.

Exit criteria:
- Frontend and API run locally.
- Health check returns success.

### Milestone 2: Data Model and Access Gating
Goal: Implement family token model and strict QR access.

Tasks:
1. Create D1 schema:
   - families
   - guest_sessions
   - photos
   - reactions
   - moderation_actions
2. Seed sample families with qr_token values.
3. Build token validation endpoint.
4. Build middleware to block routes without valid token.
5. Add guest session creation from token + optional name.

Exit criteria:
- Invalid token is rejected.
- Valid token opens app and creates guest session.

### Milestone 3: Upload Pipeline
Goal: Enable stable multi-photo uploads with client compression.

Tasks:
1. Build sticky bottom upload button UI.
2. Add multi-file picker support.
3. Compress images client-side before upload:
   - max width 1600 px
   - jpeg quality 0.72 to 0.78
   - remove exif metadata
4. Upload files to R2 via signed URLs.
5. Save photo records as pending.
6. Add clear upload success and failure states.

Exit criteria:
- Multiple photos upload in one action.
- Pending records visible in moderation queue.

### Milestone 4: Moderation Dashboard
Goal: Allow moderators to review and publish photos.

Tasks:
1. Build moderator login with shared password.
2. Create pending photo grid.
3. Add approve/reject actions.
4. Add bulk select + bulk approve.
5. Add upload ON/OFF switch in admin settings.

Exit criteria:
- Moderators can process queue quickly.
- Upload toggle blocks new uploads when off.

### Milestone 5: Swipe Gallery
Goal: Deliver mobile-first approved photo browsing.

Tasks:
1. Build swipe card stack UI.
2. Map gestures:
   - left = skip
   - right = like
   - up = open comments placeholder panel
3. Persist reactions on swipe-right.
4. Poll approved gallery updates every 10 to 20 seconds.
5. Add loading skeleton and empty states.

Exit criteria:
- Guests can browse approved photos by swipe.
- New approvals appear during active viewing.

### Milestone 6: Stability and Launch Hardening
Goal: Make event-day behavior reliable.

Tasks:
1. Add API rate limiting.
2. Add file type and file size validation.
3. Add structured logging for upload and moderation paths.
4. Optimize image delivery sizes for gallery.
5. Test weak network behavior and retry messaging.
6. Validate full flow with 20 to 30 test photos.

Exit criteria:
- End-to-end flow works under realistic event usage.
- No blocker bugs in core flows.

## API Contract Draft

### Public Endpoints
- POST /api/session/start
  - input: qr_token, optional guest_name
  - output: session_token, family context

- POST /api/uploads/sign
  - input: session_token, file metadata
  - output: signed upload URL, storage key

- POST /api/photos/register
  - input: session_token, storage key, image metadata
  - output: photo_id, status=pending

- GET /api/gallery/approved
  - input: session_token, cursor/page
  - output: approved photos page

- POST /api/photos/{id}/reaction
  - input: session_token, type=like
  - output: updated reaction state

### Admin Endpoints
- POST /api/admin/login
- GET /api/admin/photos/pending
- POST /api/admin/photos/{id}/approve
- POST /api/admin/photos/{id}/reject
- POST /api/admin/photos/bulk-approve
- POST /api/admin/upload-toggle
- POST /api/admin/families/create
- POST /api/admin/families/update

## UI Routes
- /f/:token
- /gallery
- /admin/login
- /admin/moderation
- /admin/settings

## Quality Gates
- TypeScript build passes
- Lint passes
- No uncaught API 500 in happy path
- Mobile viewport checks: 360x800, 390x844, 430x932
- Upload and moderation tested on real phone

## Event-Day Runbook
1. Start with upload toggle ON.
2. Keep at least 2 moderators active at all times.
3. Moderate every 5 to 10 minutes.
4. If upload failures rise, pause uploads, recover, resume.
5. Export approved album after event.

## Copy-Paste Prompts for AI Agent

### Prompt A: Build Foundation
"Create a React + Vite + TypeScript frontend and Cloudflare Worker backend scaffold with health endpoints, env config, and scripts for lint/typecheck. Keep it minimal and production-structured."

### Prompt B: Build Upload Flow
"Implement QR token-gated guest session flow, sticky bottom multi-photo upload button, client compression (max 1600px, jpeg 0.72-0.78, strip exif), signed URL upload to R2, and pending photo registration in D1."

### Prompt C: Build Moderation
"Implement admin password login, pending photo grid, approve/reject actions, bulk approve, and upload ON/OFF toggle. Add safe API validation and clear frontend error states."

### Prompt D: Build Swipe Gallery
"Implement swipe card gallery for approved photos with gesture mapping: left skip, right like, up open comments placeholder. Add polling refresh every 10-20 seconds and mobile-first animations."

## Phase 2 (After MVP)
- Comment system with moderation
- Optional realtime push instead of polling
- Better analytics dashboard
- Optional custom domain and branding polish

## Notes for Future Reuse
- Keep this file as master implementation playbook.
- Update milestone status after every coding session.
- Record blockers and decisions directly in this file for continuity.

## Implementation Status Snapshot

Date: 15 March 2026

- Milestone 1: Complete
- Milestone 2: Complete
- Milestone 3: Mostly complete
- Milestone 4: In progress
- Milestone 5: Started

Completed in this session:
- Frontend scaffold created and dependencies installed.
- API Worker project created with lint/typecheck setup.
- D1 migrations added for core tables and seed families.
- Token validation endpoint implemented.
- Session start endpoint implemented.
- Frontend guest entry flow wired to validate token and start session.
- Local D1 migration and seed executed successfully.
- Valid and invalid token flows verified against local API.
- Milestone 3 API upload flow implemented: sign, direct upload, register pending photo.
- Milestone 3 frontend upload flow implemented: sticky bottom upload button, multi-file select, client compression, upload messaging.
- Milestone 4 API moderation flow implemented: admin login, pending list, approve/reject, bulk approve.
- Milestone 4 upload toggle implemented and enforced at upload-sign endpoint.
- Milestone 4 frontend moderation screen added at /admin/moderation.
- Admin endpoint smoke tests passed locally (login, pending list, upload toggle).
- Disposable-camera style transform added to client image pipeline before upload.
- Approved gallery API added and session-protected.
- Photo reaction API added and validated.
- Frontend /gallery route added with polling and swipe-style interactions.
- API hardening added: upload MIME/size validation and in-memory rate limiting for admin login, uploads, and comments.
- API family-scope guards added for reactions and comments to prevent cross-family access.
- Deployment docs aligned to Render + Firebase production stack.
- Frontend README replaced with project-specific setup/build/deploy instructions.

Pending next:
- Add stronger visual swipe physics (drag card transforms) for a more native Bumble-like feel.
- Improve swipe-up drawer behavior polish for comments interaction.
