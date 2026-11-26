import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";

export interface StoredSubmission {
  id: string;
  createdAt: string;
  market: string;
  note: string;
  links: string[];
  status: string; // submission status
  verdict: string | null; // per-market verdict, e.g. accepted / duplicate
  reason: string | null;
  bounty: string | null; // base units
}

export interface StoredMarket {
  question: string;
  resolvesAt: string | null;
  createdAt: string | null;
  fetchedAt: string;
}

export interface Db {
  submissions: StoredSubmission[];
  markets: Record<string, StoredMarket>;
  syncedAt: string | null;
}

const FILE = path.join(DATA_DIR, "history.json");

export function loadDb(): Db {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Db;
  } catch {
    return { submissions: [], markets: {}, syncedAt: null };
  }
}

export function saveDb(db: Db): void {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  fs.chmodSync(FILE, 0o600);
}

export function upsertSubmission(db: Db, s: StoredSubmission): void {
  const i = db.submissions.findIndex((x) => x.id === s.id && x.market === s.market);
  if (i >= 0) db.submissions[i] = s;
  else db.submissions.push(s);
}
