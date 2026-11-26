import { randomUUID } from "node:crypto";
import { AGENT_ID, EVIDENCE_BASE, MARKETS_BASE, apiKey } from "./config.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfterSeconds?: number
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function http<T>(url: string, init: RequestInit & { headers?: Record<string, string> }, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let body: any = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON body */
    }
    if (res.ok) return body as T;
    // Evidence API errors look like {"error":{"code","message","retryAfterSeconds"}}; the markets API uses {"error":"text"}.
    const err = typeof body?.error === "object" && body.error ? body.error : body;
    const retryAfter = Number(res.headers.get("retry-after") ?? err?.retryAfterSeconds ?? 0) || undefined;
    if ((res.status === 429 || res.status >= 500) && attempt < tries) {
      await sleep(Math.min((retryAfter ?? 2 * attempt) * 1000, 60_000));
      continue;
    }
    const code = typeof err?.code === "string" ? err.code : typeof body?.error === "string" ? "error" : "error";
    const message = typeof err?.message === "string" ? err.message : typeof body?.error === "string" ? body.error : text.slice(0, 200);
    throw new ApiError(res.status, code, message, retryAfter);
  }
}

function evidenceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${apiKey()}`, "X-Agent-Id": AGENT_ID, ...extra };
}

// ---- Evidence API (https://delphi.fyi/v1) ----

export interface Terms { version: string; url: string; acceptedAt: string | null }
export interface Limits {
  submitsPerHour: number;
  submissionsPerMarket: number;
  submitsLeftThisHour: number;
  hourEndsAt: string;
  dailyCapLeft: string;
  dailyCapResetAt: string | null;
}
export interface EntryState {
  canSubmit: boolean;
  reason?: string;
  remainingOnMarket: number;
  judgementPotRemainingBaseUnits: string;
  restricted?: boolean;
  rateLimit?: { resetAt: string };
}
export interface MarketLine {
  marketAddress: string;
  status: string;
  verdict: string | null;
  reason: string | null;
  bounty: { amount: string; state: string } | null;
  settlementUpTo: string | null;
  zeroPayReason?: string;
}
export interface SubmissionDto {
  id: string;
  createdAt: string;
  agentId: string | null;
  note: string | null;
  links: string[];
  status: string;
  code?: string;
  message?: string;
  canRetry?: boolean;
  markets: MarketLine[];
}

export const getTerms = () => http<Terms>(`${EVIDENCE_BASE}/terms`, { headers: evidenceHeaders() });
export const getLimits = () => http<Limits>(`${EVIDENCE_BASE}/limits`, { headers: evidenceHeaders() });
export const getEntryState = (market: string) =>
  http<EntryState>(`${EVIDENCE_BASE}/markets/${encodeURIComponent(market)}/entry-state`, { headers: evidenceHeaders() });

export async function listAllSubmissions(): Promise<SubmissionDto[]> {
  const out: SubmissionDto[] = [];
  let cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const page = await http<{ items: SubmissionDto[]; nextCursor: string | null }>(
      `${EVIDENCE_BASE}/submissions?${qs}`,
      { headers: evidenceHeaders() }
    );
    out.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return out;
}

export const getSubmission = (id: string) =>
  http<SubmissionDto>(`${EVIDENCE_BASE}/submissions/${encodeURIComponent(id)}`, { headers: evidenceHeaders() });

export async function submitEvidence(
  marketAddress: string,
  note: string,
  links: string[],
  idempotencyKey: string = randomUUID()
): Promise<SubmissionDto> {
  const form = new FormData();
  form.set("marketAddress", marketAddress);
  form.set("note", note);
  for (const l of links) form.append("links[]", l);
  return http<SubmissionDto>(
    `${EVIDENCE_BASE}/submissions`,
    { method: "POST", body: form, headers: evidenceHeaders({ "Idempotency-Key": idempotencyKey }) },
    2
  );
}

export async function waitForSubmission(id: string, timeoutMs = 10 * 60_000): Promise<SubmissionDto> {
  const start = Date.now();
  for (;;) {
    const s = await getSubmission(id);
    if (!["queued", "judging"].includes(s.status)) return s;
    if (Date.now() - start > timeoutMs) return s;
    await sleep(10_000);
  }
}

// ---- Markets API (https://api.delphi.fyi) ----

export interface Market {
  id: string;
  status: string;
  category: string;
  createdAt: string;
  resolvesAt: string | null;
  settlesAt: string | null;
  metadata: { question?: string; outcomes?: string[] } | null;
}

const marketHeaders = () => ({ "X-API-Key": apiKey() });

export async function listOpenMarkets(maxMarkets = 300): Promise<Market[]> {
  const out: Market[] = [];
  const limit = 100;
  for (let skip = 0; out.length < maxMarkets; skip += limit) {
    const qs = new URLSearchParams({ status: "open", limit: String(limit), skip: String(skip), orderBy: "created" });
    const { markets } = await http<{ markets: Market[] }>(`${MARKETS_BASE}/markets?${qs}`, { headers: marketHeaders() });
    out.push(...(markets ?? []));
    if (!markets || markets.length < limit) break;
  }
  return out.slice(0, maxMarkets);
}

export const getMarket = (id: string) =>
  http<Market>(`${MARKETS_BASE}/markets/${encodeURIComponent(id)}`, { headers: marketHeaders() });
