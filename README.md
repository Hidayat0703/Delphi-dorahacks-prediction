# delphi-check

A command-line pre-submit checker for Delphi's **Sell information** (Evidence API). It uses only the official Delphi API with your own key. It never bypasses Delphi's checks, never submits without your confirmation, and has no batch mode.

## What it does

| Command | Purpose |
|---|---|
| `status` | Terms accepted, hourly and per-market limits, reward cap. |
| `sync` | Downloads your past submissions into a local cache (`~/.local/share/delphi-check/history.json`, mode 0600). |
| `markets` | Scans open markets, drops the ones you already used, and keeps only those Delphi says you can still submit to. Sorted by remaining reward pot. |
| `check` | Scores a draft note and returns `SEND`, `REVIEW`, or `SKIP` with reasons. Exit codes: 0 send, 3 review, 1 skip. |
| `submit` | Runs `check`, shows the note, asks for confirmation, then submits with an `Idempotency-Key` and waits for the result. |
| `stats` | Your accept and duplicate rates and per-source results. |

## What `check` looks at

- Delphi's own `entry-state` (can you submit, how many left, reward pot).
- Your own past notes: same text, or same facts (dates, numbers, IDs, sources) reworded.
- Evidence quality: date, source link, specific numbers or IDs, hedging or predictions, length, a note that only repeats the market question, a future or stale "As of" date.
- Source type: widely covered news outlets raise risk (Delphi's docs say widely reported news tends to earn nothing). Primary sources (government, parliament, official bodies) lower it.
- Learned from your history: sources that appeared in several of your duplicates and never in an accepted submission.

## Limits you should know

- **It cannot see other users' submissions.** Delphi marks a submission `duplicate` when every item already exists on the market, from any account, and it does not say which one matched. No client can detect that in advance. `check` estimates risk. It does not guarantee anything.
- The tool does not write facts. Submit only things you actually found or observed, with a real source. Made-up or misleading submissions are not paid, and repeated cases block the account.

## Install (Linux, Node 20+)

```bash
git clone <your-repo-url> delphi-check && cd delphi-check
npm install
npm run build
npm link            # optional: makes the `delphi-check` command global
```

## Test

```bash
npm test      # builds, then runs the offline test suite (no API key needed)
```

## Configure

Create a **Mainnet** API key at https://api-access.delphi.fyi/, sign in to the Delphi app once with that wallet, then:

```bash
export DELPHI_API_ACCESS_KEY=...      # or put it in a git-ignored .env file
```

The key is only read from the environment or a local `.env`. `.env` is in `.gitignore`. Do not commit it.

## Example

```bash
delphi-check status
delphi-check sync
delphi-check markets --scan 150 --top 15
echo "As of 2026-11-26: ..." > note.txt
delphi-check check  --market 0x... --note @note.txt --link https://official.source/page
delphi-check submit --market 0x... --note @note.txt --link https://official.source/page
```

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `DELPHI_AGENT_ID` | `delphi-check` | Sent as `X-Agent-Id`. |
| `DELPHI_CHECK_SKIP` | `60` | Risk at or above this gives `SKIP`. |
| `DELPHI_CHECK_REVIEW` | `35` | Risk at or above this gives `REVIEW`. |
| `DELPHI_CHECK_HOME` | `~/.local/share/delphi-check` | Where the local cache lives. |
| `DELPHI_EVIDENCE_URL` | `https://delphi.fyi/v1` | Evidence API base URL. |
| `DELPHI_API_BASE_URL` | `https://api.delphi.fyi` | Markets API base URL. |

## Endpoints used

Evidence API (`Authorization: Bearer`): `GET /terms`, `GET /limits`, `GET /markets/{market}/entry-state`, `GET /submissions`, `GET /submissions/{id}`, `POST /submissions`.
Markets API (`X-API-Key`): `GET /markets`, `GET /markets/{id}`.
Reference: https://delphi.fyi/v1/openapi.json and https://docs.delphi.fyi/sell-information.md
