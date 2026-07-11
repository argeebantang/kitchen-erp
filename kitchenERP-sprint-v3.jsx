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
          title: "Project Setup & Database Schema",
          tag: null,
          tasks: [
            "Initialize Next.js 15 + TypeScript monorepo",
            "Full Prisma schema: 22 tables covering all modules including costing and AI log",
            "Docker Compose: PostgreSQL + Redis",
            "GitHub repo + GitHub Actions CI pipeline",
            "JWT auth with 5 roles: Admin, Accounting Approver, Warehouse Staff, Kitchen Supervisor, Branch Manager",
            "Login page + protected route middleware per role",
            "Seed script with real items: all wet, dry, finished goods from Lydia's list",
          ],
          deliverable: "Running app with login, roles, and full DB schema. Sign in as different roles and see different dashboards.",
        },
        {
          week: "Week 2",
          title: "Item Master & Bill of Materials",
          tag: null,
          tasks: [
            "Item Master CRUD: name, category (Wet/Dry/Finished Good/Packaging), unit, reorder point",
            "Unit price per item with effective_date for historical costing accuracy",
            "BOM module: create finished goods with ingredient lines per batch weight",
            "BOM scaled viewer: enter batch weight → auto-calculate all ingredient quantities",
            "BOM version history — old recipes archived not deleted",
            "Seed real BOMs: Dinuguan (18 ingredients), Lechon Paksiw, Bopis",
          ],
          deliverable: "Type '207.6kg batch of Dinuguan' and see all 18 ingredients with exact quantities calculated automatically.",
        },
        {
          week: "Week 3",
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
            "Current stock dashboard: quantities on hand, reorder alerts",
            "BullMQ daily low-stock check job",
          ],
          deliverable: "Complete PR → PO → RR → Stock. Receive a delivery and inventory updates in real time with full ledger trail.",
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
      focus: "The AI intelligence layer — 6 features using Claude API with function calling. Then reports, polish, and deployment.",
      weeks_detail: [
        {
          week: "Week 9",
          title: "KitchenAI — Core Intelligence",
          tag: "ai",
          tasks: [
            "Set up Claude API integration in the backend (Anthropic SDK)",
            "FEATURE 1 — Cost Variance Explainer: after every production order closes, Claude auto-generates a plain-language explanation of why the cost was higher or lower than last batch. Stored in DB, shown on production order detail page.",
            "FEATURE 2 — Natural Language Query: chat box on dashboard. User types any question. Claude uses function calling to decide which DB query to run, executes it, formats the answer. Example: 'Magkano ang gastos namin ngayong buwan?' → Claude calls get_production_costs({period: 'this_month'}) → answers in Filipino.",
            "Define 6 callable functions for the NL query: get_production_costs, get_waste_summary, get_stock_levels, get_branch_performance, get_supplier_history, get_top_items",
            "AI query log table: record every question, function called, and answer for audit",
            "Loading state + streaming response UI for natural language query",
          ],
          deliverable: "Ask the dashboard in plain Filipino/English: 'Which branch wasted the most this week?' and get a real answer pulled from your actual database in under 3 seconds.",
        },
        {
          week: "Week 10",
          title: "KitchenAI — Predictive Features",
          tag: "ai",
          tasks: [
            "FEATURE 3 — Waste Pattern Detector: BullMQ weekly job that sends last 30 days of write-off data to Claude. Claude identifies patterns per branch per item and writes actionable recommendations. Shown on head office dashboard.",
            "FEATURE 4 — Reorder Recommender: when stock drops below reorder point, instead of just alerting, Claude analyzes average daily consumption + supplier lead time + upcoming production orders and recommends exact order quantity and deadline.",
            "FEATURE 5 — Demand Forecaster: kitchen supervisor opens production planning screen. Claude looks at historical production by day of week and upcoming calendar (holidays) and suggests how many batches to produce today.",
            "FEATURE 6 — Supplier Performance Analyzer: Claude reviews all RR variance data per supplier and generates a supplier reliability report monthly. Flags suppliers with consistent short deliveries.",
            "All AI features are clearly labeled with an AI badge in the UI",
            "Each insight has a 'Regenerate' button so users can refresh the analysis",
          ],
          deliverable: "Head office dashboard shows 6 live AI insights — waste patterns, reorder suggestions, demand forecasts, supplier flags. All generated from real system data.",
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
    { num: "02", name: "Natural Language Query", when: "On demand — chat box on dashboard", how: "User asks question → Claude picks function → queries DB → answers", api: "Claude API — function calling (agent)", wow: "Works in Filipino. Queries real data." },
    { num: "03", name: "Waste Pattern Detector", when: "Auto — weekly BullMQ job", how: "30 days of write-off data → Claude finds patterns → recommendations", api: "Claude API — data analysis prompt", wow: "'Branch 3 wastes 8kg paksiw every Friday.'" },
    { num: "04", name: "Reorder Recommender", when: "Auto — triggered on low stock alert", how: "Consumption rate + lead time + upcoming orders → Claude suggests qty", api: "Claude API — structured output", wow: "Not just 'low stock' — tells you exactly how much to order and by when." },
    { num: "05", name: "Demand Forecaster", when: "On demand — production planning screen", how: "Historical production by weekday + calendar → Claude suggests batches", api: "Claude API — reasoning prompt", wow: "'It's a holiday Monday — suggest 5 batches instead of 3.'" },
    { num: "06", name: "Supplier Analyzer", when: "Auto — monthly BullMQ job", how: "All RR variances per supplier → Claude generates reliability report", api: "Claude API — report generation", wow: "Catches suppliers who consistently short-deliver before it becomes a crisis." },
  ],
  schema_additions: [
    { name: "item_prices", desc: "id, item_id, price_per_unit, effective_date, created_by", tag: "costing" },
    { name: "production_actuals", desc: "id, production_order_id, actual_yield, actual_cost, cost_per_unit, cost_variance, completed_by", tag: "costing" },
    { name: "conversion_orders", desc: "id, source_item_id, source_qty, output_item_id, output_qty, conversion_cost, status, approved_by", tag: "costing" },
    { name: "writeoffs", desc: "id, item_id, location_id, quantity, unit_cost, total_cost, reason, approved_by", tag: "costing" },
    { name: "ai_insights", desc: "id, type, reference_id, reference_type, prompt_used, response, generated_at", tag: "ai" },
    { name: "ai_query_log", desc: "id, user_id, question, function_called, function_args, answer, created_at", tag: "ai" },
  ],
};

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
          <div style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, background: COLORS.purple + "11", border: `1px solid ${COLORS.purple}33`, color: COLORS.purple }}>✓ KitchenAI (6 features)</div>
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
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: COLORS.dim, marginBottom: "0.5rem", fontFamily: "monospace" }}>KitchenAI — 6 Intelligence Features (Weeks 9–10)</div>
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
              "Integrated an AI intelligence layer using the Claude API with function calling — enabling natural language queries against live production data (in Filipino and English), automated cost variance explanations, predictive reorder recommendations, waste pattern detection, and demand forecasting across 3 branches."
            </div>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {["Claude API", "Function calling", "Agent workflow", "Prompt engineering", "Structured output", "BullMQ AI jobs"].map(s => (
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
          <div style={{ fontSize: 13, color: COLORS.faint, marginBottom: "1rem" }}>These are the tables added specifically for the costing and AI modules. The full schema has 22 tables total.</div>
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
                  </div>
                </div>
              </div>
              <div style={{ padding: "1rem 1.25rem" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: COLORS.dim, fontFamily: "monospace", marginBottom: "0.6rem" }}>
                  Tasks ({week.tasks.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1.25rem" }}>
                  {week.tasks.map((task, i) => {
                    const isAI = task.startsWith("FEATURE") || task.toLowerCase().includes("claude") || task.includes("function calling") || task.includes("ai_");
                    const isCosting = task.startsWith("COSTING");
                    return (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{
                          width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                          background: isAI ? COLORS.purple + "22" : isCosting ? "#E86B8A22" : phase.color + "22",
                          border: `1px solid ${isAI ? COLORS.purple + "44" : isCosting ? "#E86B8A44" : phase.color + "44"}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 9, fontWeight: 700,
                          color: isAI ? COLORS.purple : isCosting ? "#E86B8A" : phase.color,
                          fontFamily: "monospace", marginTop: 1,
                        }}>{String(i + 1).padStart(2, "0")}</div>
                        <div style={{ fontSize: 13, color: isAI ? "#C4B8F8" : isCosting ? "#F0A0B0" : "#C4C9DC", lineHeight: 1.6 }}>{task}</div>
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
