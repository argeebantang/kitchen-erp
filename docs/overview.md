# Project Overview

## Purpose

KitchenERP is a production and inventory management system for a food kitchen/commissary operation with multiple branches. It manages the full lifecycle from raw material procurement through production and distribution: Purchase Requests → Purchase Orders → Receiving Reports → stock updates, BOM-driven production of finished goods, inter-branch stock transfers, and conversions of unsold goods into other products. It solves the business problem of tracking inventory accurately across locations, enforcing approval workflows for spend and stock movement, and giving management visibility into costs and stock levels without relying on manual spreadsheets.

Build status lives in [progress.md](progress.md); the 12-week plan is `kitchenERP-sprint-v3.jsx`, rendered at `/roadmap`. Each change has a dated note in `docs/YYYY-MM-DD-*.md`.

## Main Features

Built (Weeks 1–4):

* Role-based authentication — Admin, Procurement Manager, Production Manager, Branch Manager, Accounting, Viewer — with route guards in `middleware.ts`
* Item master: materials, finished goods, categories, units, and dated reference prices per material (optionally per supplier)
* Versioned Bills of Materials, stated per batch and scalable to a target quantity
* Purchase Requests: draft → submit → approve/reject by accounting; approval auto-creates a draft Purchase Order
* Purchase Orders: sourcing (supplier, delivery date, re-pricing), submit → approve/reject → mark sent, PDF export
* Receiving Reports: record a delivery line by line against a sent order, with variance (short / over-delivered / rejected) against what was outstanding; submit it, and accounting approves or rejects — approval writes the stock ledger and levels and moves the order to partially / fully received
* Stock Levels: a colour-coded stock map per branch (🔴 out / 🟡 low / 🟢 healthy against each material's reorder point), reorder alerts, filters, a per-tile popup linking to the ledger, refreshed every 30 s
* Stock Ledger: every stock movement with its source document, running balance per material and branch, and a check against the stock level
* Daily 06:00 jobs: a low-stock summary for procurement and admins, and a ledger-vs-stock-level check for admins
* Production Orders (Week 5, in progress): plan a run of a finished good from its active BOM — batch weight × number of batches, production date, branch — saved as a draft `PRD-000001` and editable while a draft; each save pins the active BOM version
* Approvals inbox for accounting; nobody approves their own work, ADMIN included
* Notification bell on every page: unread count and latest notifications, pushed live over Server-Sent Events (request submitted, daily jobs); mark one or all read

Planned (see the roadmap): production order requirements, stock check and approval, transfers, conversions, costing, AI features.

## Tech Stack

* Backend: Next.js 15 route handlers (App Router), TypeScript, Node.js 22
* Frontend: Next.js 15 (App Router), React 19, Tailwind CSS 4, `lucide-react` icons
* Database: PostgreSQL 16, accessed via Prisma ORM 5.22, with tracked migrations
* Queue: BullMQ on Redis 7, consumed by a separate worker process (`npm run worker`)
* PDF: `@react-pdf/renderer`, rendered in the request
* Validation: `zod`; auth: `jose` (JWT) + `bcryptjs`
* Storage: not yet configured
* Infrastructure: Docker Compose (Postgres + Redis) for local development; GitHub Actions CI

## Project Structure

* `app/` — Next.js App Router pages and route handlers
  * `app/login/`, `app/unauthorized/`, `app/roadmap/` — outside the protected layout
  * `app/(protected)/` — authenticated route group: `dashboard/`, `procurement/` (`requests`, `orders`, `approvals`, `receiving`), `inventory/stock`, `inventory/ledger`, `production/bom`, `production/orders`, `admin/master`
  * `app/api/` — `auth/*`, `materials`, `finished-goods`, `categories`, `units`, `boms`, `purchase-requests`, `purchase-orders` (incl. `submit`, `send`, `pdf`), `approvals`, `receiving-reports`, `production-orders`, `notifications` (incl. `stream`, `read`)
* `components/` — `dashboard/` (Sidebar, Topbar, NotificationBell), `master/`, `inventory/` (`StockMap`, `StockTile`), `bom/`, `production/` (`ProductionOrderForm`), `procurement/` (forms, action buttons, `StatusBadge`, `DecisionHistory`, `ApprovalActions`), `pdf/`, `ui/` (`form.tsx`, `Modal.tsx`, `AutoRefresh.tsx`)
* `lib/` — cross-cutting helpers: `prisma.ts`, `config.ts`, `jwt.ts` (Edge-safe), `auth.ts` (Node-only), `session.ts`, `navigation.ts`, `queue.ts` (Node-only), `realtime.ts` (Node-only), `decimal.ts`, `format.ts`, `dates.ts`
* `repositories/` — data-access layer, one per domain entity; the only code that imports Prisma
* `services/` — business rules above the repositories
* `worker/` — the BullMQ consumer, a standalone process; never imported from `app/`
* `scripts/` — command-line helpers (`run-job.ts`: `npm run job -- <name>`)
* `hooks/` — client-side React hooks (`useUser.ts`, `useNotifications.ts`)
* `prisma/` — `schema.prisma` (24 models), `migrations/`, `seed.ts`
* `middleware.ts` — authentication and role guards for every request
* `docker-compose.yml` — local Postgres + Redis services

## Coding Philosophy

* Keep solutions simple.
* Prefer existing patterns over introducing new ones.
* Minimize breaking changes.
* Maintain backward compatibility unless intentionally changed.
