# Implementation Plan: Delphi Evidence Pre-Check (CLI)

- [ ] 1. Project setup
  - [ ] 1.1 Initialize Node 20 + TypeScript package with `commander`, `zod`, `better-sqlite3`, `@gensyn-ai/gensyn-delphi-sdk` (≥ 2.3.0), Vitest; expose `delphi-check` bin
  - [ ] 1.2 Config loader: `DELPHI_API_ACCESS_KEY` from env, thresholds from `~/.config/delphi-check/config.json`
  - [ ] 1.3 Download and read `https://delphi.fyi/v1/openapi.json` and confirm field names for submissions, entry-state, and limits before coding the client
  - _Requirements: R6.1_

- [ ] 2. Local store
  - [ ] 2.1 SQLite setup with migrations for `submissions` and `markets`, file mode 0600
  - [ ] 2.2 Repository functions: upsert submission, list by market, upsert market
  - _Requirements: R1.2, R1.3, R6.3_

- [ ] 3. Delphi client wrapper
  - [ ] 3.1 Wrapper around `EvidenceClient` and `DelphiClient` with agent headers and typed errors
  - [ ] 3.2 Functions: listSubmissions (paged), getEntryState, getLimits, getTerms, getMarket
  - _Requirements: R1.1, R2.6, R4.4_

- [ ] 4. Sync command
  - [ ] 4.1 `sync`: page through submissions, fetch market metadata for new markets, store with fact signature
  - [ ] 4.2 Safe re-run and clear progress output
  - _Requirements: R1.1 to R1.3_

- [ ] 5. Fact extraction
  - [ ] 5.1 Parse the `As of YYYY-MM-DD:` prefix and normalize text
  - [ ] 5.2 Extract dates, numbers with units (including `h:mm:ss`), entities, document IDs, event verbs, link domains
  - [ ] 5.3 Unit tests using the five screenshot examples plus reworded variants
  - _Requirements: R2.3_

- [ ] 6. Comparison and rules
  - [ ] 6.1 Similarity scorer: token Jaccard + character 3-gram + fact overlap
  - [ ] 6.2 Verdict logic (`skip` / `review` / `send`) with reasons and closest past submission
  - [ ] 6.3 Quality rules: missing date/source, predictive wording, restating the market question
  - [ ] 6.4 Unit tests for reworded duplicates versus genuinely new facts
  - _Requirements: R2.2 to R2.5, R2.7_

- [ ] 7. Check command
  - [ ] 7.1 `check --market --note --link`: run pipeline, call `getEntryState`, print verdict
  - [ ] 7.2 Offline behavior: local comparison only, `send` downgraded to `review`
  - _Requirements: R2.1, R2.6, R2.7_

- [ ] 8. Angles and stats
  - [ ] 8.1 `angles`: classify past submissions by evidence type and list missing types
  - [ ] 8.2 `stats`: acceptance and duplicate rates, rejected count per market
  - _Requirements: R3.1, R3.2, R5.1_

- [ ] 9. Gated submit
  - [ ] 9.1 `submit`: check, confirm prompt, terms check, `submitEvidence` with idempotency key
  - [ ] 9.2 Poll with `waitForSubmission`, handle `429` and `5xx`, store result
  - [ ] 9.3 Enforce one confirmation per submission, no batch mode
  - _Requirements: R4.1 to R4.4_

- [ ] 10. Tests and docs
  - [ ] 10.1 Mock HTTP server tests for sync, check, and submit flows (no live calls)
  - [ ] 10.2 README: install on Linux, get API key, first `sync`, example `check` output, known limits
  - [ ] 10.3 Tune thresholds from the user's own synced history and record the chosen values
  - _Requirements: R2.1, R4.1_
