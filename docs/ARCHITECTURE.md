# Architecture

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15, App Router, React 19 | Server components and server actions mean one deployable and no separate API layer to keep in sync |
| Language | TypeScript, strict | The domain has a lot of shapes; the compiler is the cheapest place to catch them |
| Database | Prisma + SQLite | Zero-config locally. The schema avoids Postgres-only features so production is a one-line swap |
| AI | `@anthropic-ai/sdk`, structured outputs via `messages.parse()` + Zod | Schema-validated responses, so a malformed answer is caught rather than rendered |
| Styling | Tailwind, CSS custom properties | Light and dark are separately selected token sets, not an automatic flip |

### Database portability

`provider = "sqlite"` in `prisma/schema.prisma` is the only thing to change for
Postgres. The schema deliberately uses no Prisma enums and no array columns —
list-valued fields are JSON text read through `src/lib/json.ts`. Embeddings are JSON
arrays of floats, scored in process; moving to `pgvector` means changing
`retrieveChunks` in `src/lib/ai/retrieval.ts` and nothing else, because the
`embeddingModel` column already records how each stored vector was produced.

---

## Tenancy

Organisation isolation is the platform's most important guarantee, so it is
structural rather than conventional.

- Every business-owned table carries `organisationId`.
- Every organisation-scoped read and write resolves its scope through
  `requireOrg(organisationId, permission)` in `src/lib/tenancy.ts`, which returns a
  context only if the caller is a member. Child records are re-checked against that
  scope before mutation, so an id from another tenant resolves to "not found".
- Retrieval filters by `organisationId` **in the SQL query itself**, not after
  scoring, so a crafted query cannot surface another tenant's passages.
- Uploaded files are stored under `storage/<organisationId>/`, so a file on disk is
  unambiguously owned.
- A platform administrator can reach any organisation. That is the single path that
  bypasses membership, it is explicit in `getOrgContext`, and it is audited.

`tests/tenancy.test.ts` creates two tenants holding deliberately similar documents
and asserts that no query, however crafted, crosses between them.

---

## The Business Knowledge Model

`src/lib/engine/knowledge-model.ts` assembles one structured representation of a
business from assessment answers, interview turns, document facts and consultant
edits. Every agent and every calculation reads the business through this shape rather
than touching tables directly.

It also scores **completeness** per business area, and separately identifies
**critical gaps** — the specific missing fields that block a defensible financial
estimate. This one function drives three things: what the adaptive interview asks
next, what confidence each conclusion carries, and what the dashboard tells the
business to do next.

`snapshotKnowledgeModel()` writes an immutable version on every material change, so
the profile's evolution is visible (v1 → implementation → v2 → new process → v3).

---

## Retrieval

Agents never receive the whole business. They receive the structured knowledge model
rendered for the task, plus the top-k document passages retrieved for the current
question.

Anthropic does not serve an embeddings endpoint, so `src/lib/ai/embeddings.ts`
implements a deterministic hashed bag-of-words vectoriser — unigrams plus bigrams,
sublinear term frequency, L2-normalised to 512 dimensions. It is a genuine lexical
vector space: reliable recall over the operational vocabulary these documents use,
no network call, reproducible. Retrieval blends cosine similarity (0.65) with exact
term overlap (0.35), because operational documents turn on specific nouns —
"purchase order", "Xero" — that a hashed vector alone can blur.

Swapping in a hosted embedding model means changing `embed()` and re-embedding; the
`embeddingModel` column on every chunk makes that unambiguous.

---

## The two providers

`src/lib/ai/provider.ts` exposes one function, `runAgent()`, taking a Zod schema and
a **mandatory deterministic fallback**.

```
runAgent({ agent, task, system, prompt, schema, fallback, reconcile })
  -> { result, provider: 'anthropic' | 'engine', model, warning? }
```

The fallback is always evaluated first, so a result always exists. If a key is
configured, Claude is called with `output_config.format` built from the Zod schema,
adaptive thinking, and one retry. If the model refuses, returns nothing parseable, or
errors, the engine result is returned and the run is logged with status `FALLBACK`.

`reconcile(llm, engine)` lets an agent merge the two rather than choose. The interview
agent uses it to overrule the model: if Claude wants to stop asking while the engine
knows a blocking field is still missing, the engine wins.

**The Financial Analyst has no LLM path at all.** It is the outcome engine. Agents are
handed its figures and told not to recalculate them.

---

## The outcome engine

`src/lib/engine/financials.ts` is where the product's credibility lives.

```
current annual hours  <- stated weekly hours, else volume x duration x periods
current annual cost   <- hours x supplied hourly labour cost (or a labelled benchmark)
reduction range       <- category benchmark, narrowed by the process's own
                         manual / repetitiveness / data-readiness scores
capacity released     <- hours x reduction range
value of capacity     <- capacity x hourly cost
revenue opportunity   <- only where lead volume, conversion and customer value exist
implementation cost   <- planning band by assessed complexity
payback               <- build cost / net annual COST SAVING, revenue excluded
```

Every step appends to `assumptions[]` (each marked supplied or estimated, with its
source) and `formulas[]` (label, expression, result), and any input it could not get
to `missingInputs[]`. Confidence is scored from which inputs were real rather than
benchmarked. The opportunity detail page renders all three, so a client can reproduce
any number on the screen.

Two rules were added after the seeded example produced figures that were arithmetically
correct but misleading:

- **Revenue is attributed once.** Nine opportunities each claiming the same
  conversion uplift summed to £3.8m on a £4.2m business. `attributeRevenueOnce()`
  keeps it on the highest-priority revenue-bearing opportunity and clears it from the
  rest, recording why on each. `aggregateOutcomes()` takes the maximum as a backstop.
- **Payback excludes revenue.** Funding payback with speculative revenue produced
  0.2-month paybacks. Cost saving alone gives 3–29 months, and a weak case now
  correctly shows a payback measured in years.

---

## Deciding against AI

`assessSuitability()` in `src/lib/engine/opportunities.ts` can return
`NOT_RECOMMENDED` for three reasons, each with an explanation written for the client:

- **Too small.** Under ~26 hours a year, implementation and maintenance cost more
  than a complete automation would release.
- **Already automated and working.** Manual score ≤ 1 with a low error rate: there is
  no inefficiency to remove and changing it adds risk for no return.
- **Variable judgement work, poor data, real consequences.** AI would need supervision
  on every case, which removes the saving. The recommendation is to fix the data and
  documentation first.

The AI Opportunity Agent can also veto on its own reasoning, and a veto always wins —
the platform errs towards *not* recommending AI.

---

## Prioritisation

Twelve weighted factors, normalised to a 0–100 score
(`src/lib/engine/opportunities.ts`): business impact, strategic fit, time consumed,
frequency, automation potential, revenue opportunity, cost reduction, data readiness,
implementation ease, cost ease, risk safety, integration simplicity. Implementation
difficulty, cost and risk count *against* a score rather than being ignored. Bands:
Phase 1 ≥ 58, Phase 2 ≥ 38, Phase 3 below. The full breakdown is stored per
opportunity.

---

## The agents

Eight specialised roles passing structured results, rather than one large prompt
(`src/lib/ai/agents/`). The orchestrator runs them in sequence:

```
Process Analyst   -> steps, inefficiencies        -> written to the model
Opportunity Engine + AI Opportunity Agent
                  -> opportunities, categories, vetoes
Financial engine  -> figures (already embedded in the drafts)
Risk Agent        -> risk register
Report Agent      -> narrative -> report document
```

Business Analyst (the interview), Implementation Agent and Performance Agent run on
their own triggers. Each has a deterministic fallback, listed at `/admin/models`.

---

## Consultant override

Consultants can rewrite any AI-generated recommendation before it reaches a client.
Doing so sets `editedByConsultant`, and the orchestrator then **recalculates the
figures but leaves the wording alone** on re-analysis. The same applies to a
hand-drawn process map (`Process.editedByConsultant`) and to report commentary, which
is stored separately from generated content and rendered above it.

---

## Auditability

Every significant action writes an `AuditLog` row; every agent invocation writes an
`AIGenerationLog` row recording provider, model, duration and outcome. Auditing never
breaks a user-facing action — both writers swallow their own errors.

---

## Extension points

- **Integrations** — add to `src/lib/integrations/registry.ts`. An entry declares what
  it would contribute to the knowledge model; `available: false` shows it as planned
  throughout the product.
- **Assessment templates** — `src/lib/engine/assessment-template.ts` is data. Add a
  template keyed by industry; `Assessment.templateKey` already selects it.
- **Opportunity categories** — add a rule to `CATEGORY_RULES` and a benchmark range to
  `REDUCTION_BENCHMARKS`.
- **Billing** — `PricingPlan` and organisation assignment exist; a payment provider
  would hook into the admin pricing screen.
- **Background processing** — document processing and analysis currently run inline.
  Both are already single function calls (`processDocument`, `runFullAnalysis`) and
  move to a queue without touching their callers.

---

## Testing

65 tests (`npm test`) over the parts where being wrong is expensive:

- **`engine.test.ts`** — hours derivation, ranges, benchmark fallback, confidence,
  refusal to estimate revenue without inputs, payback excluding revenue, revenue
  attributed once, and each of the three "AI not recommended" paths.
- **`tenancy.test.ts`** — two tenants with similar documents; queries crafted to
  match the other tenant return nothing of theirs.
- **`documents.test.ts`** — classification, fact extraction with quotes, chunking.
- **`assessment.test.ts`** — unique keys, valid dependencies, branching producing
  genuinely different question sets, progress, completeness gaps.
- **`provider.test.ts`** — engine fallback, safety preamble contents, interview gap
  ordering and stop condition, risk proportionality, attainment arithmetic,
  implementation plans always including baselining, pilot and training.

Three of these tests found real defects during development: the step-extraction
regex never matched `Step 1.`, revenue was being summed across opportunities, and
payback was being funded by speculative revenue.
