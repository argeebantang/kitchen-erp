import { useState } from "react";

const COLORS = {
  green: "#4DB896",
  blue: "#5BA3E8",
  pink: "#E86B8A",
  purple: "#9B7FE8",
  dim: "#555C7A",
  border: "#1C2030",
  card: "#0D0F16",
  bg: "#0A0C10",
  text: "#DDE1F0",
  muted: "#8B93B0",
  faint: "#6B7399",
};

const plan = {
  meta: {
    name: "KitchenERP",
    subtitle: "Production & Inventory Management System + AI Insights",
    stack: ["Next.js 15", "TypeScript", "Node.js", "Prisma", "PostgreSQL", "BullMQ", "Docker", "AWS", "Claude API"],
    duration: "12 weeks",
  },
  phases: [
    {
      id: "phase1",
      num: "01",
      title: "Foundation & Procurement",
      weeks: "Weeks 1–4",
      color: COLORS.green,
      focus: "Set up the project, database, auth, and the full PR → PO → RR procurement flow with approval workflows.",
      weeks_detail: [
        {
          week: "Week 1",
          status: "done",
          title: "Project Setup & Database Schema",
          tag: null,
          tasks: [
            { t: "Initialize Next.js 15 + TypeScript monorepo", done: true },
            { t: "Full Prisma schema: 22 tables covering all modules including costing and AI log",
              partial: "22 core tables exist; costing + AI tables not built yet (26 planned)" },
            { t: "Docker Compose: PostgreSQL + Redis", done: true },
            { t: "GitHub repo + GitHub Actions CI pipeline", done: true },
            { t: "JWT auth with 5 roles: Admin, Accounting Approver, Warehouse Staff, Kitchen Supervisor, Branch Manager",
              partial: "5 roles ship, but as ADMIN / PROCUREMENT_MANAGER / PRODUCTION_MANAGER / BRANCH_MANAGER / VIEWER — no Accounting Approver. Blocks Week 3 approval flow." },
            { t: "Login page + protected route middleware per role", done: true },
            { t: "Seed script with real items: all wet, dry, finished goods from Lydia's list",
              partial: "19 materials seeded, but invented for testing — not sourced from Lydia's list" },
          ],
          deliverable: "Running app with login, roles, and full DB schema. Sign in as different roles and see different dashboards.",
        },
        {
          week: "Week 2",
          status: "done",
          title: "Item Master & Bill of Materials",
          tag: null,
          tasks: [
            { t: "Item Master CRUD: name, category (Wet/Dry/Finished Good/Packaging), unit, reorder point",
              partial: "CRUD complete at /admin/master. Categories are Meat & Offal / Produce / Seasonings / Cooked Dishes — no Wet/Dry split." },
            { t: "Unit price per item with effective_date for historical costing accuracy", done: true },
            { t: "BOM module: create finished goods with ingredient lines per batch weight", done: true },
            { t: "BOM scaled viewer: enter batch weight → auto-calculate all ingredient quantities", done: true },
            { t: "BOM version history — old recipes archived not deleted", done: true },
            { t: "Seed real BOMs: Dinuguan (18 ingredients), Lechon Paksiw, Bopis",
              partial: "All three seeded, but Dinuguan has 11 ingredients, not 18" },
          ],
          deliverable: "Type '207.6kg batch of Dinuguan' and see all 18 ingredients with exact quantities calculated automatically.",
        },
        {
          week: "Week 3",
          status: "next",
          title: "Purchase Request & Purchase Order",
          tag: null,
          tasks: [
            "PR form: items + quantities + urgency + notes",
            "PR status flow: Draft → Pending Approval → Approved → Rejected",
            "Accounting approver inbox: see all pending PRs, approve or reject with comment",
            "BullMQ notification job when new PR is submitted",
            "On PR approval: auto-generate PO draft",
            "PO form: supplier name, unit prices, expected delivery date",
            "PO approval by accounting",
            "PO PDF export via Puppeteer",
          ],
          deliverable: "Full PR → PO flow. Staff submits → approver notified → approves → PDF generated.",
        },
        {
          week: "Week 4",
          title: "Receiving Report & Stock Update",
          tag: null,
          tasks: [
            "RR form: linked to approved PO, actual received quantities per line",
            "Variance detection: flag when received differs from ordered",
            "RR approval by accounting",
            "On RR approval: inventory_ledger entry written, stock levels updated",
            "Every movement writes to inventory_ledger with source document reference",
            "Current stock dashboard: visual map view — branches/storage locations as a color-coded grid (🟢 healthy / 🟡 low / 🔴 stockout risk) — plus quantities on hand and reorder alerts",
            "BullMQ daily low-stock check job",
          ],
          deliverable: "Complete PR → PO → RR → Stock. Receive a delivery and inventory updates in real time on the color-coded stock map, with full ledger trail.",
        },
      ],
    },
    {
      id: "phase2",
      num: "02",
      title: "Production & Finished Goods",
      weeks: "Weeks 5–8",
      color: COLORS.blue,
      focus: "BOM-driven production orders, finished goods tracking, conversion workflows, branch distribution, and basic costing.",
      weeks_detail: [
        {
          week: "Week 5",
          title: "Production Order Creation",
          tag: null,
          tasks: [
            "Production Order form: finished good, batch weight, batches, production date",
            "Auto-calculate required raw materials from BOM",
            "Stock sufficiency check: required vs available per ingredient",
            "Shortage alert: flag exactly which ingredients are insufficient",
            "Production Order approval by accounting",
            "Status flow: Draft → Pending → Approved → In Progress → Completed",
            "Production schedule calendar view",
          ],
          deliverable: "Create a Dinuguan production order. System shows all ingredients needed, flags shortages, sends for approval.",
        },
        {
          week: "Week 6",
          title: "Production Execution & Basic Costing",
          tag: "costing",
          tasks: [
            "Kitchen supervisor marks production as In Progress → Completed",
            "On completion: raw materials deducted per BOM, finished goods added to stock",
            "Batch number, production date, expiry date assigned to finished goods",
            "Actual yield recorded vs planned yield",
            "COSTING: compute total batch cost = sum of (ingredient qty × unit price on production date)",
            "COSTING: compute cost per kg = total cost ÷ actual yield",
            "COSTING: planned vs actual cost variance recorded",
            "Accounting approves completion",
          ],
          deliverable: "Complete a Dinuguan run. Raw materials drop, finished goods appear. System shows it cost ₱4,250 to make 103.8kg — ₱40.94/kg.",
        },
        {
          week: "Week 7",
          title: "Conversion, Write-off & Expiry",
          tag: "costing",
          tasks: [
            "Conversion order: unsold lechon → lechon paksiw with conversion BOM",
            "COSTING: record conversion cost from added ingredients",
            "Conversion approval by accounting",
            "Write-off workflow: items that cannot be converted",
            "COSTING: write-off cost = quantity × unit cost of finished good",
            "Write-off approval by accounting",
            "Expiry tracking: flag items 24/48 hours before expiry",
            "End-of-day reconciliation: produced, distributed, converted, written-off",
          ],
          deliverable: "Convert unsold lechon to paksiw in 3 clicks. System tracks the cost of the conversion. Write-offs logged with peso value impact.",
        },
        {
          week: "Week 8",
          title: "Branch Distribution & Costing Dashboard",
          tag: "costing",
          tasks: [
            "Branch management: create and manage branch profiles",
            "Transfer Order: kitchen selects finished goods + quantities to send",
            "Transfer approval by accounting, branch confirms receipt",
            "Transfer variance logging",
            "Each branch has own real-time inventory view",
            "COSTING DASHBOARD: cost per finished good over time, most expensive batches, write-off cost impact per week, weekly cost trend chart",
          ],
          deliverable: "Send goods to branches. Management opens costing dashboard and sees total production cost this week, which batches were most expensive, and how much was lost to write-offs.",
        },
      ],
    },
    {
      id: "phase3",
      num: "03",
      title: "KitchenAI + Reports + Deploy",
      weeks: "Weeks 9–12",
      color: COLORS.purple,
      focus: "The AI intelligence layer — 7 features using Claude API with function calling, including write actions and what-if simulation. Then reports, polish, and deployment.",
      weeks_detail: [
        {
          week: "Week 9",
          title: "KitchenAI — Core Intelligence",
          tag: "ai",
          tasks: [
            "Set up Claude API integration in the backend (Anthropic SDK)",
            "FEATURE 1 — Cost Variance Explainer: after every production order closes, Claude auto-generates a plain-language explanation of why the cost was higher or lower than last batch. Stored in DB, shown on production order detail page.",
            "FEATURE 2 — Natural Language Query & Actions: chat box on dashboard. User types any question. Claude uses function calling to decide which DB query to run, executes it, formats the answer. Example: 'Magkano ang gastos namin ngayong buwan?' → Claude calls get_production_costs({period: 'this_month'}) → answers in Filipino.",
            "Define 6 read functions for the NL query: get_production_costs, get_waste_summary, get_stock_levels, get_branch_performance, get_supplier_history, get_top_items",
            "AI WRITE ACTIONS: 2 action functions — create_purchase_request, create_production_order — so the assistant can act, not just answer. Confirm-before-execute: Claude returns a filled draft, the user reviews and presses Confirm, and the document is created under that user's identity and enters the normal approval flow. Never auto-executed, never bypasses an approval step.",
            "AI query log table: record every question, function called, and answer for audit — plus action type, whether the user confirmed or cancelled, and the id of any document created",
            "Loading state + streaming response UI for natural language query",
          ],
          deliverable: "Ask the dashboard in plain Filipino/English: 'Which branch wasted the most this week?' and get a real answer pulled from your actual database in under 3 seconds. Then say 'mag-order ng 150kg na pork belly' and it drafts the purchase request for you to confirm.",
        },
        {
          week: "Week 10",
          title: "KitchenAI — Predictive Features",
          tag: "ai",
          tasks: [
            "FEATURE 3 — Waste Pattern Detector: BullMQ weekly job that sends last 30 days of write-off data to Claude. Claude identifies patterns per branch per item and writes actionable recommendations. Shown on head office dashboard.",
            "FEATURE 4 — Reorder Recommender: when stock drops below reorder point, instead of just alerting, Claude analyzes average daily consumption + supplier lead time + upcoming production orders and recommends exact order quantity and deadline. Surfaces inline when a 🟡/🔴 location is clicked on the Week 4 stock map, with a 'Create Purchase Order' button that applies the recommendation directly.",
            "FEATURE 5 — Demand Forecaster: kitchen supervisor opens production planning screen. Claude looks at historical production by day of week and upcoming calendar (holidays) and suggests how many batches to produce today.",
            "FEATURE 6 — Supplier Performance Analyzer: Claude reviews all RR variance data per supplier and generates a supplier reliability report monthly. Flags suppliers with consistent short deliveries.",
            "FEATURE 7 — Decision Simulator: what-if panel on the production planning and costing screens. User sets a hypothetical ('run 5 batches of Dinuguan and 3 of Bopis tomorrow') and the system simulates it against live BOM, stock and price data — which ingredients fall short and by how much, total batch cost, resulting cost per kg, and the stock position after the run. Claude explains the outcome and recommends an adjustment. Read-only: nothing is written to inventory, but an accepted scenario can be handed straight to a real Production Order.",
            "All AI features are clearly labeled with an AI badge in the UI",
            "Each insight has a 'Regenerate' button so users can refresh the analysis",
          ],
          deliverable: "Head office dashboard shows 7 live AI insights — waste patterns, reorder suggestions, demand forecasts, supplier flags. All generated from real system data, with reorder suggestions clickable straight from the stock map. Simulate tomorrow's production before committing to it.",
        },
        {
          week: "Week 11",
          title: "Approvals Hub & Reports",
          tag: null,
          tasks: [
            "Unified approvals inbox: all pending PRs, POs, RRs, Production Orders, Conversions, Write-offs in one queue",
            "One-click approve/reject with comment",
            "In-app notification bell + email via Resend",
            "Escalation job: re-notify approver if pending 24+ hours",
            "5 reports with CSV + PDF export: Inventory Movement, Production Summary, Procurement, Waste & Write-off, Cost per Batch",
            "End-of-day branch snapshot report",
            "Report scheduler: auto-email weekly summary to management every Monday",
          ],
          deliverable: "Accounting approver clears 5 pending items in 2 minutes from one screen. Generate and email a full week production report as PDF.",
        },
        {
          week: "Week 12",
          title: "Deploy, Polish & Portfolio",
          tag: null,
          tasks: [
            "Deploy to AWS: EC2 for API, RDS for PostgreSQL, S3 for file storage",
            "GitHub Actions CI/CD: test → build → deploy on merge to main",
            "PWA setup: installable on mobile with offline indicator",
            "UI polish: loading states, empty states, error states on every screen",
            "Realistic seed data: 3 branches, 30 days of production history, real item names and prices",
            "README: setup guide, architecture diagram, module overview, screenshots",
            "Loom video: 5-minute walkthrough — show the AI features prominently",
            "LinkedIn post with demo video and GitHub link",
          ],
          deliverable: "Live system on a real URL. Fully seeded with realistic data. Portfolio-ready with demo video. AI features are the headline of your walkthrough.",
        },
      ],
    },
  ],
  ai_features: [
    { num: "01", name: "Cost Variance Explainer", when: "Auto — after every production run", how: "Claude reads cost data → writes plain-language explanation", api: "Claude API — text generation", wow: "Appears automatically. No one had to ask." },
    { num: "02", name: "Natural Language Query & Actions", when: "On demand — chat box on dashboard", how: "User asks or instructs → Claude picks function → queries DB or drafts a document → user confirms any write", api: "Claude API — function calling (agent), read + write tools", wow: "Works in Filipino. Answers from real data — and drafts the PR for you to confirm." },
    { num: "03", name: "Waste Pattern Detector", when: "Auto — weekly BullMQ job", how: "30 days of write-off data → Claude finds patterns → recommendations", api: "Claude API — data analysis prompt", wow: "'Branch 3 wastes 8kg paksiw every Friday.'" },
    { num: "04", name: "Reorder Recommender", when: "Auto — triggered on low stock alert", how: "Consumption rate + lead time + upcoming orders → Claude suggests qty, shown on the visual stock map", api: "Claude API — structured output", wow: "Not just 'low stock' — click the red tile on the map and see exactly how much to order and by when." },
    { num: "05", name: "Demand Forecaster", when: "On demand — production planning screen", how: "Historical production by weekday + calendar → Claude suggests batches", api: "Claude API — reasoning prompt", wow: "'It's a holiday Monday — suggest 5 batches instead of 3.'" },
    { num: "06", name: "Supplier Analyzer", when: "Auto — monthly BullMQ job", how: "All RR variances per supplier → Claude generates reliability report", api: "Claude API — report generation", wow: "Catches suppliers who consistently short-deliver before it becomes a crisis." },
    { num: "07", name: "Decision Simulator", when: "On demand — what-if panel on production planning", how: "Hypothetical batch plan → simulated against live BOM, stock and prices → Claude explains the outcome and recommends an adjustment", api: "Claude API — reasoning over structured simulation output", wow: "'Run 5 batches tomorrow?' → 'You'll be 12kg short on pork blood and it costs ₱21,300. Order today or drop to 4 batches.'" },
  ],
  schema_additions: [
    { name: "item_prices", desc: "id, item_id, price_per_unit, effective_date, created_by", tag: "costing" },
    { name: "production_actuals", desc: "id, production_order_id, actual_yield, actual_cost, cost_per_unit, cost_variance, completed_by", tag: "costing" },
    { name: "conversion_orders", desc: "id, source_item_id, source_qty, output_item_id, output_qty, conversion_cost, status, approved_by", tag: "costing" },
    { name: "writeoffs", desc: "id, item_id, location_id, quantity, unit_cost, total_cost, reason, approved_by", tag: "costing" },
    { name: "ai_insights", desc: "id, type, reference_id, reference_type, prompt_used, response, generated_at", tag: "ai" },
    { name: "ai_query_log", desc: "id, user_id, question, function_called, function_args, answer, action_type, confirmed, created_document_id, created_at", tag: "ai" },
  ],
};

const STATUS = {
  done:    { color: "#4DB896", label: "Done",        mark: "✓" },
  next:    { color: "#5BA3E8", label: "Next up",     mark: "→" },
};

// Progress is derived from the per-week `status` fields rather than stored as a
// separate count, so the two can never disagree.
const ALL_WEEKS = plan.phases.flatMap(p => p.weeks_detail);
const DONE_COUNT = ALL_WEEKS.filter(w => w.status === "done").length;

const TASK_STATE = {
  done:    { color: "#4DB896", mark: "✓" },
  partial: { color: "#E8B45B", mark: "–" },
};

// Tasks are either a plain string (not started) or { t, done } / { t, partial }.
// Normalising here keeps every other week's string list working untouched.
function readTask(task) {
  if (typeof task === "string") return { text: task, state: null, note: null };
  return {
    text:  task.t,
    state: task.done ? "done" : task.partial ? "partial" : null,
    note:  task.partial || null,
  };
}

function taskCounts(tasks) {
  const r = tasks.map(readTask);
  return {
    done:    r.filter(x => x.state === "done").length,
    partial: r.filter(x => x.state === "partial").length,
  };
}

function phaseProgress(phase) {
  return phase.weeks_detail.filter(w => w.status === "done").length;
}

function StatusBadge({ status }) {
  const s = STATUS[status];
  if (!s) return null;
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 10,
      background: s.color + "22", color: s.color, border: `1px solid ${s.color}44`,
      fontFamily: "monospace", marginLeft: 6, whiteSpace: "nowrap",
    }}>
      {s.mark} {s.label}
    </span>
  );
}

function Tag({ type }) {
  const styles = {
    ai: { bg: "#9B7FE822", color: "#9B7FE8", border: "#9B7FE844", label: "AI" },
    costing: { bg: "#E86B8A22", color: "#E86B8A", border: "#E86B8A44", label: "Costing" },
  };
  if (!type || !styles[type]) return null;
  const s = styles[type];
  return (
    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontFamily: "monospace", marginLeft: 6 }}>
      {s.label}
    </span>
  );
}

export default function App() {
  const [activePhase, setActivePhase] = useState("phase1");
  const [activeWeek, setActiveWeek] = useState(0);
  const [tab, setTab] = useState("sprint");
  const phase = plan.phases.find(p => p.id === activePhase);
  const week = phase.weeks_detail[activeWeek];

  return (
    <div style={{ fontFamily: "'DM Sans','Segoe UI',sans-serif", background: COLORS.bg, color: COLORS.text, minHeight: "100vh", fontSize: 14 }}>

      {/* Header */}
      <div style={{ background: COLORS.card, borderBottom: `1px solid ${COLORS.border}`, padding: "1rem 1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>🍖 KitchenERP</div>
          <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 20, background: COLORS.green + "22", color: COLORS.green, border: `1px solid ${COLORS.green}44`, fontFamily: "monospace" }}>Final Plan v3</span>
          <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 20, background: COLORS.purple + "22", color: COLORS.purple, border: `1px solid ${COLORS.purple}44`, fontFamily: "monospace" }}>+ KitchenAI</span>
        </div>
        <div style={{ fontSize: 12, color: COLORS.dim, marginBottom: 8 }}>{plan.meta.subtitle} · {plan.meta.duration}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
          {plan.meta.stack.map(s => (
            <span key={s} style={{ fontSize: 11, fontFamily: "monospace", padding: "2px 8px", borderRadius: 4, background: "#151820", border: `1px solid ${COLORS.border}`, color: s === "Claude API" ? COLORS.purple : COLORS.faint }}>{s}</span>
          ))}
        </div>

        {/* What's in this version */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, background: COLORS.green + "11", border: `1px solid ${COLORS.green}33`, color: COLORS.green }}>✓ PR→PO→RR Procurement</div>
          <div style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, background: COLORS.blue + "11", border: `1px solid ${COLORS.blue}33`, color: COLORS.blue }}>✓ BOM Production</div>
          <div style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, background: "#E86B8A11", border: "1px solid #E86B8A33", color: "#E86B8A" }}>✓ Costing</div>
          <div style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, background: COLORS.purple + "11", border: `1px solid ${COLORS.purple}33`, color: COLORS.purple }}>✓ KitchenAI (7 features)</div>
        </div>

        {/* Overall progress */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: COLORS.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Progress
            </span>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: STATUS.done.color }}>
              {DONE_COUNT} / {ALL_WEEKS.length} weeks complete
            </span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: "#151820", border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
            <div style={{
              width: `${(DONE_COUNT / ALL_WEEKS.length) * 100}%`,
              height: "100%",
              background: STATUS.done.color,
              borderRadius: 3,
            }} />
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "sprint", label: "Sprint Plan" },
            { id: "ai", label: "KitchenAI Features" },
            { id: "schema", label: "DB Schema" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: tab === t.id ? "#1C2030" : "transparent",
              border: "none", borderBottom: tab === t.id ? `2px solid ${COLORS.blue}` : "2px solid transparent",
              color: tab === t.id ? COLORS.text : COLORS.dim,
              padding: "4px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.08em", borderRadius: "4px 4px 0 0",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* AI Features Tab */}
      {tab === "ai" && (
        <div style={{ padding: "1.5rem" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: COLORS.dim, marginBottom: "0.5rem", fontFamily: "monospace" }}>KitchenAI — 7 Intelligence Features (Weeks 9–10)</div>
          <div style={{ fontSize: 13, color: COLORS.faint, lineHeight: 1.6, marginBottom: "1.25rem", maxWidth: 600 }}>
            Your own version of Salesforce Einstein — built on top of your production data using Claude API. Each feature is triggered automatically or on demand and is clearly labeled in the UI.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {plan.ai_features.map((f, i) => (
              <div key={i} style={{ background: COLORS.card, border: `1px solid ${COLORS.purple}33`, borderLeft: `3px solid ${COLORS.purple}`, borderRadius: "0 10px 10px 0", padding: "0.9rem 1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontFamily: "monospace", color: COLORS.purple }}>#{f.num}</span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{f.name}</span>
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: COLORS.purple + "22", color: COLORS.purple, border: `1px solid ${COLORS.purple}44`, fontFamily: "monospace" }}>AI</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, color: COLORS.dim, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>When</div>
                    <div style={{ fontSize: 12.5, color: COLORS.muted }}>{f.when}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: COLORS.dim, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>How</div>
                    <div style={{ fontSize: 12.5, color: COLORS.muted }}>{f.how}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: COLORS.dim, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>API pattern</div>
                    <div style={{ fontSize: 12.5, color: COLORS.muted }}>{f.api}</div>
                  </div>
                </div>
                <div style={{ marginTop: 8, background: COLORS.purple + "11", borderRadius: 6, padding: "5px 10px", fontSize: 12.5, color: COLORS.purple, fontStyle: "italic" }}>
                  ✦ {f.wow}
                </div>
              </div>
            ))}
          </div>

          {/* Resume bullet */}
          <div style={{ marginTop: "1.5rem", background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "1rem 1.25rem" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: COLORS.dim, fontFamily: "monospace", marginBottom: 8 }}>Resume bullet for KitchenAI</div>
            <div style={{ fontSize: 13, color: COLORS.text, lineHeight: 1.7, fontStyle: "italic", borderLeft: `3px solid ${COLORS.purple}`, paddingLeft: "0.85rem" }}>
              "Integrated an AI intelligence layer using the Claude API with function calling — enabling natural language queries and confirm-before-execute actions against live production data (in Filipino and English), automated cost variance explanations, predictive reorder recommendations, waste pattern detection, demand forecasting, and what-if production simulation across 3 branches."
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {["Claude API", "Function calling", "Agent workflow", "Tool use (read + write)", "Prompt engineering", "Structured output", "Scenario simulation", "BullMQ AI jobs"].map(s => (
                <span key={s} style={{ fontSize: 11, fontFamily: "monospace", padding: "2px 8px", borderRadius: 4, background: COLORS.purple + "22", color: COLORS.purple, border: `1px solid ${COLORS.purple}44` }}>{s}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Schema Tab */}
      {tab === "schema" && (
        <div style={{ padding: "1.5rem" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: COLORS.dim, marginBottom: "0.5rem", fontFamily: "monospace" }}>Key tables added for Costing + AI</div>
          <div style={{ fontSize: 13, color: COLORS.faint, marginBottom: "1rem" }}>These are the tables added specifically for the costing and AI modules — they are NOT yet in schema.prisma, which currently holds the 22 core domain tables. Adding these brings the schema to 26. Note that conversion_orders and production_actuals may instead be columns on the existing Conversion and ProductionOrder models.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
            {plan.schema_additions.map((t, i) => (
              <div key={i} style={{
                background: COLORS.card,
                border: `1px solid ${t.tag === "ai" ? COLORS.purple + "44" : "#E86B8A44"}`,
                borderRadius: 8, padding: "0.7rem 1rem",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <div style={{ fontFamily: "monospace", fontSize: 12.5, color: t.tag === "ai" ? COLORS.purple : "#E86B8A", fontWeight: 600 }}>{t.name}</div>
                  <Tag type={t.tag} />
                </div>
                <div style={{ fontSize: 11.5, color: COLORS.dim, lineHeight: 1.5, fontFamily: "monospace" }}>{t.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sprint Tab */}
      {tab === "sprint" && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Phase selector */}
          <div style={{ display: "flex", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.card }}>
            {plan.phases.map(p => (
              <button key={p.id} onClick={() => { setActivePhase(p.id); setActiveWeek(0); }} style={{
                flex: 1, background: activePhase === p.id ? COLORS.bg : "transparent",
                border: "none", borderBottom: activePhase === p.id ? `2px solid ${p.color}` : "2px solid transparent",
                color: activePhase === p.id ? COLORS.text : COLORS.dim,
                padding: "0.75rem 0.5rem", cursor: "pointer", fontSize: 12,
              }}>
                <div style={{ fontFamily: "monospace", fontSize: 10, color: p.color, marginBottom: 2 }}>{p.weeks}</div>
                <div style={{ fontWeight: 600 }}>{p.title}</div>
                <div style={{ fontFamily: "monospace", fontSize: 10, marginTop: 3, color: phaseProgress(p) === p.weeks_detail.length ? STATUS.done.color : COLORS.dim }}>
                  {phaseProgress(p)}/{p.weeks_detail.length} done
                </div>
              </button>
            ))}
          </div>

          <div style={{ padding: "1.25rem" }}>
            {/* Phase focus */}
            <div style={{
              background: COLORS.card, border: `1px solid ${phase.color}44`,
              borderLeft: `3px solid ${phase.color}`, borderRadius: "0 8px 8px 0",
              padding: "0.7rem 1rem", fontSize: 13, color: COLORS.muted, lineHeight: 1.6, marginBottom: "1.25rem",
            }}>
              <span style={{ color: phase.color, fontWeight: 600 }}>Phase goal: </span>{phase.focus}
            </div>

            {/* Week buttons */}
            <div style={{ display: "flex", gap: 6, marginBottom: "1.25rem", flexWrap: "wrap" }}>
              {phase.weeks_detail.map((w, i) => (
                <button key={i} onClick={() => setActiveWeek(i)} style={{
                  background: activeWeek === i ? phase.color : COLORS.card,
                  border: `1px solid ${activeWeek === i ? phase.color : COLORS.border}`,
                  color: activeWeek === i ? COLORS.bg : COLORS.faint,
                  padding: "5px 14px", borderRadius: 20, cursor: "pointer",
                  fontSize: 12, fontWeight: activeWeek === i ? 700 : 400,
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  {w.status && (
                    <span style={{
                      fontSize: 10,
                      color: activeWeek === i ? COLORS.bg : STATUS[w.status].color,
                    }}>{STATUS[w.status].mark}</span>
                  )}
                  {w.week}
                  {w.tag && <Tag type={w.tag} />}
                </button>
              ))}
            </div>

            {/* Week detail */}
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, fontFamily: "monospace", color: phase.color, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>{week.week}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center" }}>
                    {week.title}
                    {week.tag && <Tag type={week.tag} />}
                    <StatusBadge status={week.status} />
                  </div>
                </div>
              </div>
              <div style={{ padding: "1rem 1.25rem" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: COLORS.dim, fontFamily: "monospace", marginBottom: "0.6rem" }}>
                  Tasks ({week.tasks.length})
                  {(() => {
                    const c = taskCounts(week.tasks);
                    if (!c.done && !c.partial) return null;
                    return (
                      <span style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>
                        {c.done > 0 && <span style={{ color: TASK_STATE.done.color }}>{c.done} done</span>}
                        {c.done > 0 && c.partial > 0 && <span style={{ color: COLORS.dim }}> · </span>}
                        {c.partial > 0 && <span style={{ color: TASK_STATE.partial.color }}>{c.partial} partial</span>}
                      </span>
                    );
                  })()}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1.25rem" }}>
                  {week.tasks.map((task, i) => {
                    const { text, state, note } = readTask(task);
                    const isAI = text.startsWith("FEATURE") || text.toLowerCase().includes("claude") || text.includes("function calling") || text.includes("ai_");
                    const isCosting = text.startsWith("COSTING");
                    const ts = state ? TASK_STATE[state] : null;
                    return (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{
                          width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                          background: ts ? ts.color + "22" : isAI ? COLORS.purple + "22" : isCosting ? "#E86B8A22" : phase.color + "22",
                          border: `1px solid ${ts ? ts.color + "66" : isAI ? COLORS.purple + "44" : isCosting ? "#E86B8A44" : phase.color + "44"}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: ts ? 11 : 9, fontWeight: 700,
                          color: ts ? ts.color : isAI ? COLORS.purple : isCosting ? "#E86B8A" : phase.color,
                          fontFamily: "monospace", marginTop: 1,
                        }}>{ts ? ts.mark : String(i + 1).padStart(2, "0")}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{
                            fontSize: 13, lineHeight: 1.6,
                            color: state === "done" ? "#7E869E" : isAI ? "#C4B8F8" : isCosting ? "#F0A0B0" : "#C4C9DC",
                          }}>{text}</div>
                          {note && (
                            <div style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 3, color: TASK_STATE.partial.color }}>
                              {note}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ background: phase.color + "11", border: `1px solid ${phase.color}33`, borderRadius: 8, padding: "0.75rem 1rem" }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: phase.color, fontFamily: "monospace", marginBottom: 4 }}>✓ Week deliverable</div>
                  <div style={{ fontSize: 13, color: COLORS.text, lineHeight: 1.6 }}>{week.deliverable}</div>
                </div>
              </div>
            </div>

            {/* All weeks list */}
            <div style={{ marginTop: "1.25rem" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: COLORS.dim, fontFamily: "monospace", marginBottom: "0.6rem" }}>All weeks this phase</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {phase.weeks_detail.map((w, i) => (
                  <div key={i} onClick={() => setActiveWeek(i)} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "0.6rem 0.9rem", borderRadius: 8, cursor: "pointer",
                    background: activeWeek === i ? "#151820" : "transparent",
                    border: `1px solid ${activeWeek === i ? COLORS.border : "transparent"}`,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: activeWeek === i ? phase.color : "#2A3048", flexShrink: 0 }} />
                    <div style={{ fontSize: 11, fontFamily: "monospace", color: COLORS.dim, minWidth: 55 }}>{w.week}</div>
                    <div style={{ fontSize: 13, color: activeWeek === i ? COLORS.text : COLORS.faint }}>{w.title}</div>
                    {w.tag && <Tag type={w.tag} />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
