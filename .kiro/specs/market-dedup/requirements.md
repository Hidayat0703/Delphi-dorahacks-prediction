# Requirements: Delphi Evidence Pre-Check (CLI)

Replaces the earlier platform-side design. Based on the user's screenshot and the Delphi docs.

## Problem
The user submits evidence notes through Delphi's *Sell information* feature (e.g. "As of 2026-11-25: Japan's food consumption tax cut bill ..."). Many come back as **Not accepted: We already have this**. Per the Delphi docs, that means the same information was already accepted on that market, from the user or from someone else. Delphi does not say which earlier submission matched. Rejected submissions still count toward the per-market limit, so each wasted submission reduces what the user can send later.

## Scope
A local Linux command-line tool that checks a draft note before it is sent, using only data the user is allowed to see. It does not bypass or probe Delphi's own duplicate check.

## Known limit
The tool cannot see other users' accepted submissions. It reduces self-duplicates and low-value submissions. It cannot guarantee that a submission is not a duplicate of someone else's.

## Assumptions (confirm)
- **[A1]** The user has a Delphi Mainnet API key from api-access.delphi.fyi and has signed in to the app once.
- **[A2]** The user runs Linux with Node.js 20 or newer.
- **[A3]** The tool uses the official `@gensyn-ai/gensyn-delphi-sdk` (version 2.3.0 or newer).
- **[A4]** The user writes the notes. The tool does not invent facts.

## Requirements

### R1. Sync history
- R1.1 `delphi-check sync` downloads the user's past submissions (`listSubmissions`) and their statuses into a local SQLite file.
- R1.2 Each stored submission keeps market address, note text, links, status, reason, and timestamp.
- R1.3 Sync can be re-run safely and only adds or updates records.

### R2. Check a draft
- R2.1 `delphi-check check --market <address> --note <file|text> [--link <url>...]` returns a verdict: `send`, `review`, or `skip`.
- R2.2 It compares the draft against the user's own past submissions on the same market. A near-identical or reworded fact returns `skip` with the matching past submission shown.
- R2.3 It extracts the claim parts (subject, date, number, source domain) and compares them. Changing only wording does not make a fact new.
- R2.4 It warns when the draft has no concrete date, no source link, or reads as a prediction instead of a fact (Delphi docs say these are less likely to be accepted).
- R2.5 It warns when the draft only restates the market's own question or description, which Delphi already has.
- R2.6 It calls `getEntryState` for the market and reports submissions left. If none are left, the verdict is `skip`.
- R2.7 Every verdict lists its reasons.

### R3. Find an angle
- R3.1 `delphi-check angles --market <address>` lists the user's past accepted and rejected facts on that market and shows which fact types have not been tried (e.g. official schedule, vote count, local notice, source document).
- R3.2 The command suggests what kind of evidence to look for. It does not write facts.

### R4. Gated submit (optional)
- R4.1 `delphi-check submit` runs the check first and sends only on `send`, after the user confirms on the terminal.
- R4.2 Submissions use an `Idempotency-Key`, and the tool respects `RateLimit-*` headers and `getLimits`.
- R4.3 The tool never sends in batch or loop mode without a confirmation per submission.
- R4.4 The tool refuses to submit if the terms are not accepted and tells the user to accept them in the app or with `getTerms`.

### R5. Reporting
- R5.1 `delphi-check stats` shows acceptance rate, duplicate rate, and rejected-count per market from local history.

### R6. Security and privacy
- R6.1 The API key is read from the `DELPHI_API_ACCESS_KEY` environment variable and is never written to disk or logs.
- R6.2 Submission text stays on the local machine. No third-party service is called by default. Embedding support is opt-in.
- R6.3 The local database file has permissions `0600`.

## Out of scope
Trading, creating markets, generating or fabricating evidence, scraping the web app, inferring other users' submissions, and evading Delphi's duplicate or fraud checks.
