# 2026-11-24 — QR transfer labels, the Receive screen and phone receiving

Owner request, 2026-11-24: "I want a QR — stock transfers" (with a sample of a phone scanning a box label), then
"QR is optional, it can also do manual input in phone". Week 12, not a roadmap item of its own.

## In plain words

- **Print a label for the box.** An in-transit transfer has **Print label**. It's an A6 PDF with:
  - the number, large
  - DELIVERY or RETURN
  - FROM and TO
  - a QR code
  - what is inside, down to each lot and its use-by time
  - "No signal or scanner: open Receive and type TRF-000261"
- **Receive** (new, under Inventory) lists what is on its way to you, oldest first. Each card has **Count what
  arrived**. You can also:
  - **Scan a label:** the camera opens, reads the QR and jumps to that transfer's count form.
  - **Type the number:** `261` is enough.
- **Phones work.**
  - Below tablet width the sidebar is a drawer behind ☰.
  - The count form shows one card per lot with a big input.
  - Inputs are 16px, so iPhones don't zoom in on them.
- **Counting feels like an app** (owner: "it doesn't feel native — even the receiving part, the field for
  confirming the qty"):
  - each lot starts as **✓ All arrived**, and only a short one is opened with **Report short**, which gives
    **− / +** (0.1 kg steps) or typing, and **All arrived** to undo;
  - the reasons are four big buttons, not a dropdown;
  - a bar pinned to the bottom shows "All 3 lots arrived" or "1 lot short · ≈ ₱120 lost" next to **Confirm**;
  - confirming is a **bottom sheet** with the summary, not the browser's "localhost says…" box, and so is the
    result: **✓ Received**, with **Back to Receive** and a short vibration on Android.
  - On desktop the table stays; it gets the same sheet and reason buttons.
- **A phone camera works too.** The QR is a normal link. Signed out, it goes to the login page and then back to the
  transfer, not the dashboard.
- Supplier receiving is unchanged: no QR. The supplier brings their own invoice, and nothing we print travels with
  their goods.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| Q1 | **QR for stock transfers only** (deliveries TRF- and returns RTN-) | The owner: QR is not needed when receiving from a supplier |
| Q2 | **The QR is optional.** Every transfer can be found and counted on a phone without one | The owner: "it also can do manual input in phone". Labels get lost, scuffed or never printed |
| Q3 | **No separate app.** The same Next.js app, made to work at phone width | One codebase, one login, and one copy of the receipt rules (in the service). The API is already the boundary if a native app is ever needed |
| Q4 | **The QR holds the transfer page as a full link** (`absoluteUrl`, `NEXT_PUBLIC_APP_URL`) | The in-app scanner reads it, and any phone camera still opens it |
| Q5 | **The scanner accepts only this app's `/inventory/transfers/<id>` links, and opens that path itself** | A QR cannot send anyone to another site. A label printed with another address of this app (a tunnel, localhost) still works |
| Q6 | **Labels only while in transit (APPROVED)** | Before approval nothing has left and the lots can still change. After receipt the label has done its job |
| Q7 | **A6, no money on it** | Fits a label printer or four to an A4 sheet. The value of a box doesn't belong on its outside |
| Q8 | **`?next=` on /login, only for a path on this app** | A scanned label or an emailed link lands where it pointed after sign-in. Only same-app paths, so the parameter can't be used to send someone to another site |
| Q9 | **Lot scanning while packing (the "FIFO not followed" warning) is the next task** | It needs lot labels printed when production finishes |

## What changed

**Receive screen and scanner**
- `app/(protected)/inventory/receive/page.tsx` (new): the Receive page.
- `components/inventory/TransferScanner.tsx` (new): the camera scanner.
- `lib/transfer-qr.ts` (new): what a scanned code means.
- `StockTransferService.listReceivable` and `StockTransferRepository.findInTransit`:
  - same rule as `mayReceive`: a branch manager sees their branch, production sees returns, an admin sees all;
  - the in-transit mapping is now shared with Branch Inventory (`toInTransit`).
- `middleware.ts`: guard for `/inventory/receive`. `lib/navigation.ts`: sidebar item **Receive**.

**Label**
- `app/api/transfers/[id]/label/route.tsx` and `components/pdf/TransferLabelDocument.tsx` (new).
- `StockTransferService.getForLabel`.
- `lib/qr.ts` (new).
- `lib/app-url.ts` (new; `absoluteUrl` moved here from `email.service.ts`).
- **Print label** button on `/inventory/transfers/[id]`.

**Phone layout**
- `components/dashboard/AppShell.tsx` (new): holds the drawer's open state.
- `Sidebar.tsx`: drawer below `md`; collapse is a desktop setting.
- `Topbar.tsx`: ☰ button.
- `app/(protected)/layout.tsx`: uses `AppShell`.
- `TransferReceiptForm.tsx`: below `sm`, a card per lot (All arrived / Report short, − / + steppers), reason
  buttons, and a sticky bottom bar. Everywhere, confirm and the result are bottom sheets instead of `window.confirm`.
  The validation and the request are unchanged.
- `components/ui/BottomSheet.tsx` (new): slides up on a phone, a centred dialog from `sm` up.
- `components/ui/form.tsx`: `inputClass` is `text-base sm:text-sm`, which affects every form.

**Sign-in**
- `lib/safe-next.ts` (new).
- `middleware.ts`: a signed-out page visit goes to `/login?next=…`.
- `app/login/page.tsx`: follows `next`.
- `app/page.tsx`: was still the create-next-app template; now redirects to `/dashboard`.

**Fixed on the way**
- `components/ui/form.tsx` was `'use client'`. Server pages that imported its class strings got a client-reference
  stub, so **every `EmptyState` button on a server page rendered `class="… function() { throw …"`** (from Week 12
  Task 2). The directive is gone; nothing in the file needs it.
- The transfers list shows "for STR-…" under a transfer sent from a stock request. The search matched the request
  number with no sign of it on the row.
- No word hyphenation in any PDF. react-pdf was splitting "Kitchen-ERP" and names.
  - `components/pdf/setup.ts`, applied by the PO and label documents and by `lib/report-pdf.ts`.

**Database:** none.

**API:**
- New: `GET /api/transfers/[id]/label`.
- `POST /api/auth/login` is unchanged; the page now honours `?next=`.

**Configuration:**
- New dependencies: `qrcode` 1.5.4 (and `@types/qrcode`), `qr-scanner` 1.4.2.
- `NEXT_PUBLIC_APP_URL` is now printed into labels, so in production it must be the public https address.

## How to test

Test data used: TRF-000261, Main Commissary → Makati Outlet, in transit; Makati's manager is
`jun.mercado@history.kitchen.com` / `password123`. It was removed at the end of the task, so to test again, record a
delivery to Makati and have accounting approve it.

1. **Label:** as `production@kitchen.com`, open the transfer and click **Print label**. The PDF opens. A received or
   pending transfer has no button; as accounting there is no button.
2. **Receive screen:** as the Makati manager, at phone width (DevTools → iPhone SE):
   1. ☰ → **Receive**: only Makati's transfers.
   2. Type the number: the list narrows. `999` shows "Nothing on its way matches" and **Search all transfers**.
   3. As production you see only returns, as admin everything, and as accounting the page is Unauthorized.
3. **Count on a phone:** **Count what arrived** opens a card per lot. Changing a number shows the short amount and
   its value, and asks for a reason.
4. **Scanner (webcam works on localhost):**
   1. **Scan a label** and show it the label. It opens the count form.
   2. Any other QR shows "not a KitchenERP transfer label".
   3. Blocking the camera shows a message, and the search still works.
5. **Signed out:** open a transfer link, sign in, and you land on the transfer. `/` lands on the dashboard.
6. **Phone over https:** see "Testing on a phone" below.

What I checked:
- type-check and lint;
- each role on the Receive page and the label route (200 / 403 / 404 / 409);
- the label rendered and looked at, and its QR decoded back to the transfer link;
- the PO PDF, a report PDF, and a report PDF rendered the worker's way (tsx, `import()`);
- `transferPathFromQr` and `safeNextPath` against hostile values (`//evil.example`, `https://…`, `javascript:`);
- the scanner bundled as its own chunk, loaded on first use.

The owner tested the phone flow through a Cloudflare quick tunnel.

## Testing on a phone

The camera needs https, and a phone cannot reach `localhost` inside WSL. Use a Cloudflare quick tunnel:
1. Run `~/bin/cloudflared tunnel --url http://localhost:3000`. It prints `https://<random>.trycloudflare.com`.
2. Optional, so a phone **camera app** can open new labels: set `NEXT_PUBLIC_APP_URL` to that address and restart
   `npm run dev`. The in-app scanner accepts labels printed with either address.
3. When done: press Ctrl+C on the tunnel and put `.env` back to `http://localhost:3000`.

While the tunnel runs, **anyone with the link can reach the dev app**, including its quick-login buttons.

## Risks and follow-ups

- **`NEXT_PUBLIC_APP_URL` is printed on paper.** If the address changes after deploy, labels already on boxes point
  at the old one. They are short-lived, so this is low risk.
- **`npm audit`** lists 16 advisories (Next.js, PostCSS, sharp, zod, exceljs, typescript-eslint…). None come from
  this task's packages. Worth a separate task before deploy.
- **`qr-scanner` 1.4.2 dates from 2022.** It works and is MIT, and it uses the browser's `BarcodeDetector` where it
  exists. If it ever breaks, `@zxing/browser` can replace it behind `TransferScanner`.
- **Next task:** lot labels at production completion and a scan-while-packing check (soonest expiry first).
