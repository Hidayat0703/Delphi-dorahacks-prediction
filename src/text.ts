// Text helpers: normalization, similarity, and fact extraction. No network, no dependencies.

const STOP = new Set(
  ("a an the and or of to in on at by for from with as is are was were be been it its this that these those " +
    "will would can could may might should has have had not no yes than then there their they he she we you i " +
    "which who whom what when where while about after before over under into out up down per via").split(" ")
);

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^as of \d{4}-\d{2}-\d{2}\s*[:,-]\s*/, "")
    .replace(/(\d),(\d{3})/g, "$1$2")
    .replace(/[^\p{L}\p{N}:%./\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normalize(s)
    .split(/[\s]+/)
    .map((t) => t.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function trigrams(s: string): Set<string> {
  const t = ` ${normalize(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

/** Text similarity 0..1: mean of token Jaccard and character trigram Jaccard. */
export function textSimilarity(a: string, b: string): number {
  return (jaccard(new Set(tokens(a)), new Set(tokens(b))) + jaccard(trigrams(a), trigrams(b))) / 2;
}

/** Share of tokens in `a` that also appear in `b` (containment). */
export function containment(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0) return 0;
  let n = 0;
  for (const x of ta) if (tb.has(x)) n++;
  return n / ta.size;
}

export interface Facts {
  dates: Set<string>; // "MM-DD" (year ignored) plus full ISO dates
  numbers: Set<string>;
  ids: Set<string>;
  entities: Set<string>;
  domains: Set<string>;
  asOf: string | null; // ISO date from "As of YYYY-MM-DD:"
}

const CAP_STOP = new Set(["as", "the", "of", "on", "in", "at", "it", "its", "this", "that", "a", "an", "if", "but", "and", "for", "with", "by", "from", "after", "before", "when", "while"]);

export function domainOf(link: string): string | null {
  try {
    return new URL(link).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function extractFacts(note: string, links: string[] = []): Facts {
  const dates = new Set<string>();
  const numbers = new Set<string>();
  const ids = new Set<string>();
  const entities = new Set<string>();
  const pad = (n: number) => String(n).padStart(2, "0");

  const asOfM = note.match(/^\s*as of (\d{4}-\d{2}-\d{2})/i);
  const text = note.normalize("NFKC");

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    dates.add(`${m[2]}-${m[3]}`);
    dates.add(m[0]);
  }
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/gi)) {
    const mon = MONTHS[m[1].toLowerCase()];
    dates.add(`${pad(mon)}-${pad(Number(m[2]))}`);
    if (m[3]) dates.add(`${m[3]}-${pad(mon)}-${pad(Number(m[2]))}`);
  }
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?\b/gi)) {
    const mon = MONTHS[m[2].toLowerCase()];
    dates.add(`${pad(mon)}-${pad(Number(m[1]))}`);
    if (m[3]) dates.add(`${m[3]}-${pad(mon)}-${pad(Number(m[1]))}`);
  }

  const noDates = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  for (const m of noDates.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\b|\b\d[\d,]*(?:\.\d+)?%?/g)) {
    const v = m[0].replace(/,/g, "");
    if (/^(19|20)\d{2}$/.test(v)) continue; // plain years are not facts
    if (v.length === 1 && !v.includes("%")) continue;
    numbers.add(v);
  }

  for (const m of text.matchAll(/\b[\p{L}\d]+(?:[-/.][\p{L}\d]+)+\b/gu)) {
    if (/\d/.test(m[0]) && !/^\d{4}-\d{2}-\d{2}$/.test(m[0]) && !/^\d+\.\d+$/.test(m[0]) && m[0].length >= 4) ids.add(m[0].toLowerCase());
  }
  for (const m of text.matchAll(/\b(?:No\.|Nr\.|Art\.|Drs\.|H\.R\.|S\.)\s?\d[\w/.-]*/g)) ids.add(m[0].toLowerCase());

  for (const m of text.matchAll(/\b[A-Z][\p{L}'’-]{2,}(?:\s+[A-Z][\p{L}'’-]{2,})*\b/gu)) {
    const e = m[0].toLowerCase();
    if (CAP_STOP.has(e)) continue;
    entities.add(e);
  }

  const domains = new Set<string>();
  for (const l of links) {
    const d = domainOf(l);
    if (d) domains.add(d);
  }
  return { dates, numbers, ids, entities, domains, asOf: asOfM ? asOfM[1] : null };
}

/** How many of the draft's concrete facts (dates, numbers, ids, domains) already appear in `prev`. */
export function factOverlap(draft: Facts, prev: Facts): { overlap: number; newItems: string[] } {
  const items: Array<[string, Set<string>, Set<string>]> = [
    ["date", draft.dates, prev.dates],
    ["number", draft.numbers, prev.numbers],
    ["id", draft.ids, prev.ids],
    ["source", draft.domains, prev.domains],
  ];
  let total = 0;
  let shared = 0;
  const newItems: string[] = [];
  for (const [kind, d, p] of items) {
    for (const x of d) {
      total++;
      if (p.has(x)) shared++;
      else newItems.push(`${kind}:${x}`);
    }
  }
  return { overlap: total === 0 ? 0 : shared / total, newItems };
}

export const HEDGES = [
  "will likely", "likely to", "probably", "i think", "i believe", "we expect", "is expected to", "expected to",
  "could", "might", "may ", "should ", "seems", "appears to", "rumor", "rumour", "speculat", "unconfirmed",
];

export function hedgeCount(note: string): number {
  const n = ` ${note.toLowerCase()} `;
  return HEDGES.filter((h) => n.includes(h)).length;
}
