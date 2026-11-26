import { THRESHOLD_REVIEW, THRESHOLD_SKIP } from "./config.js";
import type { EntryState } from "./api.js";
import type { Db, StoredSubmission } from "./store.js";
import { containment, domainOf, extractFacts, factOverlap, hedgeCount, textSimilarity } from "./text.js";

export type Verdict = "send" | "review" | "skip";

export interface Draft {
  market: string;
  note: string;
  links: string[];
}

export interface MarketInfo {
  question: string;
  resolvesAt: string | null;
  createdAt: string | null;
}

export interface Report {
  verdict: Verdict;
  risk: number; // 0..100, higher = more likely to be rejected
  reasons: string[]; // things that raise risk or block
  positives: string[]; // things that lower risk
  closest?: { id: string; market: string; similarity: number; verdict: string | null };
}

// Outlets whose headlines the Delphi forecaster very likely already has. Delphi's own docs say
// widely reported news tends to earn nothing.
const NEWS_DOMAINS = [
  "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "cnn.com", "nytimes.com", "washingtonpost.com",
  "bloomberg.com", "ft.com", "wsj.com", "theguardian.com", "aljazeera.com", "cnbc.com", "forbes.com",
  "yahoo.com", "msn.com", "foxnews.com", "nbcnews.com", "cbsnews.com", "politico.com", "axios.com",
  "espn.com", "skysports.com", "nhk.or.jp", "japantimes.co.jp", "koreaherald.com", "koreatimes.co.kr",
  "yna.co.kr", "dw.com", "spiegel.de", "tagesschau.de", "wikipedia.org", "x.com", "twitter.com",
  "coindesk.com", "cointelegraph.com", "polymarket.com", "kalshi.com",
];

// Primary-source style hosts and suffixes.
const PRIMARY_SUFFIXES = [".gov", ".gov.uk", ".go.jp", ".go.kr", ".gov.au", ".gc.ca", ".europa.eu", ".int", ".mil", ".edu", ".ac.uk", ".parlament.gv.at"];
const PRIMARY_HOSTS = [
  "bundestag.de", "bundesrat.de", "sangiin.go.jp", "shugiin.go.jp", "assembly.go.kr", "congress.gov", "sec.gov",
  "courtlistener.com", "supremecourt.gov", "parliament.uk", "legislation.gov.uk", "eur-lex.europa.eu",
  "un.org", "who.int", "imf.org", "worldbank.org", "fide.com", "uefa.com", "fifa.com", "olympics.com",
  "federalreserve.gov", "ecb.europa.eu", "boj.or.jp",
];

function isNews(d: string): boolean {
  return NEWS_DOMAINS.some((n) => d === n || d.endsWith("." + n));
}
function isPrimary(d: string): boolean {
  return PRIMARY_HOSTS.some((h) => d === h || d.endsWith("." + h)) || PRIMARY_SUFFIXES.some((s) => d.endsWith(s));
}

/** Per-domain duplicate rate learned from the user's own history. */
export function domainStats(db: Db): Map<string, { total: number; dup: number; ok: number }> {
  const m = new Map<string, { total: number; dup: number; ok: number }>();
  for (const s of db.submissions) {
    if (!s.verdict) continue;
    for (const l of new Set(s.links.map(domainOf).filter(Boolean) as string[])) {
      const e = m.get(l) ?? { total: 0, dup: 0, ok: 0 };
      e.total++;
      if (s.verdict === "duplicate") e.dup++;
      if (s.verdict === "accepted") e.ok++;
      m.set(l, e);
    }
  }
  return m;
}

function explainEntry(e: EntryState): string {
  const map: Record<string, string> = {
    closed: "the market is closed for evidence",
    blocked: "the account is blocked for this market",
    cap_reached: "the per-market submission limit is already used",
    rate_limited: "the hourly limit is reached",
    not_open: "the market is not open",
    terms_not_accepted: "the Delphi terms are not accepted yet",
  };
  return map[e.reason ?? ""] ?? `Delphi says you cannot submit (${e.reason ?? "unknown reason"})`;
}

export function analyze(draft: Draft, market: MarketInfo | null, entry: EntryState | null, db: Db, now = new Date()): Report {
  const reasons: string[] = [];
  const positives: string[] = [];
  let risk = 0;
  let hardSkip = false;
  const note = draft.note.trim();

  // 1. Hard blockers from Delphi itself.
  if (entry && !entry.canSubmit) {
    hardSkip = true;
    reasons.push(`Delphi blocks submission: ${explainEntry(entry)}.`);
  } else if (!entry) {
    risk += 10;
    reasons.push("Could not read Delphi entry-state (offline?). Limits were not verified.");
  }
  if (note.length === 0) {
    hardSkip = true;
    reasons.push("Note is empty.");
  }
  if (note.length > 8000) {
    hardSkip = true;
    reasons.push("Note is longer than the 8,000 character limit.");
  }
  if (draft.links.length > 2) {
    hardSkip = true;
    reasons.push("A submission holds at most 3 items in total (the note counts as 1), so at most 2 links.");
  }

  const facts = extractFacts(note, draft.links);

  // 2. Own history on this market and across markets.
  const own = db.submissions.filter((s) => s.note);
  let closest: Report["closest"];
  let best = 0;
  let bestSub: StoredSubmission | undefined;
  for (const s of own) {
    const sim = Math.max(textSimilarity(note, s.note), 0);
    const fo = factOverlap(facts, extractFacts(s.note, s.links));
    const score = Math.max(sim, fo.overlap >= 0.85 && fo.newItems.length === 0 ? 0.9 : 0);
    if (score > best) {
      best = score;
      bestSub = s;
    }
  }
  if (bestSub) closest = { id: bestSub.id, market: bestSub.market, similarity: Number(best.toFixed(2)), verdict: bestSub.verdict };
  if (bestSub && best >= 0.8) {
    hardSkip = true;
    reasons.push(
      `Almost the same as your earlier submission ${bestSub.id.slice(0, 8)} (similarity ${best.toFixed(2)}, verdict ${bestSub.verdict ?? bestSub.status}). Look for a different fact.`
    );
  } else if (bestSub && best >= 0.6) {
    risk += 25;
    reasons.push(`Similar to your earlier submission ${bestSub.id.slice(0, 8)} (similarity ${best.toFixed(2)}).`);
  }
  const sameMarket = own.filter((s) => s.market.toLowerCase() === draft.market.toLowerCase());
  if (sameMarket.some((s) => s.verdict === "accepted")) {
    risk += 30;
    reasons.push("You already have an accepted submission on this market.");
  }

  // 3. Quality of the evidence itself.
  if (!facts.asOf) {
    risk += 5;
    reasons.push('No "As of YYYY-MM-DD:" prefix.');
  } else {
    const ageDays = (now.getTime() - new Date(facts.asOf + "T00:00:00Z").getTime()) / 86_400_000;
    if (ageDays > 7) {
      risk += 10;
      reasons.push(`The "As of" date is ${Math.floor(ageDays)} days old.`);
    }
    if (ageDays < -1) {
      risk += 25;
      reasons.push('The "As of" date is in the future.');
    }
  }
  if (facts.dates.size === 0) {
    risk += 20;
    reasons.push("No concrete date in the note (Delphi asks for when and where).");
  } else positives.push(`${facts.dates.size} date reference(s)`);

  if (draft.links.length === 0) {
    risk += 25;
    reasons.push("No source link. Evidence with a checkable source is accepted more often.");
  }
  const concrete = facts.numbers.size + facts.ids.size;
  if (concrete === 0) {
    risk += 15;
    reasons.push("No specific number, count, time, or document ID.");
  } else positives.push(`${concrete} specific number(s)/ID(s)`);

  const hedges = hedgeCount(note);
  if (hedges >= 3) {
    risk += 30;
    reasons.push("Reads like a prediction or opinion, not an observed fact.");
  } else if (hedges >= 1) {
    risk += 12;
    reasons.push("Contains hedging words (likely, may, could...). State the fact only.");
  }
  if (note.length > 0 && note.length < 120) {
    risk += 15;
    reasons.push("Very short note. Add the date, place, and source detail.");
  }

  // 4. Does it only repeat what the market already says?
  if (market?.question) {
    const c = containment(note.replace(/^as of \d{4}-\d{2}-\d{2}\s*:/i, ""), market.question);
    if (c >= 0.6) {
      risk += 20;
      reasons.push(`Mostly repeats the market question (${Math.round(c * 100)}% of its words).`);
    }
    if (market.resolvesAt && facts.asOf && new Date(facts.asOf) > new Date(market.resolvesAt)) {
      risk += 20;
      reasons.push("The note is dated after the market's resolve time.");
    }
  }

  // 5. Source type and learned history.
  const stats = domainStats(db);
  let newsHits = 0;
  for (const d of facts.domains) {
    if (isNews(d)) {
      newsHits++;
      risk += 10;
      reasons.push(`${d} is widely covered news. Delphi's forecaster likely has it already.`);
    }
    if (isPrimary(d)) {
      risk -= 15;
      positives.push(`${d} looks like a primary source`);
    }
    const st = stats.get(d);
    if (st && st.total >= 2 && st.dup / st.total >= 0.8 && st.ok === 0) {
      risk += 15;
      reasons.push(`${d} was in ${st.dup} of your ${st.total} earlier duplicates, none accepted.`);
    }
    if (st && st.ok >= 1) {
      risk -= 5;
      positives.push(`${d} was accepted before`);
    }
  }
  if (newsHits === facts.domains.size && facts.domains.size > 0) risk += 5;

  risk = Math.max(0, Math.min(100, Math.round(risk)));
  const verdict: Verdict = hardSkip || risk >= THRESHOLD_SKIP ? "skip" : risk >= THRESHOLD_REVIEW ? "review" : "send";
  return { verdict, risk, reasons, positives, closest };
}
