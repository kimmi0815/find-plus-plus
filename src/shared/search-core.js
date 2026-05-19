const DEFAULT_COLORS = [
  "#ffd54f",
  "#80cbc4",
  "#ffab91",
  "#ce93d8",
  "#a5d6a7",
  "#90caf9",
  "#f48fb1",
  "#bcaaa4",
];

export function parseKeywords(input) {
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }

  return String(input ?? "")
    .split(/[,\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function escapeRegExp(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function normalizeOptions(options = {}) {
  const mode = String(options.mode ?? "").toLowerCase();
  const operator = String(options.operator ?? mode).toLowerCase() === "and" ? "and" : "or";

  return {
    operator,
    caseSensitive: Boolean(options.caseSensitive),
    exactMatch: Boolean(options.exactMatch || mode === "exact"),
    regex: Boolean(options.regex || mode === "regex"),
    colors: options.colors,
    colorsByKeyword: options.colorsByKeyword,
  };
}

export function colorForTerm(index, colors = DEFAULT_COLORS) {
  if (Array.isArray(colors) && colors.length > 0) {
    return colors[index % colors.length];
  }

  if (colors && typeof colors === "object") {
    return colors[index] || colors[String(index)] || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  }

  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

export function sourceForKeyword(keyword, options = {}) {
  if (options.regex) {
    return keyword;
  }

  const source = escapeRegExp(keyword);
  if (!options.exactMatch) {
    return source;
  }

  const startsLikeWord = /^\w/.test(keyword);
  const endsLikeWord = /\w$/.test(keyword);
  return `${startsLikeWord ? "\\b" : ""}${source}${endsLikeWord ? "\\b" : ""}`;
}

export function createSearchPlan(input, options = {}) {
  const normalized = normalizeOptions(options);
  const keywords = parseKeywords(input);
  const flags = `g${normalized.caseSensitive ? "" : "i"}`;
  const errors = [];
  const terms = [];

  keywords.forEach((keyword, index) => {
    const source = sourceForKeyword(keyword, normalized);
    let expression = null;

    try {
      expression = new RegExp(source, flags);
    } catch (error) {
      errors.push({
        index,
        keyword,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    terms.push({
      index,
      keyword,
      source,
      color: colorForTerm(index, normalized.colorsByKeyword?.[keyword] ? [normalized.colorsByKeyword[keyword]] : normalized.colors),
      expression,
    });
  });

  return {
    ...normalized,
    keywords,
    terms,
    errors,
    valid: errors.length === 0,
  };
}

export function findMatchesInText(text, planOrInput, options = {}) {
  const plan = isSearchPlan(planOrInput) ? planOrInput : createSearchPlan(planOrInput, options);
  if (!plan.valid || plan.terms.length === 0) {
    return [];
  }

  const value = String(text ?? "");
  const matches = [];

  for (const term of plan.terms) {
    if (!term.expression) {
      continue;
    }

    const expression = new RegExp(term.expression.source, term.expression.flags);
    let match = expression.exec(value);

    while (match) {
      const matchedText = match[0];
      if (matchedText.length > 0) {
        matches.push({
          start: match.index,
          end: match.index + matchedText.length,
          text: matchedText,
          termIndex: term.index,
          keyword: term.keyword,
          color: term.color,
        });
      }

      if (expression.lastIndex === match.index) {
        expression.lastIndex += 1;
      }

      match = expression.exec(value);
    }
  }

  return sortMatches(matches);
}

export function selectNonOverlappingMatches(matches) {
  const selected = [];
  let cursor = -1;

  for (const match of sortMatches(matches)) {
    if (match.start < cursor) {
      continue;
    }

    selected.push(match);
    cursor = match.end;
  }

  return selected.sort((a, b) => a.start - b.start || a.end - b.end || a.termIndex - b.termIndex);
}

export function evaluateSearch(text, planOrInput, options = {}) {
  const plan = isSearchPlan(planOrInput) ? planOrInput : createSearchPlan(planOrInput, options);
  const matches = findMatchesInText(text, plan);
  const termHits = plan.terms.map((term) => matches.some((match) => match.termIndex === term.index));
  const hasTerms = plan.terms.length > 0;
  const isMatch = plan.valid && hasTerms && (
    plan.operator === "and" ? termHits.every(Boolean) : termHits.some(Boolean)
  );

  return {
    plan,
    matches,
    termHits,
    isMatch,
  };
}

function sortMatches(matches) {
  return [...matches].sort((a, b) => (
    a.start - b.start
    || (b.end - b.start) - (a.end - a.start)
    || a.termIndex - b.termIndex
  ));
}

function isSearchPlan(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.terms) && Array.isArray(value.errors));
}
