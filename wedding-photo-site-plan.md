# Wedding Photo Site Plan (React Build)

## Vision
Build your own React web app for an Indian wedding digital disposable camera experience:
- Family QR based entry
- Auto vintage filter on every upload
- Moderation before public display
- Swipe gallery like Bumble: swipe left = dislike, swipe right = like, swipe up = super like
- Floating bottom upload button like Instagram

The product should feel fun, fast, and premium on mobile first.

## Core Experience

### Guest Flow
1. Guest scans a family QR link.
2. Site opens with family pre-selected (example: "Welcome Balodhi Family").
3. Guest optionally enters their name.
4. Guest uploads one or more photos using the bottom upload button.
5. Photos are processed with the disposable camera filter and sent to moderation.
6. After approval, photos appear in swipe gallery for everyone.
7. Guests can swipe to react and add short comments.

### Organizer Flow
1. Open private admin dashboard.
2. Review pending photos in a grid.
3. Approve, reject, or bulk approve.
4. Monitor reported comments if needed.
5. Export approved album at the end of the wedding.

## UI/UX Direction (Super Cool Look)

### Visual Style
- Theme: warm film aesthetic, grain texture, bold typography, soft shadows.
- Palette: cream, marigold, coral, deep green, charcoal.
- Cards: rounded corners, slight tilt animation, tactile swipe feedback.

### Swipe Gallery (Bumble Style)
- Full-screen photo card stack.
- Drag left to dislike, drag right to like, drag up for super like.
- Live labels while dragging: NOPE, LIKE, SUPER.
- Spring physics and snap-back animation.
- At bottom: tiny reaction counters and comment shortcut.

### Bottom Upload CTA (Instagram Style)
- Sticky bottom nav on mobile.
- Center primary action button: Upload.
- Opens camera/gallery chooser directly.
- Remains visible across gallery and home screens.

## Recommended Tech Stack

### Frontend
- React + Vite + TypeScript
- React Router for routes
- Tailwind CSS (or CSS modules) for styling
- Framer Motion for swipe gestures and animations
- TanStack Query for server state

### Backend
- Node.js + Express (or NestJS)
- PostgreSQL for metadata
- Redis (optional) for queue/rate limits
- Object storage for images: Cloudinary or S3 compatible bucket

### Auth and Security
- Admin login with password + optional OTP
- Signed upload URLs
- Basic abuse controls (rate limit, file type checks, size limits)

## Data Model (Simple)

### Tables / Collections
- families: id, name, slug, qr_token
- guests: id, family_id, display_name, created_at
- photos: id, family_id, guest_id, original_url, filtered_url, status, created_at
- reactions: id, photo_id, guest_id, type (dislike|like|superlike), created_at
- comments: id, photo_id, guest_id, text, status, created_at

### Status Values
- photo.status: pending | approved | rejected
- comment.status: visible | hidden

## Routes Plan

### Public
- /:qrToken -> family landing + name input
- /upload?f=balodhi -> upload page with family context
- /gallery -> approved swipe gallery
- /photo/:id -> single photo detail + comments

### Admin
- /admin/login
- /admin/moderation
- /admin/photos
- /admin/settings

## API Plan

### Public APIs
- POST /api/guest/session -> create guest session from family token + optional name
- POST /api/photos/upload-url -> generate signed upload URL
- POST /api/photos -> submit uploaded file for processing/moderation
- GET /api/photos/approved -> paginated approved photos
- POST /api/photos/:id/reaction -> like/dislike/superlike
- GET /api/photos/:id/comments -> list comments
- POST /api/photos/:id/comments -> add comment

### Admin APIs
- GET /api/admin/photos/pending
- POST /api/admin/photos/:id/approve
- POST /api/admin/photos/:id/reject
- POST /api/admin/photos/bulk-approve

## Disposable Camera Filter Pipeline
1. Guest uploads original image.
2. Backend queues processing job.
3. Processor applies same preset to every image:
	- Slightly lifted blacks
	- Warm tone shift
	- Extra contrast
	- Mild grain
	- Vignette
4. Store filtered output URL.
5. Save status as pending.

Use Cloudinary transformation presets first (fastest launch), then migrate to custom Sharp/ImageMagick pipeline if needed.

## QR and Family Access Plan
- Generate one qr_token per family.
- QR encodes URL like: https://yourdomain.com/f/balodhi?t=ABC123
- Validate token server side and map to family.
- No login required for guests.
- Add optional per-family upload window (start/end time).

## Moderation Dashboard Requirements
- Grid with quick preview.
- Multi-select checkboxes.
- One click approve/reject.
- Bulk approve action.
- Filter by family and time.
- Keyboard shortcuts for speed (A approve, R reject, arrow keys navigate).

## Build Roadmap

### Phase 1 (MVP - 5 to 7 days)
- Family QR entry
- Guest name capture
- Photo upload
- Auto filter processing
- Moderation approve/reject
- Approved gallery grid

### Phase 2 (Experience - 3 to 4 days)
- Swipe card gallery with drag gestures
- Reactions (dislike/like/superlike)
- Commenting with family + name display
- Sticky bottom upload button

### Phase 3 (Polish - 2 to 3 days)
- Performance optimization
- Loading skeletons and transitions
- Admin bulk tools
- Album export and share link

## React Component Plan
- AppLayout
- FamilyEntryScreen
- GuestNameSheet
- UploadFabButton (floating bottom upload button)
- SwipeDeck
- SwipeCard
- ReactionBadge
- CommentDrawer
- ModerationGrid
- BulkActionBar

## Mobile-First Rules
- Primary viewport: 360px to 430px width.
- Keep thumb-reach controls in lower 40 percent of screen.
- Avoid heavy text input.
- Compress uploads client side before send.
- Use lazy loading for image cards.

## Success Metrics
- Upload completion rate
- Time from upload to approval
- Number of approved photos per family
- Reactions per photo
- Comment rate

## Launch Checklist
- Test on Android + iPhone browsers.
- Test low network mode.
- Verify every family QR resolves correctly.
- Confirm moderation actions are fast.
- Prepare backup printed QR cards.
- Assign one live moderator during wedding events.

## Summary
This React plan gives you a custom wedding photo platform with Bumble-like swipe interactions, an Instagram-style bottom upload action, disposable camera aesthetics, and moderation control. It is designed to feel premium, social, and easy for every family group to use during the wedding.

---

## One-Day Free-To-Go Plan (Future Reuse)

### Goal and Constraints
- Use the site for one day only.
- Keep total stored media within 5 GB max.
- Use free-tier services first.
- Keep launch simple and reliable.

### Free-First Technical Stack
- Frontend: React + Vite hosted on Cloudflare Pages (free tier).
- Backend/API: Cloudflare Workers (free tier).
- Database: Cloudflare D1 for metadata.
- Image storage: Cloudflare R2.
- No custom domain required for launch (use provider subdomain).

### MVP Features to Keep
- Family QR based entry (strict token required each visit).
- Optional guest name.
- Multi-photo upload from sticky bottom upload button.
- Moderation queue with approve/reject and bulk actions.
- Swipe gallery: left skip, right like, up opens comments placeholder.
- Manual upload ON/OFF control for moderators.

### Media Optimization Rules
- Apply disposable style filter on client before upload (to reduce backend cost).
- Resize to max width 1600 px.
- Save as JPEG quality 0.72 to 0.78.
- Strip EXIF metadata.
- Target average image size 500 KB to 800 KB.

### Cost Control Strategy
- Start fully on free tiers.
- Use polling (10 to 20 seconds) for gallery refresh instead of always-on realtime sockets.
- Load gallery images with pagination and lazy loading.
- Keep comments out of MVP (planned for phase 2).

### Security and Access
- Guest access: QR token only, no classic login.
- Admin access: shared launch password.
- Upload validation: file type, file size, and rate limiting.
- Block direct access without valid family token.

### Event-Day Operations
- All moderators can work in parallel.
- Moderator keeps uploads ON during active events and can pause manually.
- On upload failure, show clear retry-later message.
- Keep one backup moderator phone/laptop logged in.

### Post-Event Handling
- Keep gallery available for at least 1 week.
- Moderator can export and download album.
- Optional cleanup after export to avoid ongoing storage use.

### Paid Risk Areas (Only If Limits Exceed)
- Heavy image bandwidth due to repeated browsing.
- Advanced realtime beyond simple polling.
- Custom domain purchase.
- Premium monitoring or auth add-ons.

### Verification Checklist
1. Dry-run with 20 to 30 photos end to end.
2. Confirm blocked access without valid token.
3. Test compression output size on real phones.
4. Test moderation with 3+ moderators simultaneously.
5. Test Android Chrome and iPhone Safari on weak network.

### Locked Decisions
- Expected scale: ~75 families, ~350 guests, ~200 photos.
- Runtime scope: one-day event usage.
- Storage cap target: 5 GB max.
- Swipe behavior: left skip, right like, up opens comments placeholder.
- Comments: phase 2, moderated before display.
- Consent line: "By uploading, you allow the couple to review, display, and keep your photos for this event."
- Target deadline: 12 December.
