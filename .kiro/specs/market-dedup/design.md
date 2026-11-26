# Design: Delphi Evidence Pre-Check (delphi-check)

Describes the implemented design. See `requirements.md` for behavior.

## Overview
A TypeScript command-line tool with no runtime dependencies (Node 20+ `fetch`, `FormData`, `util.parseArgs`). It caches the user's submission history in a local JSON file and scores each draft note against that history, Delphi's `entry-state`, and the note's own quality.

## APIs used
| API | Base URL | Auth header | Calls |
|---|---|---|---|
| Evidence API | `https://delphi.fyi/v1` | `Authorization: Bearer <key>` | `GET /terms`, `GET /limits`, `GET /markets/{market}/entry-state`, `GET /submissions`, `GET /submissions/{id}`, `POST /submissions` |
| Markets API | `https://api.delphi.fyi` | `X-API-Key: <key>` | `GET /markets`, `GET /markets/{id}` |

Reference: `https://delphi.fyi/v1/openapi.json`.
Evidence API errors look like `{"error":{"code","message","retryAfterSeconds"}}`. The markets API uses `{"error":"text"}`. Both are handled in `api.ts`.
`POST /submissions` is `multipart/form-data` with `marketAddress`, `note`, and repeated `links[]`.

## Modules
```
src/
  cli.ts      Commands: status, sync, markets, check, submit, stats
  api.ts      HTTP client, retries (429, 5xx), error mapping, multipart submit, polling
  analyze.ts  Risk scoring and verdict
  text.ts     Normalization, similarity, fact extraction, hedge detection
  store.ts    JSON cache read/write (dir 0700, file 0600, atomic write)
  config.ts   Environment, .env loader, thresholds
test/
  analyze.test.mjs   Offline tests (node:test), run with `npm test`
```

## Check pipeline (`analyze.ts`)
1. **Hard blockers (SKIP):** `entry-state.canSubmit` false, empty note, note over 8,000 characters, more than 2 links, or a near-copy of an earlier submission.
2. **History comparison:** for each stored submission, text similarity is the mean of token Jaccard and character-trigram Jaccard. Fact overlap compares dates, numbers, IDs, and link domains. A draft is a near-copy when similarity is at least 0.80, or when overlap is at least 0.85 and nothing new appears. From 0.60 similarity adds 25 risk.
3. **Quality rules add risk:** no "As of" prefix +5, stale (over 7 days) +10, future +25, no date +20, no link +25, no number or ID +15, hedging words +12 (three or more +30), under 120 characters +15, mostly repeats the market question +20, dated after resolve time +20, an accepted submission already on this market +30.
4. **Source rules:** news domain +10 each, primary-source domain −15, a domain accepted before −5, a domain in at least two of the user's duplicates with no accepted submission +15.
5. **Verdict:** risk is clamped to 0..100. `SKIP` at 60 or above (or any hard blocker), `REVIEW` at 35 or above, otherwise `SEND`.

## Fact extraction (`text.ts`)
- Dates in ISO, `Nov 6, 2026`, and `6 Nov 2026` forms, stored as `MM-DD` and full ISO.
- Numbers, percentages, and times such as `2:03:00`. Plain years are ignored.
- IDs: tokens with a digit joined by `-`, `/`, or `.`, and prefixes such as `No.`, `Nr.`, `Drs.`.
- Entities: runs of capitalized words, minus a small stop list.
- Link domains with `www.` removed.

## Local cache
`~/.local/share/delphi-check/history.json` (override with `DELPHI_CHECK_HOME`):
```json
{
  "submissions": [{ "id", "createdAt", "market", "note", "links", "status", "verdict", "reason", "bounty" }],
  "markets": { "<address>": { "question", "resolvesAt", "createdAt", "fetchedAt" } },
  "syncedAt": "ISO timestamp"
}
```
Writes go to a temp file, then rename, then `chmod 0600`.

## Submit flow
check → verdict gate (`SKIP` stops, `REVIEW` needs `--allow-review`) → terms check → limits shown → note printed → `y/N` prompt → `POST /submissions` with `Idempotency-Key` → poll `GET /submissions/{id}` every 10 s up to 10 minutes → store and print verdict, reason, and bounty.

## Error handling
- Missing key: message and exit 2. 401 and 403 get a hint about key type, wallet sign-in, terms, or region.
- 429 and 5xx: retried with backoff, honoring `Retry-After`.
- `entry-state` unavailable during `check`: warning added, risk +10, and Delphi's limits are marked unverified.

## Security
Key only from the environment or a git-ignored `.env`. The key is never stored, logged, or sent anywhere except the two Delphi hosts. The cache holds the user's notes, so it is restricted to the owner.

## Limits of the design
- Other users' submissions are invisible, so duplicates of their evidence cannot be predicted.
- The news and primary-source domain lists and the risk weights are heuristics, and tuning them against more history would improve them.
- Entity extraction is a capitalization heuristic and works best for English and Latin-script text.

## Possible later work
Optional semantic embeddings (opt-in), an `angles` command that suggests evidence types not tried yet, and per-category tuning from accepted history.
