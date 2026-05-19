import assert from "node:assert/strict";
import test from "node:test";

import {
  createSearchPlan,
  evaluateSearch,
  findMatchesInText,
  parseKeywords,
  selectNonOverlappingMatches,
} from "../src/shared/search-core.js";

test("parseKeywords splits comma and newline separated input", () => {
  assert.deepEqual(parseKeywords("alpha, beta\n gamma,,\n"), ["alpha", "beta", "gamma"]);
});

test("OR and AND page filtering semantics are distinct", () => {
  const orResult = evaluateSearch("alpha only", createSearchPlan("alpha, beta", { operator: "or" }));
  const andResult = evaluateSearch("alpha only", createSearchPlan("alpha, beta", { operator: "and" }));

  assert.equal(orResult.isMatch, true);
  assert.equal(andResult.isMatch, false);
  assert.deepEqual(andResult.termHits, [true, false]);
});

test("case insensitive search is the default and case-sensitive can be enabled", () => {
  assert.equal(findMatchesInText("Alpha alpha", createSearchPlan("alpha")).length, 2);
  assert.equal(findMatchesInText("Alpha alpha", createSearchPlan("alpha", { caseSensitive: true })).length, 1);
});

test("exact match uses word boundaries for word-like keywords", () => {
  const plan = createSearchPlan("cat", { exactMatch: true });
  const matches = findMatchesInText("cat scatter cat.", plan);

  assert.deepEqual(matches.map((match) => match.text), ["cat", "cat"]);
});

test("exact match preserves phrase matching", () => {
  const plan = createSearchPlan("quick fox", { exactMatch: true });
  const matches = findMatchesInText("quick fox, quick brown fox", plan);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].text, "quick fox");
});

test("regex mode reports invalid patterns without throwing", () => {
  const plan = createSearchPlan("[", { regex: true });

  assert.equal(plan.valid, false);
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0].message, /Invalid regular expression/);
  assert.deepEqual(findMatchesInText("anything", plan), []);
});

test("regex mode supports per-keyword colors", () => {
  const plan = createSearchPlan("\\d+", { regex: true, colors: ["#123456"] });
  const matches = findMatchesInText("a12 b345", plan);

  assert.equal(matches.length, 2);
  assert.equal(matches[0].color, "#123456");
  assert.equal(matches[1].text, "345");
});

test("overlapping matches prefer the longest match at the same start", () => {
  const plan = createSearchPlan(["alpha", "alphabet"]);
  const selected = selectNonOverlappingMatches(findMatchesInText("alphabet alpha", plan));

  assert.deepEqual(selected.map((match) => match.text), ["alphabet", "alpha"]);
});

