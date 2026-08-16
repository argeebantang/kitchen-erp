# Project Progress

Tracks delivery against the 12-week sprint plan (`kitchenERP-sprint-v3.jsx`). Update this
file — and check off tasks — as part of the same commit that completes them.

Legend: `[x]` done · `[~]` partial (see note) · `[ ]` not started

---

## Phase 1 — Foundation & Procurement (Weeks 1–4)

### Week 1 — Project Setup & Database Schema
- [x] Initialize Next.js 15 + TypeScript monorepo
- [x] Full Prisma schema: 22 tables covering all modules including costing and AI log
- [x] Docker Compose: PostgreSQL + Redis
- [x] GitHub repo + GitHub Actions CI pipeline
- [~] Auth with 5 roles — implemented as `ADMIN, PROCUREMENT_MANAGER, PRODUCTION_MANAGER, BRANCH_MANAGER, VIEWER` (renamed from the plan's Admin/Accounting Approver/Warehouse Staff/Kitchen Supervisor/Branch Manager — intentional naming, matches `docs/overview.md`)
- [x] Login page + protected route middleware per role
- [x] Logout (topbar button, `components/dashboard/Topbar.tsx`)
- [x] Seed script (`prisma/seed.ts`)

**Deliverable status:** met — login, logout, role-based middleware, and full 22-table schema are in place.

**Note (2026-07-11):** `middleware.ts` `ROLE_GUARDS` still referenced the pre-flattening
dashboard URLs (`/dashboard/procurement` etc.) after the routes moved to `/procurement/*`,
`/production/*`, etc. — the guards were silently dead, so a VIEWER typing a restricted URL
directly wasn't blocked at the middleware level (only hidden from the sidebar). Fixed to guard
the current flat paths; added `app/unauthorized/page.tsx` since the redirect target didn't
exist yet either.

**Note:** the original plan called for a separate Fastify API server; this was intentionally
dropped in favor of Next.js API routes only (see `docs/overview.md`).

### Week 2 — Item Master & Bill of Materials
- [ ] Item Master CRUD (name, category, unit, reorder point)
- [ ] Unit price per item with `effective_date`
- [ ] BOM module: finished goods with ingredient lines per batch weight
- [ ] BOM scaled viewer (batch weight → auto-calculated quantities)
- [ ] BOM version history
- [ ] Seed real BOMs (Dinuguan, Lechon Paksiw, Bopis)

### Week 3 — Purchase Request & Purchase Order
- [ ] PR form + status flow (Draft → Pending → Approved/Rejected)
- [ ] Accounting approver inbox
- [ ] BullMQ notification job on PR submission
- [ ] Auto-generate PO draft on PR approval
- [ ] PO form + approval
- [ ] PO PDF export (Puppeteer)

### Week 4 — Receiving Report & Stock Update
- [ ] RR form linked to approved PO
- [ ] Variance detection
- [ ] RR approval
- [ ] Inventory ledger entry + stock update on RR approval
- [ ] Current stock dashboard
- [ ] BullMQ daily low-stock check job

---

## Phase 2 — Production & Finished Goods (Weeks 5–8)

### Week 5 — Production Order Creation
- [ ] Production Order form + BOM-derived material requirements
- [ ] Stock sufficiency check + shortage alerts
- [ ] Production Order approval + status flow
- [ ] Production schedule calendar view

### Week 6 — Production Execution & Basic Costing
- [ ] Execution flow (In Progress → Completed) with stock deduction/addition
- [ ] Batch/expiry tracking on finished goods
- [ ] Actual vs planned yield
- [ ] Costing: batch cost, cost/kg, variance
- [ ] Accounting approval of completion

### Week 7 — Conversion, Write-off & Expiry
- [ ] Conversion order + costing
- [ ] Write-off workflow + costing
- [ ] Expiry tracking (24/48h flags)
- [ ] End-of-day reconciliation

### Week 8 — Branch Distribution & Costing Dashboard
- [ ] Branch management
- [ ] Transfer Order + approval + variance logging
- [ ] Per-branch inventory view
- [ ] Costing dashboard

---

## Phase 3 — KitchenAI + Reports + Deploy (Weeks 9–12)

### Week 9 — KitchenAI Core Intelligence
- [ ] Claude API integration (Anthropic SDK)
- [ ] Cost Variance Explainer
- [ ] Natural Language Query + 6 callable functions
- [ ] AI query log table
- [ ] Streaming NL query UI

### Week 10 — KitchenAI Predictive Features
- [ ] Waste Pattern Detector (weekly BullMQ job)
- [ ] Reorder Recommender
- [ ] Demand Forecaster
- [ ] Supplier Performance Analyzer (monthly BullMQ job)
- [ ] AI badge + Regenerate button on all AI insights

### Week 11 — Approvals Hub & Reports
- [ ] Unified approvals inbox
- [ ] Notification bell + email (Resend)
- [ ] Escalation job (24h+ pending)
- [ ] 5 reports with CSV/PDF export
- [ ] End-of-day branch snapshot report
- [ ] Weekly report scheduler

### Week 12 — Deploy, Polish & Portfolio
- [ ] AWS deploy (EC2, RDS, S3)
- [ ] CI/CD to main
- [ ] PWA setup
- [ ] UI polish (loading/empty/error states)
- [ ] Realistic seed data (3 branches, 30 days history)
- [ ] README + architecture diagram
- [ ] Demo video + LinkedIn post
