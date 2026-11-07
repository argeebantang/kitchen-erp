# 2026-11-07 — In-app notification bell, real-time over SSE

Pulled forward from Week 11. Three jobs already wrote `Notification` rows — Week 3's
PR-submitted and Week 4's daily low-stock and stock-reconciliation — and nothing displayed them.
Every page now has a bell in the top bar with an unread count and the latest notifications,
updated the moment a notification is written or read. Week 11 keeps email (Resend) and the
24-hour escalation job, building on this.

Built in subtasks N.1–N.3. Tracker: `docs/notification-bell-subtasks.xlsx` (not in git).

## Decisions

| Area | Decision | Rationale |
|---|---|---|
| Where | Bell in the top bar, red unread badge (9+) | Visible on every page. |
| Delivery | **Push**: Redis pub/sub → Server-Sent Events → the browser's native `EventSource`. No polling. | Asked for real time. Polling every 60 s was proposed first and rejected. Redis is already running; no new dependency. SSE rather than WebSockets: the traffic is one-way (server → browser), and SSE is plain HTTP with reconnection built into the browser. |
| Event payload | Empty — an event means "reload"; the client re-reads `GET /api/notifications` | One read path; covers new notifications, reads in another tab, and anything added later without merge logic in the client. |
| Reconnect | `EventSource` reconnects by itself (`retry: 5000`); when it gives up (`CLOSED` — a non-stream response, e.g. an expired session redirecting to `/login`, or 503) the hook backs off 1 s → 30 s | Without the second case the bell would stop silently. Every (re)connect reloads, which catches anything missed. |
| Hidden tabs | Disconnect while hidden; reconnect and reload when visible | Browsers allow 6 connections per site over HTTP/1.1 (`next dev`); one stream per visible tab stays well under it. |
| Mark read | `POST /api/notifications/read` `{ id }` or `{ all: true }`; opening an item marks it; "Mark all read" | `userId` is in the `WHERE`: nobody can mark another user's rows. Pushed, so the user's other tabs clear too. |
| Links | Per `referenceType`, one map in `NotificationService` (`REFERENCE_PAGES`) | Like `SOURCE_PAGES` on the ledger. |
| Scope | Dropdown, latest 15; no full page, no email | Week 11. |
| Who | Every signed-in user, own rows only; no role guard | Each person reads only their own notifications. |

## What changed

- *N.1 Bell, read-only.* `NotificationRepository.findLatestForUser()` (latest 15 + unread count,
  one transaction); `NotificationService.listForUser()` → `NotificationListDto` with an `href`
  per notification; `GET /api/notifications`; `hooks/useNotifications.ts`;
  `components/dashboard/NotificationBell.tsx` in `Topbar`.
- *N.2 Real time.* `lib/realtime.ts`: `publishNotificationsChanged(userIds)` on the Redis channel
  `notifications:changed`; one subscriber per server process (`ensureSubscribed`, on
  `globalThis`) fanning messages out to that process's open streams (`onNotificationsChanged`);
  messages validated with zod. Every notification write in `NotificationService` goes through
  `createAndPush()`; a failed push is logged and never fails the write. `GET
  /api/notifications/stream`: subscribes before answering (no gap between "connected" and
  "listening"), `retry: 5000`, `: ping` every 25 s, cleanup on `abort`, `no-transform` and
  `X-Accel-Buffering: no` so nothing buffers it, Node runtime, never cached, 503 if Redis is
  down. The hook opens an `EventSource`, reloads on `open` and on each `notifications` event,
  backs off when `CLOSED`, disconnects while hidden, and closes on unmount.
- *N.3 Mark read.* `NotificationRepository.markRead(userId, id | null)` (`updateMany`, `readAt:
  null` in the `WHERE` keeps the first read time); `NotificationService.markRead()` pushes when
  something changed; `POST /api/notifications/read`. In the bell: unread items tinted with a dot
  and a bold title, opening one marks it read, "Mark all read".

## Files affected

- `lib/realtime.ts` (new)
- `repositories/notification.repository.ts`, `services/notification.service.ts`
- `app/api/notifications/route.ts`, `app/api/notifications/stream/route.ts`, `app/api/notifications/read/route.ts` (all new)
- `hooks/useNotifications.ts` (new), `components/dashboard/NotificationBell.tsx` (new), `components/dashboard/Topbar.tsx`
- `docs/api.md`, `docs/architecture.md`, `docs/database.md`, `docs/deployment.md`, `docs/overview.md`, `docs/progress.md`, this note, `kitchenERP-sprint-v3.jsx`

## Database changes

None. `Notification.readAt` is now written (it was always null). The bell's count uses the
existing `@@index([userId, readAt])`.

## API changes

Three endpoints — see `docs/api.md#notifications`. All open to every signed-in user, each
scoped to the caller.

## UI changes

Bell with unread badge in the top bar on every protected page; dropdown of the latest 15 with
mark-read.

## Configuration / environment

None new; uses `REDIS_URL`. The stream needs a **long-running Node server** — fine on the
planned ECS service, not on serverless functions (`docs/deployment.md`).

## How to verify

```bash
npx tsc --noEmit && npm run lint
```

Checked during the build: two streams open (admin, procurement), a change published for admin
only reached admin's; a real `notifyLowStock` write reached the open stream at once, then a
`: ping` at 25 s; no cookie → 307 to `/login`. Mark read on throwaway rows: one → `updated 1`,
the same again → 0, another user's id → 0 (theirs still unread), `{ "all": false }` → 400, all →
2; each change that updated something pushed one event to the user's stream.

In the browser: sign in as admin@, then as procurement@ in a private window submit a purchase
request — accounting and admin bells update without a reload.

## Risks / assumptions / follow-up

- **Long-running server required.** Each open tab holds a request open. Behind a load balancer,
  keep its idle timeout above 25 s (the heartbeat) and serve HTTP/2 so streams don't use up the
  browser's per-site connection limit.
- **Pub/sub is fire-and-forget.** A message published while a server isn't subscribed is lost;
  the bell catches up on its next (re)connect. Deleting rows directly in the database pushes
  nothing.
- An expired session keeps the stream retrying (up to every 30 s) until the user navigates and
  is sent to `/login`.
- One `EventSource` per visible tab. If many tabs become common, share one stream across tabs
  (`BroadcastChannel`).
- No full notifications page, no pruning of old rows; the list query sorts a user's rows by
  `createdAt` without a dedicated index. Revisit when volumes grow.
- The stock map still refreshes every 30 s; it could listen for a "stock changed" event on the
  same channel later.
