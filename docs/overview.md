# Project Overview

## Purpose

KitchenERP is a production and inventory management system for a food kitchen/commissary operation with multiple branches. It manages the full lifecycle from raw material procurement through production and distribution: Purchase Requests → Purchase Orders → Receiving Reports → stock updates, BOM-driven production of finished goods, inter-branch stock transfers, and conversions of unsold goods into other products. It solves the business problem of tracking inventory accurately across locations, enforcing approval workflows for spend and stock movement, and giving management visibility into costs and stock levels without relying on manual spreadsheets.

## Main Features

* Role-based authentication (Admin, Procurement Manager, Production Manager, Branch Manager, Viewer) with protected routes
* Item master data: materials, finished goods, categories, and units
* Bill of Materials (BOM) for finished goods, driving raw-material requirements for production
* Procurement workflow: Purchase Request → Purchase Order → Receiving Report, each with its own status lifecycle and an approval step
* Production Orders that consume materials per BOM and yield finished goods, tracked through a status lifecycle
* Inventory tracking via per-branch inventory levels and an auditable stock movement ledger
* Stock Transfers between branches
* Conversions (e.g., turning unsold finished goods into another product)
* Centralized Approval records for procurement and production actions

## Tech Stack

* Backend: Next.js 15 API routes (App Router), TypeScript, Node.js
* Frontend: Next.js 15 (App Router), React 19, Tailwind CSS 4
* Database: PostgreSQL 16, accessed via Prisma ORM 5
* Cache: Redis 7 (ioredis)
* Queue: BullMQ (Redis-backed)
* Storage: Not yet configured
* Infrastructure: Docker Compose (Postgres + Redis) for local development

## Project Structure

* `app/` — Next.js App Router pages and API routes
  * `app/login/` — public login page
  * `app/(protected)/` — authenticated route group (layout enforces session/role checks); contains `dashboard/`
  * `app/api/auth/` — authentication endpoints (login, logout, register, me)
* `components/` — shared React components (e.g., `components/dashboard/Sidebar.tsx`)
* `lib/` — cross-cutting utilities: `auth.ts`, `session.ts`, `config.ts`, `prisma.ts` (Prisma client singleton), `navigation.ts`
* `repositories/` — data-access layer, one repository per domain entity (e.g., `user.repository.ts`), wrapping Prisma queries
* `services/` — business-logic layer sitting above repositories (e.g., `auth.service.ts`)
* `hooks/` — client-side React hooks (e.g., `useUser.ts`)
* `prisma/` — `schema.prisma` (22 models covering users, branches, items, BOM, procurement, production, inventory, and approvals) and `seed.ts`
* `middleware.ts` — request-level route protection
* `docker-compose.yml` — local Postgres + Redis services

## Coding Philosophy

* Keep solutions simple.
* Prefer existing patterns over introducing new ones.
* Minimize breaking changes.
* Maintain backward compatibility unless intentionally changed.
