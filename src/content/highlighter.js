const FINDPP_MARK_CLASS = "findpp-highlight";
const FINDPP_ACTIVE_CLASS = "findpp-active";
const FINDPP_NODE_ATTR = "data-findpp-node";
const FINDPP_STYLES_ID = "findpp-highlight-styles";

const state = {
  core: null,
  plan: null,
  marks: [],
  activeIndex: -1,
  lastErrors: [],
};

async function loadCore() {
  if (state.core) {
    return state.core;
  }

  const url = chrome.runtime.getURL("src/shared/search-core.js");
  state.core = await import(url);
  return state.core;
}

function injectStyles() {
  if (document.getElementById(FINDPP_STYLES_ID)) {
    return;
  }

  const link = document.createElement("link");
  link.id = FINDPP_STYLES_ID;
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("src/content/highlighter.css");
  link.setAttribute(FINDPP_NODE_ATTR, "true");
  document.documentElement.appendChild(link);
}

async function search(payload = {}) {
  const core = await loadCore();
  injectStyles();
  clearHighlights();

  const query = payload.query ?? payload.keywords ?? "";
  const plan = core.createSearchPlan(query, payload);
  state.plan = plan;
  state.lastErrors = plan.errors;

  if (!plan.valid || plan.terms.length === 0) {
    return snapshot(false);
  }

  const pageText = getSearchableText();
  const pageResult = core.evaluateSearch(pageText, plan);
  if (!pageResult.isMatch) {
    return snapshot(false);
  }

  highlightTextNodes(core, plan);
  setActiveIndex(state.marks.length > 0 ? 0 : -1, { scroll: false });
  return snapshot(true);
}

function nextMatch() {
  if (state.marks.length === 0) {
    return snapshot(false);
  }

  setActiveIndex((state.activeIndex + 1) % state.marks.length);
  return snapshot(true);
}

function previousMatch() {
  if (state.marks.length === 0) {
    return snapshot(false);
  }

  setActiveIndex((state.activeIndex - 1 + state.marks.length) % state.marks.length);
  return snapshot(true);
}

function clearHighlights() {
  for (const mark of state.marks) {
    if (!mark.isConnected || !mark.parentNode) {
      continue;
    }

    const text = document.createTextNode(mark.textContent || "");
    const parent = mark.parentNode;
    parent.replaceChild(text, mark);
    parent.normalize();
  }

  state.marks = [];
  state.activeIndex = -1;
}

function highlightTextNodes(core, plan) {
  const walker = createTextWalker();
  const nodes = [];
  let node = walker.nextNode();

  while (node) {
    nodes.push(node);
    node = walker.nextNode();
  }

  for (const textNode of nodes) {
    const matches = core.selectNonOverlappingMatches(core.findMatchesInText(textNode.nodeValue, plan));
    if (matches.length > 0) {
      wrapMatches(textNode, matches);
    }
  }
}

function wrapMatches(textNode, matches) {
  const value = textNode.nodeValue || "";
  const fragment = document.createDocumentFragment();
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) {
      fragment.appendChild(document.createTextNode(value.slice(cursor, match.start)));
    }

    const mark = document.createElement("mark");
    mark.className = FINDPP_MARK_CLASS;
    mark.style.setProperty("--findpp-color", match.color);
    mark.dataset.findppNode = "true";
    mark.dataset.findppTermIndex = String(match.termIndex);
    mark.dataset.findppKeyword = match.keyword;
    mark.textContent = value.slice(match.start, match.end);
    fragment.appendChild(mark);
    state.marks.push(mark);

    cursor = match.end;
  }

  if (cursor < value.length) {
    fragment.appendChild(document.createTextNode(value.slice(cursor)));
  }

  textNode.parentNode.replaceChild(fragment, textNode);
}

function setActiveIndex(index, options = {}) {
  const { scroll = true } = options;
  const previous = state.marks[state.activeIndex];
  if (previous) {
    previous.classList.remove(FINDPP_ACTIVE_CLASS);
  }

  state.activeIndex = index;
  const active = state.marks[state.activeIndex];
  if (!active) {
    return;
  }

  active.classList.add(FINDPP_ACTIVE_CLASS);
  if (scroll) {
    active.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }
}

function snapshot(isPageMatch) {
  const active = state.marks[state.activeIndex] || null;
  return {
    ok: state.lastErrors.length === 0,
    isPageMatch,
    count: state.marks.length,
    activeIndex: state.activeIndex,
    current: state.activeIndex >= 0 ? state.activeIndex + 1 : 0,
    total: state.marks.length,
    errors: state.lastErrors,
    keywords: state.plan?.keywords ?? [],
    activeKeyword: active?.dataset.findppKeyword ?? null,
  };
}

function getSearchableText() {
  const chunks = [];
  const walker = createTextWalker();
  let node = walker.nextNode();

  while (node) {
    chunks.push(node.nodeValue || "");
    node = walker.nextNode();
  }

  return chunks.join("\n");
}

function createTextWalker() {
  return document.createTreeWalker(
    document.body || document.documentElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        return shouldSkipTextNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    },
  );
}

function shouldSkipTextNode(node) {
  const element = node.parentElement;
  if (!element) {
    return true;
  }

  if (element.closest(`[${FINDPP_NODE_ATTR}], .${FINDPP_MARK_CLASS}`)) {
    return true;
  }

  if (element.closest("script, style, noscript, template, input, textarea, select, option")) {
    return true;
  }

  if (element.isContentEditable) {
    return true;
  }

  if (element.closest("[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']")) {
    return true;
  }

  return false;
}

async function handleMessage(message) {
  if (!message || !String(message.type || "").startsWith("FINDPP_")) {
    return null;
  }

  switch (message.type) {
    case "FINDPP_SEARCH":
      return search(message.payload || message);
    case "FINDPP_NEXT":
      return nextMatch();
    case "FINDPP_PREVIOUS":
      return previousMatch();
    case "FINDPP_CLEAR":
      clearHighlights();
      return snapshot(false);
    default:
      return null;
  }
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message)
      .then((response) => {
        if (response) {
          sendResponse(response);
        }
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          isPageMatch: false,
          count: 0,
          activeIndex: -1,
          current: 0,
          total: 0,
          errors: [{ message: error instanceof Error ? error.message : String(error) }],
          keywords: [],
          activeKeyword: null,
        });
      });

    return true;
  });
}

window.FindPlusPlusHighlighter = {
  search,
  next: nextMatch,
  previous: previousMatch,
  clear: clearHighlights,
  snapshot,
};
