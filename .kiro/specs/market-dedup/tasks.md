# Implementation Plan: delphi-check

- [x] 1. Project setup
  - [x] 1.1 Node 20 + TypeScript package, `delphi-check` bin, no runtime dependencies
  - [x] 1.2 Config: env vars, `.env` loader, thresholds
  - [x] 1.3 Confirm field names against `https://delphi.fyi/v1/openapi.json`
  - _Requirements: R6.1, R2.10_

- [x] 2. Local store (JSON cache, dir 0700, file 0600, atomic write)
  - _Requirements: R1.2, R6.2_

- [x] 3. Delphi client
  - [x] 3.1 Evidence API: terms, limits, entry-state, list and get submissions, multipart submit with idempotency key, polling
  - [x] 3.2 Markets API: list open markets, get market
  - [x] 3.3 Retry 429 and 5xx with backoff, map both error body shapes
  - _Requirements: R1.1, R3.1, R4.3, R6.3_

- [x] 4. `sync` command
  - _Requirements: R1.1 to R1.4_

- [x] 5. Fact extraction and similarity
  - _Requirements: R2.4_

- [x] 6. Risk scoring and verdict
  - _Requirements: R2.2, R2.3, R2.5 to R2.10_

- [x] 7. `check`, `markets`, `status`, `stats` commands
  - _Requirements: R2.1, R3.1, R5.1, R5.2_

- [x] 8. Gated `submit` command (confirmation, terms check, no batch mode)
  - _Requirements: R4.1 to R4.4_

- [x] 9. Tests
  - [x] 9.1 Offline test suite (17 tests) via `npm test`
  - [x] 9.2 Live checks against the real API: status, sync, markets, check, error paths, and submit cancel path (no evidence was sent)

- [x] 10. Documentation: `README.md` and `skills/delphi-evidence/SKILL.md`

## Not implemented (optional later work)
- [ ] `angles` command that suggests evidence types not tried yet
- [ ] Opt-in semantic embeddings for similarity
- [ ] Tuning of risk weights and domain lists from a larger accepted/rejected history
- [ ] HTTP-mocked tests for `sync` and `submit`
