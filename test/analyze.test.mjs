// Offline tests (no network, no API key). Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../dist/analyze.js";
import { extractFacts, textSimilarity, containment, hedgeCount, normalize } from "../dist/text.js";

const NOW = new Date("2026-11-26T03:00:00Z");
const OPEN = { canSubmit: true, remainingOnMarket: 1, judgementPotRemainingBaseUnits: "20000000" };
const MKT = "0x96fd040517bbf73b2980e700e9a164d6efe672ec";
const info = {
  question: "Will Statistics Canada report a November 2026 unemployment rate of 6.8% or higher on Dec 4, 2026?",
  resolvesAt: "2026-12-04T12:30:00Z",
  createdAt: "2026-11-20T00:00:00Z",
};
const emptyDb = () => ({ submissions: [], markets: {}, syncedAt: null });
const good = {
  market: MKT,
  note: "As of 2026-11-26: Statistics Canada's release calendar lists the Labour Force Survey for November 2026 at 8:30 ET on Dec 4, 2026, table 14-10-0287-01.",
  links: ["https://www150.statcan.gc.ca/n1/dai-quo/cal2-eng.htm"],
};

test("normalize drops the As-of prefix and thousands separators", () => {
  assert.equal(normalize("As of 2026-11-25: Vote of 1,234 members"), "vote of 1234 members");
});

test("extractFacts finds dates, numbers, ids, domains, as-of", () => {
  const f = extractFacts("As of 2026-11-25: The bill BT-Drs. 21/8869 passed 119 of 246 seats on Nov 6, 2026 at 2:03:00.", ["https://www.bundestag.de/x"]);
  assert.equal(f.asOf, "2026-11-25");
  assert.ok(f.dates.has("11-06") && f.dates.has("2026-11-06") && f.dates.has("11-25"));
  assert.ok(f.numbers.has("119") && f.numbers.has("246") && f.numbers.has("2:03:00"));
  assert.ok([...f.ids].some((x) => x.includes("21/8869")));
  assert.ok(f.domains.has("bundestag.de"));
});

test("plain years are not counted as numbers", () => {
  assert.equal(extractFacts("In 2026 it happened.").numbers.size, 0);
});

test("reworded same text is highly similar, different fact is not", () => {
  const a = "The House of Councillors special committee met on Nov 25 and set the vote for Dec 2.";
  const b = "On Nov 25 the special committee of the House of Councillors met and set the vote for Dec 2.";
  const c = "Valencia Marathon organizers published the elite entry list with 14 men under 2:05.";
  assert.ok(textSimilarity(a, b) > 0.6, "reworded should be similar");
  assert.ok(textSimilarity(a, c) < 0.25, "unrelated should differ");
});

test("containment and hedges", () => {
  assert.ok(containment("Will Statistics Canada report unemployment", "Will Statistics Canada report a November unemployment rate") > 0.9);
  assert.ok(hedgeCount("I think it will probably happen, it could pass") >= 3);
  assert.equal(hedgeCount("The agenda lists item 12 at 10:15."), 0);
});

test("good primary-source draft is SEND", () => {
  const r = analyze(good, info, OPEN, emptyDb(), NOW);
  assert.equal(r.verdict, "send", JSON.stringify(r));
  assert.ok(r.positives.some((p) => p.includes("primary")));
});

test("Delphi cap_reached forces SKIP even for a good note", () => {
  const r = analyze(good, info, { ...OPEN, canSubmit: false, reason: "cap_reached", remainingOnMarket: 0 }, emptyDb(), NOW);
  assert.equal(r.verdict, "skip");
  assert.ok(r.reasons[0].includes("limit"));
});

test("prediction with no date, source or number is SKIP", () => {
  const r = analyze({ market: MKT, note: "I think this will probably go up, it could happen soon", links: [] }, info, OPEN, emptyDb(), NOW);
  assert.equal(r.verdict, "skip");
});

test("news-only source raises risk versus primary source", () => {
  const news = analyze({ ...good, links: ["https://www.reuters.com/world/x"] }, info, OPEN, emptyDb(), NOW);
  const prim = analyze(good, info, OPEN, emptyDb(), NOW);
  assert.ok(news.risk > prim.risk);
});

test("resending an earlier note on another market is SKIP", () => {
  const db = emptyDb();
  db.submissions.push({ id: "aaaaaaaa-1", createdAt: "2026-11-25T00:00:00Z", market: "0xold", note: good.note, links: good.links, status: "judged", verdict: "duplicate", reason: "We already have this information.", bounty: null });
  const r = analyze(good, info, OPEN, db, NOW);
  assert.equal(r.verdict, "skip");
  assert.ok(r.closest && r.closest.similarity >= 0.8);
});

test("same facts reworded are caught by fact overlap", () => {
  const db = emptyDb();
  db.submissions.push({ id: "bbbbbbbb-2", createdAt: "2026-11-25T00:00:00Z", market: "0xold", note: good.note, links: good.links, status: "judged", verdict: "duplicate", reason: null, bounty: null });
  const reworded = { ...good, note: "As of 2026-11-26: Labour Force Survey for November 2026, 8:30 ET, Dec 4, 2026, table 14-10-0287-01 per Statistics Canada's calendar." };
  const r = analyze(reworded, info, OPEN, db, NOW);
  assert.notEqual(r.verdict, "send");
});

test("a genuinely new fact is not blocked by unrelated history", () => {
  const db = emptyDb();
  db.submissions.push({ id: "cccccccc-3", createdAt: "2026-11-25T00:00:00Z", market: "0xold", note: "As of 2026-11-25: Valencia Marathon elite list published with 14 men under 2:05 at valenciaciudaddelrunning.com.", links: ["https://www.valenciaciudaddelrunning.com/x"], status: "judged", verdict: "duplicate", reason: null, bounty: null });
  const r = analyze(good, info, OPEN, db, NOW);
  assert.equal(r.verdict, "send", JSON.stringify(r));
});

test("learned domain penalty after repeated duplicates", () => {
  const db = emptyDb();
  for (let i = 0; i < 3; i++)
    db.submissions.push({ id: `d${i}-xxxxxxxx`, createdAt: "2026-11-25T00:00:00Z", market: `0x${i}`, note: `unrelated note number ${i} about topic ${i * 7} on Nov ${10 + i}, 2026`, links: ["https://blog.example.org/p" + i], status: "judged", verdict: "duplicate", reason: null, bounty: null });
  const d = { ...good, links: ["https://blog.example.org/new"] };
  const r = analyze(d, info, OPEN, db, NOW);
  assert.ok(r.reasons.some((x) => x.includes("blog.example.org")));
});

test("too many links and oversized note are blocked", () => {
  assert.equal(analyze({ ...good, links: ["https://a.gov/1", "https://a.gov/2", "https://a.gov/3"] }, info, OPEN, emptyDb(), NOW).verdict, "skip");
  assert.equal(analyze({ ...good, note: "x".repeat(8001) }, info, OPEN, emptyDb(), NOW).verdict, "skip");
});

test("stale and future As-of dates are flagged", () => {
  const stale = analyze({ ...good, note: good.note.replace("2026-11-26", "2026-11-01") }, info, OPEN, emptyDb(), NOW);
  const future = analyze({ ...good, note: good.note.replace("2026-11-26", "2026-12-20") }, info, OPEN, emptyDb(), NOW);
  assert.ok(stale.reasons.some((x) => x.includes("days old")));
  assert.ok(future.reasons.some((x) => x.includes("future")));
});

test("note that only restates the market question is penalized", () => {
  const r = analyze({ market: MKT, note: "As of 2026-11-26: Statistics Canada will report a November 2026 unemployment rate of 6.8% or higher on Dec 4, 2026.", links: ["https://statcan.gc.ca/a"] }, info, OPEN, emptyDb(), NOW);
  assert.ok(r.reasons.some((x) => x.includes("repeats the market question")));
});

test("missing entry-state is not treated as permission", () => {
  const r = analyze(good, info, null, emptyDb(), NOW);
  assert.ok(r.reasons.some((x) => x.includes("entry-state")));
});
