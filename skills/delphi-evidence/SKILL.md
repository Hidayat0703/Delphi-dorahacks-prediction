---
name: delphi-evidence
description: Submit evidence to Delphi markets (Sell information) while avoiding "We already have this information" rejections. Use when asked to pick Delphi markets, check submission limits, draft a factual evidence note, or submit and track evidence on Delphi.
---

# Delphi Evidence Submission

Sell real, verifiable information to Delphi's forecaster and avoid wasted submissions.

## Hard rules

1. **Only submit facts you actually found or observed, with a real source.** Never invent, guess, or embellish. Made-up or misleading submissions are not paid, and repeated cases block the account.
2. **Never include secrets or personal or confidential data** in a note.
3. **One submission per market.** The account limit is 1 per market (check `GET /limits` to confirm `submissionsPerMarket`). A rejected submission can use up that market's slot. Per the OpenAPI spec, a `duplicate` (every item already on the market, from any account) is not a strike and may be given back, up to 10 a day, but the response `message` says whether it was. Do not rely on that and do not submit "to see what happens". Always re-read `entry-state` afterwards.
4. **Never reword a rejected note and resend it, and never submit the same fact to get around a rejection.** Delphi says to look for a different fact instead.
5. **Do not loop or batch.** Submit at most one note at a time, wait for the result, then decide the next step.
6. **Never print, store, or commit the API key.** Read it only from the `DELPHI_API_ACCESS_KEY` environment variable.

## Optional: use the `delphi-check` CLI

If the `delphi-check` command is installed (see `delphi-check/README.md`), prefer it for the steps below:
`delphi-check sync`, `delphi-check markets`, `delphi-check check --market 0x.. --note @note.txt --link URL`, and `delphi-check submit ...`.
Only run `submit` when `check` returns `SEND`. A `SKIP` or `REVIEW` result means fix the note or pick another market. Never pass `--yes` unless the user explicitly asked for unattended submission.

## Endpoints and auth

Evidence API base URL: `https://delphi.fyi/v1`
Header: `Authorization: Bearer $DELPHI_API_ACCESS_KEY`
Optional agent headers: `X-Agent-Id`, `X-Agent-Harness`, `X-Agent-Model` (1 to 64 printable ASCII characters).

| Call | Purpose |
|---|---|
| `GET /terms` | Check `acceptedAt` is not null. If null, stop and tell the user to accept the terms. |
| `GET /limits` | `submitsLeftThisHour`, `submissionsPerMarket`, `dailyCapLeft`. |
| `GET /markets/{marketAddress}/entry-state` | `canSubmit`, `reason`, `remainingOnMarket`, `judgementPotRemainingBaseUnits`. |
| `POST /submissions` | Submit (multipart: `marketAddress`, `note`, `links`, `files`; up to 3 items total). |
| `GET /submissions`, `GET /submissions/{id}` | Read history and results. |
| `POST /submissions/{id}/retry` | Retry only when `status` is `failed` and `canRetry` is true. |

Market list (REST API, mainnet): `GET https://api.delphi.fyi/markets?status=open&limit=50&skip=0`
This host uses the header `X-API-Key: $DELPHI_API_ACCESS_KEY`. Each market has `id` (the contract address, used as `marketAddress`), `status`, `category`, `resolvesAt`, `settlesAt`, and `metadata.question` and `metadata.outcomes`.

Money amounts are strings in USDC base units with 6 decimals. Divide by 1e6 to display.

## Workflow

### Step 1. Preflight
1. `GET /terms`. Stop if `acceptedAt` is null.
2. `GET /limits`. Stop if `submitsLeftThisHour` is 0 and report `hourEndsAt`.

### Step 2. Build a history list (avoid repeats)
1. Page through `GET /submissions` (follow `nextCursor`).
2. For each item, record the market address, status, the market line `verdict` and `reason`, and the note text.
3. Treat every market in this list as **used**. Do not submit to it again.

### Step 3. Choose markets
1. Fetch open markets from the market list endpoint.
2. Drop markets already in the history list.
3. For each remaining candidate, call `entry-state`. Keep only `canSubmit: true`.
4. Rank by `judgementPotRemainingBaseUnits` (higher first), then by a closer `resolvesAt`.
5. Prefer markets where you can find a **niche, primary-source** fact. Be wary of topics covered by every news outlet.

### Step 4. Find a fact worth selling
The forecaster already has widely reported news, other prediction markets' odds, and anything its own search finds. Those tend to earn nothing and are the most likely to be rejected as duplicates. Look for:
- primary documents: official agendas, filings, bills, court dockets, schedules, notices
- exact counts, times, or dates from the primary source (vote tallies, seat counts, entry lists, official timetables)
- local or non-English sources that general search tends to miss
- changes that happened after the market's creation date, with a timestamp

Skip the market if you cannot find a new, checkable fact. Skipping costs nothing. A rejected submission uses the slot.

### Step 5. Write the note
- State a **fact, not a prediction**. Example of a fact: "The Bundestag agenda for Dec 10 lists the bill as item 12." Example of a prediction (do not send): "The bill will likely pass."
- Start with `As of YYYY-MM-DD:` and give when and where the fact was observed.
- Name the source (document ID, page, publisher) and add 1 to 2 links to the original record. If a page may be behind a login or paywall, say so, and add a screenshot or file when possible.
- Keep it short and specific. Under 8,000 characters is required, and a few hundred is usually enough.
- Do not restate the market question. Add what is new.

### Step 6. Pre-submit checklist (all must be yes)
- [ ] Market is not in the history list and `entry-state.canSubmit` is true.
- [ ] The note contains a date, a place or source, and at least one specific number, name, or document ID.
- [ ] The note is a fact I actually found, with a source link that opens.
- [ ] The core fact differs from every earlier note I sent, in substance and not only in wording.
- [ ] The core fact is not simply the headline from major news coverage.
- [ ] `submitsLeftThisHour` is above 0.

If any answer is no, do not submit. Report why.

### Step 7. Submit and read the result
1. Send `POST /submissions` once, with an `Idempotency-Key` header (a fresh UUID). Reuse the same key only when retrying after a network timeout of the same request.
2. If the response is `200` with `status: "rejected"`, the slot is used. Stop and report the reason.
3. If `202`, poll `GET /submissions/{id}` and respect the `Retry-After` header. Judging takes a few minutes.
4. Report `verdict`, `reason`, `bounty`, and `settlementUpTo` to the user.
5. If the verdict is `duplicate`, record the market as used, and do not resubmit. Pick a different market next, with a more niche source.

## Errors

| HTTP | Code | Action |
|---|---|---|
| 400 | `invalid_request` | Fix the field named in `field`. Nothing was saved. |
| 401 | `unauthorized` | Key problem. Stop and tell the user. |
| 403 | `terms_not_accepted` | Stop. The user must accept the terms. |
| 403 | `forbidden` | Restricted region. Stop. |
| 409 | `idempotency_conflict` | Same key with a different body. Use a new key. |
| 429 | `rate_limited` | Wait `retryAfterSeconds`, then continue. |
| 500, 503 | `server_error` | Retry once after a short wait. |

## Reporting format

After each run, give the user a short table: market question, market address, action (submitted, skipped, stopped), reason, and result (verdict and bounty if any). Include `submitsLeftThisHour` and the markets still available.

## Notes
- Rejected submissions still count against limits, so skip when unsure.
- Other users' accepted submissions are not visible. You cannot detect their duplicates in advance. Rely on niche, primary-source, dated facts.
- Full API reference: `https://delphi.fyi/v1/openapi.json`. Docs: `https://docs.delphi.fyi/sell-information.md` and `https://docs.delphi.fyi/tools/sdk/evidence.md`.
