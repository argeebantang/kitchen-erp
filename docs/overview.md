# Project Overview

## Purpose

KitchenERP is a production and inventory management system for a food kitchen/commissary operation with multiple branches. It manages the full lifecycle from raw material procurement through production and distribution: Purchase Requests → Purchase Orders → Receiving Reports → stock updates, BOM-driven production of finished goods, inter-branch stock transfers, and conversions of unsold goods into other products. It solves the business problem of tracking inventory accurately across locations, enforcing approval workflows for spend and stock movement, and giving management visibility into costs and stock levels without relying on manual spreadsheets.

Build status lives in [progress.md](progress.md); the 12-week plan is `kitchenERP-sprint-v3.jsx`, rendered at `/roadmap`. Each change has a dated note in `docs/YYYY-MM-DD-*.md`.

## Main Features

Built (Weeks 1–9):

* Role-based authentication — Admin, Procurement Manager, Production Manager, Branch Manager, Accounting, Viewer — with route guards in `middleware.ts`
* Item master: materials, finished goods, categories, units, and dated reference prices per material (optionally per supplier)
* Branches (Week 8): branch profiles in Master Data — code, name, type (Commissary supplies the outlets; every branch cooks), address, phone and one manager per branch; deactivated (never deleted) only once it holds no stock and no open documents
* Versioned Bills of Materials, stated per batch and scalable to a target quantity — production recipes, and conversion recipes that make one finished good from another (Week 7)
* Purchase Requests: draft → submit → approve/reject by accounting; approval auto-creates a draft Purchase Order
* Purchase Orders: sourcing (supplier, delivery date, re-pricing), submit → approve/reject → mark sent, PDF export
* Receiving Reports: record a delivery line by line against a sent order, with variance (short / over-delivered / rejected) against what was outstanding; submit it, and accounting approves or rejects — approval writes the stock ledger and levels and moves the order to partially / fully received
* Stock Levels: a colour-coded stock map per branch (🔴 out / 🟡 low / 🟢 healthy against each material's reorder point), reorder alerts, filters, a per-tile popup linking to the ledger, refreshed every 30 s
* Stock Ledger: every stock movement with its source document, running balance per material and branch, and a check against the stock level
* Daily 06:00 jobs: a low-stock summary for procurement and admins, a ledger-vs-stock-level check for admins, and (Week 7) an expiry summary for production managers and admins — lots expired or expiring within 24 / 48 h, with their value
* Production Orders (Week 5): plan a run of a finished good from its active BOM — batch weight × number of batches, production date, branch — saved as a draft `PRD-000001` and editable while a draft; each save pins the active BOM version. The order page and the form list every ingredient the run needs, per batch and in total, against the stock available at the branch (on hand less what approved runs still need), marked Enough or Short, with a shortage banner naming what is missing and a "Request missing materials" shortcut to a pre-filled purchase request
* Production orders are submitted for approval and approved or rejected by accounting (with a shortage badge in the inbox); the submitter is notified, and procurement is told what to order when an approved run is short. Production starts an approved run or cancels one (with a reason) before it starts; every status change is logged and shown as a timeline on the order
* Completing a run (Week 6): production reports an in-progress run done with its actual yield, shown against the plan ("9.6 kg of 10 kg planned · −0.4 kg (96%)"). Accounting sees what approving will do — every ingredient deducted, with the ones going below zero flagged, and the lot added — and approves (stock moves: ingredients out per BOM, the yield in as a lot numbered after the order) or sends it back with a reason. Both sides are notified
* Production costing (Week 6): each run's ingredients at the reference prices in force — an estimate on open orders, then the batch cost, cost per kg and the variance against plan, recorded when accounting approves the completion ("₱1,905.50 for 9.6 kg — ₱198.49/kg, +₱76.22 over plan"); finished-goods lots carry their cost per kg and value
* Finished Goods: lots on hand per branch, soonest to expire first, with expiry (each finished good's shelf life, set in Master Data, from the moment its run was reported done; expired lots flagged), unit cost and value, and totals per finished good; lots expired or expiring within 24 / 48 h are flagged ("Expires in 9 h") and can be filtered (Week 7); the Stock Ledger links production movements to their order
* Conversions (Week 7): production records a conversion already done — unsold Lechon made into Lechon Paksiw — with what it used and made; the form shows the Lechon lots it takes from (soonest to expire first, expired ones skipped), the added ingredients, the cost and the new lot before submitting (`CNV-000001`). Accounting approves (stock moves: Lechon out of its lots, ingredients out, a Paksiw lot in, the cost recorded — source at its lots' cost plus ingredients at reference prices) or rejects with a reason; both sides are notified
* Write-offs (Week 7): from a lot on Finished Goods, production writes off what cannot be used or converted — how much, why (expired, spoiled, damaged, failed quality, other); accounting approves (it leaves stock at the lot's cost, the peso value lost recorded) or rejects. Inventory → Write-offs shows the value written off; lots show what is pending
* End of Day (Week 7): one day of finished goods per branch from the ledger — opening, produced, converted in and out, written off, distributed, closing — in kg and at cost, with a check that it all reconciles and the documents behind each figure; a 21:00 summary to production managers, accounting and admins
* Transfers (Week 8): the kitchen records the finished goods it sends from a commissary to a branch (`TRF-000001`) — the form shows what can be sent (on hand less what other documents have claimed), the lots each line will take, soonest to expire first, and their value at cost; accounting approves it, which dispatches it (the lots leave the commissary), and the receiving branch's manager counts what arrived, lot by lot: that joins the branch's stock — expiry and cost included — and anything short is recorded as lost in transit with a reason and its value at cost (a card on the transfer, a Short ₱X badge, filter and total on the list, accounting notified); the approvals inbox, notifications at each step and End of Day's Distributed column follow it. Branch managers see their own branch's transfers
* Branch Inventory (Week 8): each branch's own page — finished goods by good and lot (use first what expires first), raw materials, transfers on their way and awaiting approval, with a "Confirm what arrived" button for its manager — that updates itself within a second when its stock moves. Branch managers see only their own branch
* Costing dashboard (Week 8): week by week — what production cost (batches and the ingredients conversions added) and what was lost (write-offs by reason, transfer shortfalls), this week against last; the cost per kg of each finished good over time; the most expensive batches with their variance against plan. For management: admin, accounting, production and viewer
* Production Schedule: production orders on a month calendar by production date, with day totals, branch / closed-order filters and "+" to plan a run on a day
* Approvals inbox for accounting; nobody approves their own work, ADMIN included
* KitchenAI foundation (Week 9): the Claude API (Sonnet 5.5) behind one service that every AI feature uses — a monthly budget, refusal fallback, friendly errors and a log of every call with its estimated cost. Admin → AI Settings shows whether the key is set, each feature's model, this month's spend against the budget and the latest calls, with a Test connection button
* Cost Variance Explainer (Week 9, KitchenAI Feature 1): every completed production order shows why the batch cost what it did — cost per kg against the previous batch of the same good (or its plan, for the first), split into ingredient prices and usage / yield, each ingredient's part — and Claude's plain-language explanation of those figures, written automatically seconds after accounting approves the run ("Explain this batch" / "Try again" by hand)
* Dashboard assistant (Week 9, KitchenAI Feature 2): an "Ask KitchenAI" box on the Dashboard for admin, accounting and production — questions in English, Filipino or Taglish answered from the system's own data, with follow-ups. Cost questions use the Costing dashboard's own figures; anything else, Claude writes a read-only database query through a locked-down login, shown under "How I got this"
* Notification bell on every page: unread count and latest notifications, pushed live over Server-Sent Events (request submitted, daily jobs); mark one or all read

Planned (see the roadmap): raw-material write-offs and stock adjustments; the remaining five AI features (Weeks 9–10) and the assistant's write actions on top of the Week 9 foundation.

## Tech Stack

* Backend: Next.js 15 route handlers (App Router), TypeScript, Node.js 22
* Frontend: Next.js 15 (App Router), React 19, Tailwind CSS 4, `lucide-react` icons
* Database: PostgreSQL 16, accessed via Prisma ORM 5.22, with tracked migrations
* Queue: BullMQ on Redis 7, consumed by a separate worker process (`npm run worker`)
* PDF: `@react-pdf/renderer`, rendered in the request
* Validation: `zod`; auth: `jose` (JWT) + `bcryptjs`
* AI: Claude API via `@anthropic-ai/sdk` (model Claude Sonnet 5.5), optional `ANTHROPIC_API_KEY`
* Storage: not yet configured
* Infrastructure: Docker Compose (Postgres + Redis) for local development; GitHub Actions CI

## Project Structure

* `app/` — Next.js App Router pages and route handlers
  * `app/login/`, `app/unauthorized/`, `app/roadmap/` — outside the protected layout
  * `app/(protected)/` — authenticated route group: `dashboard/`, `procurement/` (`requests`, `orders`, `approvals`, `receiving`), `inventory/stock`, `inventory/finished-goods`, `inventory/ledger`, `inventory/write-offs`, `inventory/transfers`, `inventory/end-of-day`, `production/bom`, `production/orders`, `production/schedule`, `production/conversions`, `costing`, `admin/master`, `admin/ai`
  * `app/api/` — `auth/*`, `materials`, `finished-goods`, `categories`, `units`, `boms`, `purchase-requests`, `purchase-orders` (incl. `submit`, `send`, `pdf`), `approvals`, `receiving-reports`, `production-orders`, `conversion-orders` (incl. `preview`), `write-offs`, `branches` (incl. `deactivate`, `reactivate`), `transfers` (incl. `preview`, `[id]/receive`), `inventory/stream`, `notifications` (incl. `stream`, `read`), `ai/test`
* `components/` — `dashboard/` (Sidebar, Topbar, NotificationBell), `ai/` (`RecentAiCalls`, `TestConnection`, `AssistantCard`), `master/`, `inventory/` (`StockMap`, `StockTile`, `WriteOffForm`, `WriteOffReasonBadge`, `BranchHeadline`, `BranchTransfers`, transfer components), `bom/`, `production/` (`ProductionOrderForm`, `MaterialRequirementsTable`, `ShortageBanner`, `StatusTimeline`, `ScheduleCalendar`, `CompleteProductionOrder`, `CompletionReview`, `CompletionStock`, `CostingCard`, `CostVarianceCard`, `ExplainBatchButton`, `ConversionOrderForm`, `ConversionEffect`, `ConversionStock`), `procurement/` (forms, action buttons, `StatusBadge`, `DecisionHistory`, `ApprovalActions`), `pdf/`, `ui/` (`form.tsx`, `Modal.tsx`, `AutoRefresh.tsx`, `LiveRefresh.tsx`)
* `lib/` — cross-cutting helpers: `prisma.ts`, `config.ts`, `jwt.ts` (Edge-safe), `auth.ts` (Node-only), `session.ts`, `navigation.ts`, `queue.ts` (Node-only), `realtime.ts` (Node-only), `claude.ts` (Node-only), `decimal.ts`, `format.ts`, `dates.ts`
* `repositories/` — data-access layer, one per domain entity; the only code that imports Prisma
* `services/` — business rules above the repositories
* `worker/` — the BullMQ consumer, a standalone process; never imported from `app/`
* `scripts/` — command-line helpers (`run-job.ts`: `npm run job -- <name>`)
* `hooks/` — client-side React hooks (`useUser.ts`, `useNotifications.ts`)
* `prisma/` — `schema.prisma` (31 models), `migrations/`, `seed.ts`
* `middleware.ts` — authentication and role guards for every request
* `docker-compose.yml` — local Postgres + Redis services

## Coding Philosophy

* Keep solutions simple.
* Prefer existing patterns over introducing new ones.
* Minimize breaking changes.
* Maintain backward compatibility unless intentionally changed.
