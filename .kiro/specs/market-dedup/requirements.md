# Requirements: Delphi Evidence Pre-Check (delphi-check)

Status: implemented in `src/`. This document describes what the tool does today.

## Problem
Evidence notes sent through Delphi's *Sell information* feature often come back as **Not accepted: We already have this information**. Delphi marks a submission `duplicate` when every item (note, link, file) already exists on that market, from any account, and it does not say which one matched. The account limit is 1 submission per market and 5 per hour, so wasted submissions are costly.

## Scope
A local Linux command-line tool that checks a draft note before it is sent. It uses only the official Delphi API and the user's own key. It does not bypass or probe Delphi's duplicate or fraud checks.

## Known limit
The tool cannot see other users' submissions. It estimates risk from the user's own history, Delphi's `entry-state`, and the quality of the note. A `SEND` verdict is not a guarantee.

## Assumptions
- A1. The user has a Mainnet API key from api-access.delphi.fyi and has signed in to the Delphi app once.
- A2. Node.js 20 or newer on Linux.
- A3. The user writes the notes. The tool never creates facts.

## Requirements

### R1. Sync history
- R1.1 `sync` downloads all past submissions (`GET /submissions`, following `nextCursor`) into a local JSON cache.
- R1.2 Each stored entry has market address, note, links, status, per-market verdict and reason, bounty, and timestamp.
- R1.3 Re-running `sync` updates existing entries and adds new ones.
- R1.4 Market questions are fetched and cached for each market in the history.

### R2. Check a draft
- R2.1 `check --market <0x…> --note <text|@file> [--link URL …]` prints a verdict `SEND`, `REVIEW`, or `SKIP` with a 0 to 100 risk score, concerns, and good signs. Exit codes: 0 send, 3 review, 1 skip.
- R2.2 Delphi's `entry-state` is read first. If `canSubmit` is false, the verdict is `SKIP` and the reason is explained.
- R2.3 A draft with text similarity of 0.80 or more to any earlier submission, or the same facts with nothing new, is `SKIP`. Similarity from 0.60 raises risk.
- R2.4 The tool extracts dates, numbers, IDs, entities, and link domains, and compares them with earlier notes so reworded duplicates are caught.
- R2.5 The tool raises risk when the note has no concrete date, no source link, no specific number or ID, hedging or predictive wording, a very short length, a stale or future "As of" date, or mostly repeats the market question.
- R2.6 Widely covered news domains raise risk. Primary-source domains (government, parliament, official bodies) lower it.
- R2.7 Domains that appeared in several of the user's duplicates and never in an accepted submission raise risk.
- R2.8 More than 2 links or a note over 8,000 characters is `SKIP`.
- R2.9 If `entry-state` cannot be read, the tool adds a warning and does not treat that as permission.
- R2.10 Thresholds are configurable with `DELPHI_CHECK_SKIP` (default 60) and `DELPHI_CHECK_REVIEW` (default 35).

### R3. Find markets
- R3.1 `markets [--scan N] [--top N]` lists open markets from the markets API, removes those the user already used, keeps only those where `entry-state.canSubmit` is true, and sorts by remaining reward pot.

### R4. Gated submit
- R4.1 `submit` runs the same check first. `SKIP` never submits. `REVIEW` submits only with `--allow-review`.
- R4.2 The tool verifies the terms are accepted, shows the note and links, and asks for `y/N` confirmation. `--yes` skips the prompt and is meant for the user only.
- R4.3 Submissions use an `Idempotency-Key` and are polled until judged. The result is stored locally.
- R4.4 There is no batch or loop mode.

### R5. Status and stats
- R5.1 `status` shows terms, hourly and per-market limits, reward cap, and cache state.
- R5.2 `stats` shows counts by verdict, recorded bounties, and per-source totals, duplicates, and accepted counts.

### R6. Security and privacy
- R6.1 The API key is read only from `DELPHI_API_ACCESS_KEY` or a local git-ignored `.env`. It is never written to the cache or printed.
- R6.2 The cache directory is `0700` and `history.json` is `0600`. No third-party service is called.
- R6.3 API errors are shown with the Delphi error code and message. 429 and 5xx responses are retried with backoff.

## Out of scope
Trading, creating markets, generating or fabricating evidence, scraping the web app, inferring other users' submissions, and evading Delphi's duplicate or fraud checks. Semantic embeddings are not implemented.
