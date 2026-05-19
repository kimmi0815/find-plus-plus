import { parseKeywords } from "../shared/search-core.js";

const DEFAULT_SETTINGS = {
  termsText: "",
  mode: "or",
  exact: false,
  caseSensitive: false,
  regex: false
};

const COLORS = [
  "#ffe066",
  "#74c0fc",
  "#b2f2bb",
  "#ffc9c9",
  "#d0bfff",
  "#ffd8a8",
  "#99e9f2",
  "#fcc2d7"
];

const els = {
  terms: document.querySelector("#terms"),
  segments: [...document.querySelectorAll(".segment")],
  exact: document.querySelector("#exact"),
  caseSensitive: document.querySelector("#caseSensitive"),
  regex: document.querySelector("#regex"),
  chips: document.querySelector("#chips"),
  keywordCount: document.querySelector("#keywordCount"),
  matchCount: document.querySelector("#matchCount"),
  matchLabel: document.querySelector("#matchLabel"),
  message: document.querySelector("#message"),
  apply: document.querySelector("#apply"),
  prev: document.querySelector("#prev"),
  next: document.querySelector("#next"),
  clear: document.querySelector("#clear")
};

let state = { ...DEFAULT_SETTINGS };
let saveTimer;

init();

async function init() {
  const stored = await chrome.storage.sync.get("findppSettings");
  state = { ...DEFAULT_SETTINGS, ...(stored.findppSettings || {}) };
  render();
  attachEvents();
  els.terms.focus();
}

function attachEvents() {
  els.terms.addEventListener("input", () => {
    state.termsText = els.terms.value;
    renderChips();
    persistSoon();
  });

  els.segments.forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      renderMode();
      persistSoon();
    });
  });

  [els.exact, els.caseSensitive, els.regex].forEach((input) => {
    input.addEventListener("change", () => {
      state[input.id] = input.checked;
      persistSoon();
    });
  });

  els.apply.addEventListener("click", () => runSearch("apply"));
  els.prev.addEventListener("click", () => runSearch("prev"));
  els.next.addEventListener("click", () => runSearch("next"));
  els.clear.addEventListener("click", clearHighlights);

  els.terms.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      runSearch("apply");
    }
  });
}

function render() {
  els.terms.value = state.termsText;
  els.exact.checked = state.exact;
  els.caseSensitive.checked = state.caseSensitive;
  els.regex.checked = state.regex;
  renderMode();
  renderChips();
}

function renderMode() {
  els.segments.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === state.mode);
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
  });
}

function renderChips() {
  const terms = getTerms();
  els.keywordCount.textContent = `${terms.length} ${terms.length === 1 ? "term" : "terms"}`;
  els.chips.replaceChildren();

  if (!terms.length) {
    const empty = document.createElement("span");
    empty.className = "empty";
    empty.textContent = "No keywords";
    els.chips.append(empty);
    setNavEnabled(false);
    return;
  }

  terms.forEach((term, index) => {
    const chip = document.createElement("span");
    chip.className = "chip";

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.backgroundColor = COLORS[index % COLORS.length];

    const label = document.createElement("span");
    label.textContent = term;

    chip.append(swatch, label);
    els.chips.append(chip);
  });

  setNavEnabled(false);
}

function getTerms() {
  return parseKeywords(state.termsText).slice(0, 24);
}

function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.sync.set({ findppSettings: state });
  }, 160);
}

async function runSearch(direction) {
  const terms = getTerms();
  if (!terms.length && direction === "apply") {
    setResult(0, "Add at least one keyword.");
    return;
  }

  els.apply.disabled = true;
  els.message.textContent = direction === "apply" ? "Highlighting current page..." : "Moving through matches...";

  try {
    const response = await sendHighlighterMessage(messageForDirection(direction, terms));
    setResult(response?.count || 0, messageForSnapshot(response, direction));
  } catch (error) {
    setResult(0, chrome.runtime.lastError?.message || error.message || "Could not access this page.");
  } finally {
    els.apply.disabled = false;
  }
}

async function clearHighlights() {
  state.termsText = "";
  els.terms.value = "";
  renderChips();
  persistSoon();

  try {
    await sendHighlighterMessage({ type: "FINDPP_CLEAR" });
    setResult(0, "Highlights cleared.");
  } catch (error) {
    setResult(0, chrome.runtime.lastError?.message || error.message || "Could not clear this page.");
  }
}

async function sendHighlighterMessage(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content/highlighter.js"]
    });
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

function messageForDirection(direction, terms) {
  if (direction === "next") return { type: "FINDPP_NEXT" };
  if (direction === "prev") return { type: "FINDPP_PREVIOUS" };

  return {
    type: "FINDPP_SEARCH",
    payload: {
      query: terms.join("\n"),
      operator: state.mode,
      exactMatch: state.exact,
      caseSensitive: state.caseSensitive,
      regex: state.regex,
      colors: COLORS
    }
  };
}

function messageForSnapshot(snapshot, direction) {
  if (!snapshot) return "No response from this page.";

  if (snapshot.errors?.length) {
    const noun = snapshot.errors.length === 1 ? "regex error" : "regex errors";
    return `${snapshot.errors.length} ${noun}. Check highlighted settings.`;
  }

  if (snapshot.current && snapshot.total && direction !== "apply") {
    return `${snapshot.current} of ${snapshot.total}`;
  }

  if (snapshot.count > 0) {
    return `Highlighted ${snapshot.count} ${snapshot.count === 1 ? "match" : "matches"}.`;
  }

  if (state.mode === "and") {
    return "AND mode: not all keywords were found.";
  }

  return "No matches found.";
}

function setResult(count, message) {
  els.matchCount.textContent = String(count);
  els.matchLabel.textContent = count === 1 ? "match" : "matches";
  els.message.textContent = message;
  setNavEnabled(count > 0);
}

function setNavEnabled(enabled) {
  els.prev.disabled = !enabled;
  els.next.disabled = !enabled;
}
