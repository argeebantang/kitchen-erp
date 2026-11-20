# 2026-11-20 — AI query log (Week 9, Task 4)

Week 9 roadmap task "AI query log table: record every question, function called, and answer for audit — plus
action type, whether the user confirmed or cancelled, and the id of any document created". It builds on the
dashboard assistant (`docs/2026-11-19-week9-nl-query.md`).

What it gives:
- **Every question to the assistant is logged.** The log keeps who asked, the question, and the answer, or the
  exact error the user saw. It also keeps each lookup in order, with Claude's input, the SQL, the row count, and any
  database error. The rows a query returned are never stored.
- **Each question's Claude calls are grouped.** `AiCall` rows now point at their question, so rounds and cost per
  question are exact.
- **Admin → AI Settings → Assistant questions:** the log for admins.
  - newest first, 50 per page, filterable by who asked
  - each row expands to show the answer and the lookups
  - "Show this conversation" shows the follow-ups in the order they were asked

Built in subtasks 4.1–4.4. Tested end to end by Claude at the owner's request ("this is not a main feature").
Steps are in `docs/week9-task4-subtasks.xlsx` (not in git).

Also decided on 2026-11-20: the roadmap's other five named read functions (`get_waste_summary`,
`get_stock_levels`, `get_branch_performance`, `get_supplier_history`, `get_top_items`) are **skipped**. `run_query`
answers any question from the data, and fixed per-topic functions would only be worth adding to give branch or
procurement managers a scoped assistant. The roadmap and `progress.md` record this. The write actions are still
planned, next (Task 5), and log here from the start.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| H1 | New table `AiQuery` (the plan's `ai_query_log`), one row per question. It is created `PENDING` before Claude is called, then finished once as `ANSWERED` or `FAILED` | Each round's `AiCall` can point at it as it's recorded, including when a question fails partway. A row left `PENDING` means the server stopped mid-question |
| H2 | Each tool call in order: tool, Claude's input (JSON text), label, SQL, row count, cut off or not, or the error Claude got. Not the rows returned | Rows can be large and can hold data from any table. The SQL can be re-run |
| H3 | `AiCall.aiQueryId` (nullable). Rounds, tokens and cost per question are **summed from those calls**, not copied into `AiQuery` | A single source of truth: the log and the cost records cannot disagree. This fixes the Task 3 gap "the rounds of one question are not grouped" |
| H4 | A conversation id groups follow-ups. **The server issues it** with the first answer, and the card sends it back; "New conversation" clears it | The browser's `crypto.randomUUID()` works only over HTTPS or localhost, so a tablet opening `http://192.168.x.x` would break |
| H5 | The action columns (action type, confirmed or cancelled, created document id) are **not added yet** | Nothing would fill them. The write-actions task (Task 5) adds them in its own migration |
| H6 | If the log can't be written or finished, the user still gets the answer and the failure goes to the server log | A broken log must not block the assistant |
| H7 | ADMIN only: `/admin/ai/questions`, linked from AI Settings. No history page for users yet | People's questions are sensitive. Admins audit them |
| H8 | `kitchen_ai_reader` gets no grant on `AiQuery` | The assistant cannot read what other people asked it |
| H9 | No test data created. The questions asked during testing are real history, kept like `AiCall` rows | — |

## What changed

- *4.1 The table.*
  - Migration `20261120090000_ai_query_log` (see Database).
  - `repositories/ai-query.repository.ts` (new):
    - `start()`
    - `finish()`: PENDING → ANSWERED or FAILED, once; `WHERE status = PENDING`
  - `AiCallRepository.record` takes `aiQueryId`.
- *4.2 Logging.*
  - `AssistantService.ask(messages, viewer, conversationId)`:
    - logs the question, then every tool call as it runs (unknown tool, invalid input, database refusal or result)
    - finishes the row with the answer or the error and the duration
    - `startLog` / `finishLog` catch their own failures (H6)
  - `AiService.converse()` / `round()` pass `aiQueryId` to each round's `AiCall`.
  - Route: optional `conversationId` (uuid or null). The answer carries `conversationId`.
  - `AssistantCard` keeps the id, sends it back with follow-ups, and clears it on "New conversation".
- *4.3 The admin page.*
  - `app/(protected)/admin/ai/questions/page.tsx` (new, Server Component).
  - `services/ai-query.service.ts` (new):
    - `AiQueryService.list` builds the page's rows; cost is a string
    - the lookups JSON is checked with zod on the way out, so a malformed row shows no lookups instead of breaking
      the page
  - Repository:
    - `list`: one page and the count, in one transaction
    - `callTotals`: one `groupBy` over `AiCall` per page
    - `askers`
  - AI Settings links to it.
- *4.4 Docs.* This note; `progress.md`; `database.md`, `api.md`, `architecture.md`, `overview.md`; the roadmap.

## Database

Migration `20261120090000_ai_query_log`, additive only:
- Enum `AiQueryStatus` (`PENDING`, `ANSWERED`, `FAILED`).
- Table `AiQuery`:
  - `userId` → `User`, `conversationId`, `question`, `status` (default PENDING)
  - `answer?`, `error?`, `lookups` (JSONB, default `[]`), `durationMs?`
  - `createdAt`, `updatedAt`
- Indexes on `AiQuery`: `(createdAt)`, `(userId, createdAt)` and `(conversationId)`.
- `AiCall.aiQueryId`: nullable, FK `ON DELETE SET NULL`, indexed.
- No grant to `kitchen_ai_reader`.

32 models. No existing data is touched. Existing `AiCall` rows keep `aiQueryId` null.

## API

No new endpoint. `POST /api/ai/assistant`:
- Body: adds optional `conversationId`, a uuid or null (null or missing = a new conversation). Anything else is a
  400.
- 200: adds `conversationId`, to send back with the next question.

## UI

- Admin → AI Settings: an "Assistant questions →" link above Latest calls.
- `/admin/ai/questions`:
  - Each row shows the status, the question, who asked and when, the number of lookups, cost, rounds and seconds.
  - Expanding a row shows the answer or the error shown to the user, each lookup (tool, label, rows, error, SQL or
    input), and a link to its conversation.
  - Filter by who asked. One conversation is shown in the order asked.
  - 50 per page.
- Dashboard: no visible change. The card now keeps the conversation id.

## Configuration

None. Restart `npm run dev` after deploying, for the regenerated Prisma client.

## How to verify

1. As accounting, ask "How many users do we have?" and then "and how many of them are managers?".
2. As admin, open AI Settings, then Assistant questions. Both questions are there, answered, each with 2 rounds and
   its cost. Expand one to see the answer and the SQL.
3. Click "Show this conversation": both questions, in the order asked.
4. Other roles opening `/admin/ai/questions` are sent to `/unauthorized`.

What was checked (Claude, at the owner's request):
- Migration, no drift. `kitchen_ai_reader` is denied on `AiQuery`.
- 5 real questions:
  - two in one conversation, with the same id
  - a new conversation, with a new id
  - a forced `SELECT email`, logged with "permission denied for table User"
  - one with no API key, `FAILED` with the message the user saw and 0 rounds
- A malformed `conversationId` returns 400.
- Every question's rounds are linked. No recent assistant `AiCall` is left unlinked.
- The log was made to fail on purpose: the answer still came back, the `AiCall` was still recorded with no link,
  and the error went to the server log.
- The page:
  - rows and costs match the database
  - the user filter, the conversation view and malformed parameters behave as intended
  - paging was checked 2 per page
  - five other roles were refused
- `tsc`, lint.

## Risks, assumptions, follow-ups

- **The log keeps what people typed**, including anything sensitive they put in a question. Only admins can read
  it. There is no retention limit yet; add one if the owner wants questions deleted after some months.
- If the first question of a conversation fails, the page gets no id back. The retry starts a new conversation id,
  so the failed question sits alone in the log.
- A server stop mid-question leaves the row `PENDING` for good. The page says so. A cleanup job could mark old
  `PENDING` rows `FAILED`.
- Write actions (Task 5) add their columns (action type, confirmed or cancelled, created document id) in their
  own migration.
