# Clarity — AI Business Intelligence & Implementation Platform

Clarity helps a business understand how it actually works, where it loses time and
money, and whether AI or automation would genuinely help. When the honest answer is
that it would not, the platform says so.

It is not a chatbot. The core of the product is a **Business Understanding Engine**,
an **AI Opportunity Engine** and an **Implementation Management System**.

---

## Quick start

```bash
npm install
npm run setup     # generate the Prisma client, create the database, seed demo data
npm run dev       # http://localhost:3000
```

`npm run setup` seeds a complete worked example — a roofing contractor that has been
assessed, interviewed, analysed, given a report and roadmap, taken one opportunity
through to a live implementation, and recorded two months of real KPI results.

### Demo sign-ins

Password for all four: `clarity123`

| Email | Role | What they see |
|---|---|---|
| `owner@northgateroofing.example` | Business owner | Full client journey, decisions, projects, members |
| `estimator@northgateroofing.example` | Business employee | Assessments, process information, projects — no management controls |
| `consultant@clarity.example` | AI consultant | Every client, review and edit AI analysis, approve reports |
| `admin@clarity.example` | Platform administrator | Organisations, users, AI models, templates, pricing, audit |

---

## Does it need an Anthropic API key?

No — and this is a deliberate design decision.

The platform has **two analysis providers** behind one interface:

- **`engine`** — a deterministic, in-process analysis engine. It maps processes,
  classifies opportunities, decides where AI is and is not appropriate, calculates
  every financial outcome, builds the roadmap, plans implementations and reviews
  performance. It is the platform's own implementation, not a placeholder.
- **`anthropic`** — Claude, which *adds* judgement and client-facing language on top
  of the engine's results.

**Financial figures are never produced by a language model.** The outcome engine
calculates them; the agents are given the results to explain, and are told in the
prompt not to recalculate. That is what makes the numbers reproducible.

To enable the Claude layer, set `ANTHROPIC_API_KEY` in `.env`. Every agent run
records which provider served it (visible at `/admin`), and if a model call fails or
returns something that does not validate, the engine result is used and the run is
logged as a fallback. The workflow never breaks.

---

## The intelligence loop

The product refuses to start with "here are some AI tools". It works in this order:

1. **How does this business work?** — adaptive assessment, AI interview, documents
2. **Where are the problems?** — process mapping, quantified inefficiencies
3. **Why do they exist?** — root cause, recorded against each problem
4. **Could AI realistically improve them?** — opportunity engine, including "no"
5. **What would it cost?** — implementation and running cost ranges
6. **What could the outcome be?** — capacity, cost and revenue, reported separately
7. **How do we implement and measure it?** — projects, KPIs, projected vs actual

---

## What is implemented

| Area | Status |
|---|---|
| Role-based access (owner, employee, consultant, platform admin) | Complete |
| Business onboarding and profile | Complete |
| AI business assessment, with branching questions | Complete — 8 sections, 50 questions |
| Adaptive AI interview, every question carrying its reason | Complete |
| Document intelligence (PDF, Word, Excel, CSV, text) | Complete — extract, classify, entities, facts, chunk, embed |
| Business Knowledge Model, versioned | Complete |
| Process mapping and step editing | Complete |
| AI Opportunity Engine, including "AI not recommended" | Complete |
| Projected Outcomes Engine with assumptions and formulas | Complete |
| Prioritisation model (12 weighted factors) | Complete |
| AI Opportunity Report, versioned, consultant-editable | Complete |
| AI Roadmap with client decisions | Complete |
| Implementation workspace (9 stages, tasks, milestones, comments) | Complete |
| KPI tracking and projected-vs-actual performance reviews | Complete |
| Continuous discovery cycles | Complete |
| Business and consultant dashboards | Complete |
| Platform administration and audit logging | Complete |
| Retrieval architecture (embeddings, vector search, citations) | Complete |
| Eight specialised AI agents passing structured results | Complete |

Integrations (HubSpot, Xero, Microsoft 365 and so on) are **declared but not built**.
They appear throughout the product marked *Planned*, and the registry states exactly
what each would contribute. The platform never pretends to hold data it does not have.

---

## How the figures are kept honest

These rules are enforced in code, not just in prompts:

- **Ranges, never single figures.** Every estimate has a low and a high bound.
- **Cost saving, released capacity, revenue and productivity are separate.** They are
  never added into one headline number.
- **Released capacity is not automatically cash.** The platform says so every time it
  shows one.
- **Revenue is attributed once.** Every revenue estimate draws on the same pool of
  leads, so it is counted against a single opportunity and cleared from the others
  with the reason recorded. Aggregation takes the maximum, never the sum.
- **Payback is funded by cost saving alone.** Letting speculative revenue shorten the
  payback period produces flattering, indefensible figures.
- **Missing inputs are named.** If a figure cannot be calculated, the platform says
  what would be needed rather than guessing.
- **Every figure carries its formula, its inputs and its assumptions**, each labelled
  as supplied by the client or estimated from a benchmark.

---

## Commands

```bash
npm run dev         # development server
npm run build       # production build
npm start           # production server
npm test            # 65 tests covering the engines, tenancy, documents and agents
npm run typecheck   # strict TypeScript, no errors
npm run db:reset    # rebuild and reseed the database
```

---

## Project structure

```
prisma/schema.prisma        30 models, organisation-scoped
prisma/seed.ts              the full worked example

src/lib/
  auth.ts                   sessions, scrypt passwords, permission matrix
  tenancy.ts                the organisation guard every query passes through
  audit.ts                  audit and AI generation logs
  ai/
    provider.ts             Claude / engine abstraction with validated fallback
    embeddings.ts           local hashed TF-IDF vectoriser
    retrieval.ts            organisation-scoped vector search
    agents/                 the eight specialised agents
  engine/
    assessment-template.ts  the question bank, as data
    ingest.ts               answers -> knowledge model
    knowledge-model.ts      the structured business representation
    opportunities.ts        opportunity identification and prioritisation
    financials.ts           the projected outcomes engine
    benchmarks.ts           labelled industry ranges
    report.ts               report document assembly
    orchestrator.ts         the agent pipeline
  documents/                extraction, classification, chunking pipeline

src/app/                    Next.js App Router — client, consultant and admin areas
src/components/             UI kit, charts, report renderer
tests/                      65 tests
docs/ARCHITECTURE.md        design decisions and extension points
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design in depth.
