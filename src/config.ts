import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Minimal .env loader. Existing environment variables win.
function loadDotenv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const val = m[2].replace(/^['"]|['"]$/g, "");
    if (process.env[m[1]] === undefined && val !== "") process.env[m[1]] = val;
  }
}
loadDotenv(path.join(process.cwd(), ".env"));

export const EVIDENCE_BASE = (process.env.DELPHI_EVIDENCE_URL ?? "https://delphi.fyi/v1").replace(/\/$/, "");
export const MARKETS_BASE = (process.env.DELPHI_API_BASE_URL ?? "https://api.delphi.fyi").replace(/\/$/, "");
export const AGENT_ID = process.env.DELPHI_AGENT_ID ?? "delphi-check";

const home = process.env.DELPHI_CHECK_HOME ?? path.join(os.homedir(), ".local", "share", "delphi-check");
export const DATA_DIR = home.replace(/^~/, os.homedir());

export function apiKey(): string {
  const k = process.env.DELPHI_API_ACCESS_KEY;
  if (!k) {
    console.error(
      "DELPHI_API_ACCESS_KEY is not set.\n" +
        "Create a Mainnet key at https://api-access.delphi.fyi/ and export it:\n" +
        "  export DELPHI_API_ACCESS_KEY=...\n" +
        "(or put it in a git-ignored .env file)."
    );
    process.exit(2);
  }
  return k;
}

// Risk thresholds (0-100). Raise for fewer skips, lower to be stricter.
export const THRESHOLD_SKIP = Number(process.env.DELPHI_CHECK_SKIP ?? 60);
export const THRESHOLD_REVIEW = Number(process.env.DELPHI_CHECK_REVIEW ?? 35);
