# Design: Delphi Evidence Pre-Check (CLI)

## Overview
A local TypeScript CLI. It stores the user's own Delphi submission history in SQLite and compares each new draft against that history before anything is sent. It uses the official Delphi SDK for reads and (optionally) for submitting.

## Data sources
| Need | Source |
|---|---|
| Past submissions and results | `EvidenceClient.listSubmissions`, `getSubmission` |
| Can I submit on this market, and how many left | `getEntryState(market)` |
| Hourly and daily limits | `getLimits()` |
| Market question, description, criteria, end date | `DelphiClient.getMarket` / `listMarkets` (`metadata.question`, `description`, `resolutionCriteria`, `endDate`) |
| Terms status | `getTerms()` |

Base URL: `https://delphi.fyi/v1`. Auth: `DELPHI_API_ACCESS_KEY`. Full field reference is the OpenAPI document at `https://delphi.fyi/v1/openapi.json`; field names in the code must be checked against it during implementation.

## Stack
Node.js 20+, TypeScript, `@gensyn-ai/gensyn-delphi-sdk` ≥ 2.3.0, `better-sqlite3`, `commander`, `zod`, Vitest. Install as a global npm command (`delphi-check`).

## Commands
```
delphi-check sync
delphi-check check  --market 0x… --note note.txt [--link URL]…
delphi-check angles --market 0x…
delphi-check submit --market 0x… --note note.txt [--link URL]…
delphi-check stats
```

## Check pipeline
```
draft ──► Parse ──► Facts ──► Compare with own history ──► Quality rules ──► Entry state ──► Verdict
```
1. **Parse.** Strip the optional `As of YYYY-MM-DD:` prefix, normalize text (NFKC, lowercase, whitespace).
2. **Facts.** Extract a fact signature:
   - dates (ISO and written forms)
   - numbers with units (votes, percentages, amounts, times such as `2:03:00`)
   - named entities (capitalized-token runs, bill and document IDs such as `BT-Drs. 21/8869`)
   - source domains of links
   - event verbs (passed, scheduled, published, withdrawn)
3. **Compare with own history** (same market only):
   - text similarity: token-set Jaccard plus character 3-gram similarity
   - fact overlap: share of the draft's dates, numbers, entities, and source domains already present in a past submission
   - `skip` if text similarity ≥ 0.80, or fact overlap ≥ 0.85 with no new date, number, or source.
   - `review` if similarity is between 0.60 and 0.80, or the only new element is a link with the same fact. The matching past submission and its status are shown.
   - Past submissions with status `rejected` for non-duplicate reasons (unverified, irrelevant) are shown as context, not as blocking matches.
4. **Quality rules** (each adds a reason and moves the verdict to at least `review`):
   - no date, or no place or source named
   - wording is predictive (`will`, `I think`, `likely`) with no observed fact
   - more than 70% of the draft's tokens appear in the market's question or description
   - no link, photo, or document and the claim is not self-evidently checkable
5. **Entry state.** Call `getEntryState`. If the user has no submissions left on the market, or cannot enter it, the verdict is `skip`.
6. **Verdict.** `skip` > `review` > `send`, with the list of reasons and the closest past submission.

Thresholds live in `~/.config/delphi-check/config.json`.

## Angles command
Groups the user's past submissions on a market by a fixed set of evidence types: official schedule or agenda, vote or roll-call count, published document or filing, local notice or sign, personal count or observation, source-language report. It marks which types are missing. It prints a short prompt such as "No official agenda item found yet. Look for the parliamentary schedule for the vote date." This stays a checklist. It never produces facts.

## Local data model (SQLite, `~/.local/share/delphi-check/history.db`, mode 0600)
```sql
submissions (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL,
  note TEXT,
  links_json TEXT,
  status TEXT NOT NULL,        -- queued|judging|judged|rejected|failed|unmatched
  verdict TEXT,                -- accepted | not_accepted | …
  reason TEXT,
  bounty TEXT,                 -- USDC base units, string
  created_at TEXT NOT NULL,
  fact_json TEXT NOT NULL      -- extracted fact signature
);
CREATE INDEX idx_sub_market ON submissions(market);

markets (
  address TEXT PRIMARY KEY,
  question TEXT, description TEXT, criteria TEXT,
  ends_at TEXT, fetched_at TEXT
);
```

## Submit flow
1. Run the full check. Stop unless the verdict is `send`.
2. Print the draft, verdict, and submissions left. Ask `y/N`.
3. Check `getTerms().acceptedAt`. If null, stop and explain.
4. Call `submitEvidence` with an `Idempotency-Key`.
5. Poll with `waitForSubmission` (which honors `Retry-After`). Save the result to SQLite.
6. On `429`, wait `retryAfterSeconds`. On `5xx`, retry once.

No loops, no batching, no auto-generated content.

## Error handling
- Missing API key: print how to create one and exit 2.
- `401`: key problem. `403 terms_not_accepted`: show terms URL. `403 forbidden`: restricted region, stop.
- Network failure during `check`: run the local comparison, mark the entry-state result as `unknown`, and downgrade `send` to `review`.

## Security
- Key from environment only, never stored or logged.
- All SQL is parameterized.
- Notes remain local. Embeddings are an opt-in flag (`--embeddings`) and send only the draft text to the configured provider.

## Testing
- Unit tests for the fact extractor and similarity scorer, using real examples like the Japan tax bill, FIDE match, German PNOG, Korea budget, and Valencia Marathon notes.
- A fixture of reworded-pair cases (same fact, different words) and new-fact cases (same market, different date or source).
- SDK calls tested against a mocked HTTP server. No live submissions in tests.

## Limits of the design
- The tool only knows the user's own submissions. A "We already have this" caused by another user cannot be predicted. Mitigation: prefer niche, dated, locally sourced facts, since Delphi states widely reported news tends to earn nothing.
- Thresholds are initial values and need tuning from the user's own accepted/rejected history.

## Project layout
```
src/
  cli.ts
  commands/ sync.ts check.ts angles.ts submit.ts stats.ts
  delphi/   client.ts (SDK wrapper)
  facts/    parse.ts extract.ts
  compare/  similarity.ts verdict.ts rules.ts
  store/    db.ts migrations.ts
  config.ts
test/  fixtures/
```
