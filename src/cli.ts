#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import * as api from "./api.js";
import { analyze, domainStats, type Draft, type MarketInfo, type Report } from "./analyze.js";
import { loadDb, saveDb, upsertSubmission, type Db, type StoredSubmission } from "./store.js";

const HELP = `delphi-check: pre-submit checker for Delphi "Sell information" evidence.
Uses only the official Delphi API. Never submits without your confirmation.

Usage:
  delphi-check status                              Terms, limits, and local history summary
  delphi-check sync                                Download your past submissions into the local cache
  delphi-check markets [--scan 150] [--top 20]     Open markets you can still submit to, best reward pot first
  delphi-check check  --market 0x.. --note TEXT|@file [--link URL ...]
  delphi-check submit --market 0x.. --note TEXT|@file [--link URL ...] [--allow-review] [--yes]
  delphi-check stats                               Your accept/duplicate rates and per-source results

Environment:
  DELPHI_API_ACCESS_KEY   Mainnet key from https://api-access.delphi.fyi/ (required)
  DELPHI_AGENT_ID         Optional label sent as X-Agent-Id (default: delphi-check)

A "send" verdict is a risk estimate, not a guarantee. Other users' submissions are not visible,
so duplicates of their evidence cannot be detected in advance.`;

const usdc = (base: string | number) => (Number(base) / 1e6).toFixed(2);
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function flatten(s: api.SubmissionDto): StoredSubmission[] {
  const lines = s.markets.length ? s.markets : [undefined];
  return lines
    .filter((l): l is api.MarketLine => !!l)
    .map((l) => ({
      id: s.id,
      createdAt: s.createdAt,
      market: l.marketAddress.toLowerCase(),
      note: s.note ?? "",
      links: s.links ?? [],
      status: s.status,
      verdict: l.verdict,
      reason: l.reason,
      bounty: l.bounty?.amount ?? null,
    }));
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

async function marketInfo(db: Db, address: string): Promise<MarketInfo | null> {
  const key = address.toLowerCase();
  try {
    const m = await api.getMarket(key);
    const info = {
      question: m.metadata?.question ?? "",
      resolvesAt: m.resolvesAt,
      createdAt: m.createdAt,
      fetchedAt: new Date().toISOString(),
    };
    db.markets[key] = info;
    return info;
  } catch {
    return db.markets[key] ?? null;
  }
}

function readNote(v: string | undefined): string {
  if (!v) {
    console.error("--note is required (text, or @path/to/file.txt)");
    process.exit(2);
  }
  return v.startsWith("@") ? fs.readFileSync(v.slice(1), "utf8") : v;
}

function printReport(r: Report): void {
  const icon = { send: "SEND", review: "REVIEW", skip: "SKIP" }[r.verdict];
  console.log(`\nVerdict: ${icon}   (risk ${r.risk}/100)`);
  if (r.reasons.length) {
    console.log("\nConcerns:");
    r.reasons.forEach((x) => console.log("  - " + x));
  }
  if (r.positives.length) {
    console.log("\nGood signs:");
    r.positives.forEach((x) => console.log("  + " + x));
  }
  if (r.closest) console.log(`\nClosest earlier submission of yours: ${r.closest.id.slice(0, 8)} (similarity ${r.closest.similarity}, ${r.closest.verdict ?? "n/a"})`);
  console.log("\nNote: this estimates risk from your own history and the note itself. Other users' evidence is not visible.");
}

async function runCheck(db: Db, draft: Draft): Promise<Report> {
  const [info, entry] = await Promise.all([
    marketInfo(db, draft.market),
    api.getEntryState(draft.market.toLowerCase()).catch(() => null),
  ]);
  if (info) console.log(`Market: ${info.question}`);
  if (entry) console.log(`Entry:  canSubmit=${entry.canSubmit}  left on market=${entry.remainingOnMarket}  reward pot≈${usdc(entry.judgementPotRemainingBaseUnits)} USDC`);
  return analyze(draft, info, entry, db);
}

async function cmdSync(): Promise<void> {
  const db = loadDb();
  const subs = await api.listAllSubmissions();
  for (const s of subs) for (const row of flatten(s)) upsertSubmission(db, row);
  db.syncedAt = new Date().toISOString();
  const markets = [...new Set(db.submissions.map((s) => s.market))].filter((m) => !db.markets[m]);
  await pool(markets, 3, (m) => marketInfo(db, m));
  saveDb(db);
  console.log(`Synced ${subs.length} submissions across ${new Set(db.submissions.map((s) => s.market)).size} markets.`);
}

async function cmdStatus(): Promise<void> {
  const [terms, limits] = await Promise.all([api.getTerms(), api.getLimits()]);
  const db = loadDb();
  console.log(`Terms accepted: ${terms.acceptedAt ?? "NO (accept at " + terms.url + ")"}`);
  console.log(`Submits left this hour: ${limits.submitsLeftThisHour}/${limits.submitsPerHour} (resets ${limits.hourEndsAt})`);
  console.log(`Per-market limit: ${limits.submissionsPerMarket}`);
  console.log(`Daily reward cap left: ${usdc(limits.dailyCapLeft)} USDC`);
  console.log(`Local history: ${db.submissions.length} entries, last sync ${db.syncedAt ?? "never (run: delphi-check sync)"}`);
}

async function cmdMarkets(scan: number, top: number): Promise<void> {
  const db = loadDb();
  const used = new Set(db.submissions.map((s) => s.market));
  const open = await api.listOpenMarkets(scan);
  const fresh = open.filter((m) => !used.has(m.id.toLowerCase()));
  console.log(`Open markets scanned: ${open.length}. Not used by you yet: ${fresh.length}. Checking entry-state...`);
  const rows = await pool(fresh, 3, async (m) => {
    const e = await api.getEntryState(m.id.toLowerCase()).catch(() => null);
    return { m, e };
  });
  const ok = rows
    .filter((r) => r.e?.canSubmit)
    .sort((a, b) => Number(BigInt(b.e!.judgementPotRemainingBaseUnits) - BigInt(a.e!.judgementPotRemainingBaseUnits)))
    .slice(0, top);
  if (!ok.length) return void console.log("No submittable markets found.");
  console.log("\nPOT(USDC)  RESOLVES              ADDRESS                                     QUESTION");
  for (const { m, e } of ok) {
    console.log(`${usdc(e!.judgementPotRemainingBaseUnits).padStart(8)}   ${(m.resolvesAt ?? "-").slice(0, 16).padEnd(18)}   ${m.id}  ${short(m.metadata?.question ?? "", 70)}`);
  }
  console.log("\nPick markets where you can find a niche, primary-source fact. Skipping costs nothing.");
}

async function cmdStats(): Promise<void> {
  const db = loadDb();
  const rows = db.submissions;
  if (!rows.length) return void console.log("No local history. Run: delphi-check sync");
  const by: Record<string, number> = {};
  rows.forEach((r) => (by[r.verdict ?? r.status] = (by[r.verdict ?? r.status] ?? 0) + 1));
  console.log(`Submissions: ${rows.length}`);
  Object.entries(by).forEach(([k, v]) => console.log(`  ${k.padEnd(14)} ${v}  (${Math.round((v / rows.length) * 100)}%)`));
  const earned = rows.reduce((a, r) => a + (r.bounty ? Number(r.bounty) : 0), 0);
  console.log(`Bounties recorded: ${usdc(earned)} USDC`);
  const dom = [...domainStats(db).entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10);
  if (dom.length) {
    console.log("\nSources you used most:");
    dom.forEach(([d, s]) => console.log(`  ${d.padEnd(32)} total ${s.total}  duplicate ${s.dup}  accepted ${s.ok}`));
  }
}

async function cmdSubmit(draft: Draft, allowReview: boolean, yes: boolean): Promise<void> {
  const db = loadDb();
  const report = await runCheck(db, draft);
  printReport(report);
  if (report.verdict === "skip" || (report.verdict === "review" && !allowReview)) {
    console.log(report.verdict === "review" ? "\nNot submitted. Fix the concerns, or re-run with --allow-review if you are sure." : "\nNot submitted.");
    process.exitCode = 1;
    return;
  }
  const terms = await api.getTerms();
  if (!terms.acceptedAt) {
    console.error(`\nAccept the Delphi terms first: ${terms.url}`);
    process.exitCode = 1;
    return;
  }
  const limits = await api.getLimits();
  console.log(`\nSubmits left this hour: ${limits.submitsLeftThisHour}. Each market allows ${limits.submissionsPerMarket} submission(s).`);
  console.log("\n--- NOTE ---\n" + draft.note.trim() + "\n--- LINKS ---\n" + (draft.links.join("\n") || "(none)"));
  if (!yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question("\nSubmit this evidence to Delphi now? Only true, sourced facts. [y/N] ")).trim().toLowerCase();
    rl.close();
    if (ans !== "y" && ans !== "yes") return void console.log("Cancelled.");
  }
  let s = await api.submitEvidence(draft.market.toLowerCase(), draft.note.trim(), draft.links);
  if (s.status === "rejected") {
    console.log(`\nRejected: ${s.code ?? ""} ${s.message ?? ""}`);
  } else {
    console.log(`\nQueued (${s.id}). Waiting for the judge...`);
    s = await api.waitForSubmission(s.id);
  }
  for (const row of flatten(s)) upsertSubmission(db, row);
  saveDb(db);
  for (const l of s.markets) {
    console.log(`Result: ${l.status} / ${l.verdict ?? "-"}  ${l.reason ?? ""}${l.bounty ? `  bounty ${usdc(l.bounty.amount)} USDC (${l.bounty.state})` : ""}`);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return void console.log(HELP);
  const { values } = parseArgs({
    args: rest,
    options: {
      market: { type: "string" },
      note: { type: "string" },
      link: { type: "string", multiple: true },
      scan: { type: "string" },
      top: { type: "string" },
      "allow-review": { type: "boolean" },
      yes: { type: "boolean" },
    },
  });
  const draft = (): Draft => {
    if (!values.market || !/^0x[0-9a-fA-F]{40}$/.test(values.market)) {
      console.error("--market must be a market contract address (0x + 40 hex characters).");
      process.exit(2);
    }
    return { market: values.market, note: readNote(values.note), links: values.link ?? [] };
  };
  switch (cmd) {
    case "status": return cmdStatus();
    case "sync": return cmdSync();
    case "markets": return cmdMarkets(Number(values.scan ?? 150), Number(values.top ?? 20));
    case "stats": return cmdStats();
    case "check": {
      const db = loadDb();
      const d = draft();
      const r = await runCheck(db, d);
      saveDb(db);
      printReport(r);
      process.exitCode = r.verdict === "send" ? 0 : r.verdict === "review" ? 3 : 1;
      return;
    }
    case "submit": return cmdSubmit(draft(), !!values["allow-review"], !!values.yes);
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exitCode = 2;
  }
}

main().catch((e) => {
  if (e instanceof api.ApiError) {
    console.error(`Delphi API error ${e.status} ${e.code}: ${e.message}`);
    if (e.status === 401) console.error("Check DELPHI_API_ACCESS_KEY (must be a Mainnet key, and the wallet must have signed in to the app once).");
    if (e.status === 403) console.error("403: terms not accepted, or your region is restricted.");
  } else {
    console.error(e instanceof Error ? e.message : e);
  }
  process.exit(1);
});
