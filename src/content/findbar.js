(() => {
  if (window.__findppFindBarLoaded__) {
    return;
  }
  window.__findppFindBarLoaded__ = true;

  const STORAGE_KEY = "findppSettings";
  const HIGHLIGHT_STYLE_ID = "findpp-highlight-style";
  const FINDPP_MARK_CLASS = "findpp-highlight";
  const FINDPP_ACTIVE_CLASS = "findpp-active";
  const FINDPP_NODE_ATTR = "data-findpp-node";
  const DEBOUNCE_MS = 130;
  const MAX_MATCHES = 1500;

  const DEFAULT_SETTINGS = {
    termsText: "",
    mode: "or",
    exact: false,
    caseSensitive: false,
    regex: false,
  };

  const COLORS = [
    "#ffe066", "#74c0fc", "#b2f2bb", "#ffc9c9",
    "#d0bfff", "#ffd8a8", "#99e9f2", "#fcc2d7",
  ];

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    visible: false,
    marks: [],
    activeIndex: -1,
    plan: null,
    errors: [],
    core: null,
    searchSeq: 0,
    capped: false,
  };

  const els = {};
  let host = null;
  let shadow = null;
  let debounceTimer = null;
  let saveTimer = null;

  installMessageListener();

  // ---------- Messaging ----------

  function installMessageListener() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== "string") {
        return false;
      }

      switch (message.type) {
        case "FINDPP_TOGGLE":
          toggle().then(() => sendResponse({ ok: true, visible: state.visible }));
          return true;
        case "FINDPP_SHOW":
          show().then(() => sendResponse({ ok: true }));
          return true;
        case "FINDPP_HIDE":
          hide();
          sendResponse({ ok: true });
          return false;
        default:
          return false;
      }
    });
  }

  async function toggle() {
    if (state.visible) {
      hide();
    } else {
      await show();
    }
  }

  async function show() {
    if (!host) {
      await loadSettings();
      buildUI();
    }
    state.visible = true;
    els.bar.hidden = false;
    requestAnimationFrame(() => {
      els.search.focus();
      els.search.select();
    });
    if (state.settings.termsText.trim()) {
      runSearch({ immediate: true, preserveActive: true });
    } else {
      updateCount();
    }
  }

  function hide() {
    state.visible = false;
    clearHighlights();
    if (els.bar) {
      els.bar.hidden = true;
    }
  }

  // ---------- Storage ----------

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(STORAGE_KEY);
      state.settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] || {}) };
    } catch {
      state.settings = { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettingsSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        chrome.storage.sync.set({ [STORAGE_KEY]: state.settings });
      } catch {
        /* ignore */
      }
    }, 220);
  }

  // ---------- Search core ----------

  async function loadCore() {
    if (state.core) return state.core;
    const url = chrome.runtime.getURL("src/shared/search-core.js");
    state.core = await import(url);
    return state.core;
  }

  // ---------- UI construction ----------

  function buildUI() {
    injectHighlightStyles();

    host = document.createElement("div");
    host.setAttribute("data-findpp-root", "true");
    host.setAttribute(FINDPP_NODE_ATTR, "true");
    host.style.cssText = [
      "all: initial",
      "position: fixed",
      "top: 0",
      "left: 0",
      "width: 0",
      "height: 0",
      "z-index: 2147483647",
      "pointer-events: none",
      "color-scheme: light dark",
    ].join(";");

    shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>${BAR_STYLES}</style>${BAR_TEMPLATE}`;

    document.documentElement.appendChild(host);

    els.bar = shadow.querySelector(".bar");
    els.search = shadow.querySelector(".search");
    els.count = shadow.querySelector(".count");
    els.chips = shadow.querySelector(".chips");
    els.error = shadow.querySelector(".error");
    els.segments = [...shadow.querySelectorAll(".seg")];
    els.flags = [...shadow.querySelectorAll(".flag")];
    els.prev = shadow.querySelector('[data-action="prev"]');
    els.next = shadow.querySelector('[data-action="next"]');
    els.closeBtn = shadow.querySelector('[data-action="close"]');

    hydrateFromSettings();
    attachUIEvents();
  }

  function hydrateFromSettings() {
    els.search.value = state.settings.termsText;
    els.segments.forEach((btn) => {
      const isActive = btn.dataset.mode === state.settings.mode;
      btn.setAttribute("aria-pressed", String(isActive));
      btn.classList.toggle("is-active", isActive);
    });
    els.flags.forEach((btn) => {
      const flag = btn.dataset.flag;
      const isActive = Boolean(state.settings[flag]);
      btn.setAttribute("aria-pressed", String(isActive));
      btn.classList.toggle("is-active", isActive);
    });
    renderChips();
  }

  function attachUIEvents() {
    els.search.addEventListener("input", () => {
      state.settings.termsText = els.search.value;
      renderChips();
      saveSettingsSoon();
      scheduleSearch();
    });

    els.search.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          stepMatch(-1);
        } else {
          stepMatch(1);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        hide();
      } else if (event.key === "ArrowDown" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        stepMatch(1);
      } else if (event.key === "ArrowUp" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        stepMatch(-1);
      }
    });

    els.segments.forEach((btn) => {
      btn.addEventListener("click", () => {
        state.settings.mode = btn.dataset.mode;
        hydrateFromSettings();
        saveSettingsSoon();
        runSearch({ immediate: true });
      });
    });

    els.flags.forEach((btn) => {
      btn.addEventListener("click", () => {
        const flag = btn.dataset.flag;
        state.settings[flag] = !state.settings[flag];
        hydrateFromSettings();
        saveSettingsSoon();
        runSearch({ immediate: true });
      });
    });

    els.prev.addEventListener("click", () => stepMatch(-1));
    els.next.addEventListener("click", () => stepMatch(1));
    els.closeBtn.addEventListener("click", () => hide());

    els.bar.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        hide();
      }
    });

    els.bar.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });
  }

  function renderChips() {
    if (!state.core) {
      els.chips.replaceChildren();
      return;
    }
    const terms = state.core.parseKeywords(state.settings.termsText).slice(0, 24);
    els.chips.replaceChildren();
    terms.forEach((term, index) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      const dot = document.createElement("span");
      dot.className = "chip-dot";
      dot.style.backgroundColor = COLORS[index % COLORS.length];
      const label = document.createElement("span");
      label.className = "chip-label";
      label.textContent = term;
      chip.append(dot, label);
      els.chips.append(chip);
    });
  }

  // ---------- Search execution ----------

  function scheduleSearch() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(), DEBOUNCE_MS);
  }

  async function runSearch(options = {}) {
    const seq = ++state.searchSeq;
    const core = await loadCore();
    if (seq !== state.searchSeq) return;

    renderChips();

    const previousKeyword = options.preserveActive
      ? state.marks[state.activeIndex]?.dataset.findppKeyword
      : null;

    clearHighlights();

    const text = state.settings.termsText.trim();
    if (!text) {
      state.plan = null;
      state.errors = [];
      state.capped = false;
      updateCount();
      hideError();
      return;
    }

    const plan = core.createSearchPlan(state.settings.termsText, {
      operator: state.settings.mode,
      exactMatch: state.settings.exact,
      caseSensitive: state.settings.caseSensitive,
      regex: state.settings.regex,
      colors: COLORS,
    });
    state.plan = plan;
    state.errors = plan.errors;

    if (!plan.valid) {
      updateCount();
      showError(formatErrors(plan.errors));
      return;
    }

    if (plan.terms.length === 0) {
      updateCount();
      hideError();
      return;
    }

    const pageText = collectPageText();
    const evaluation = core.evaluateSearch(pageText, plan);
    if (!evaluation.isMatch) {
      updateCount();
      hideError();
      return;
    }

    highlightMatches(core, plan);

    let restoredIndex = 0;
    if (previousKeyword) {
      const candidate = state.marks.findIndex((m) => m.dataset.findppKeyword === previousKeyword);
      if (candidate >= 0) restoredIndex = candidate;
    }

    setActiveIndex(state.marks.length > 0 ? restoredIndex : -1, { scroll: !options.preserveActive });
    updateCount();
    hideError();
  }

  function stepMatch(direction) {
    if (state.marks.length === 0) {
      if (state.settings.termsText.trim()) {
        runSearch({ immediate: true });
      }
      return;
    }
    const next = (state.activeIndex + direction + state.marks.length) % state.marks.length;
    setActiveIndex(next);
    updateCount();
  }

  function setActiveIndex(index, options = {}) {
    const { scroll = true } = options;
    const prev = state.marks[state.activeIndex];
    if (prev) prev.classList.remove(FINDPP_ACTIVE_CLASS);
    state.activeIndex = index;
    const active = state.marks[state.activeIndex];
    if (!active) return;
    active.classList.add(FINDPP_ACTIVE_CLASS);
    if (scroll) {
      active.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
  }

  function updateCount() {
    const total = state.marks.length;
    const hasInput = state.settings.termsText.trim().length > 0;

    let label = "";
    let kind = "idle";
    if (!hasInput) {
      label = "";
      kind = "idle";
    } else if (state.errors.length > 0) {
      label = state.errors.length === 1 ? "1 error" : `${state.errors.length} errors`;
      kind = "error";
    } else if (total === 0) {
      label = "No results";
      kind = "zero";
    } else {
      const current = state.activeIndex >= 0 ? state.activeIndex + 1 : 0;
      label = `${current} / ${total}${state.capped ? "+" : ""}`;
      kind = "ok";
    }
    els.count.textContent = label;
    els.count.dataset.kind = kind;

    const canNavigate = total > 0;
    els.prev.toggleAttribute("disabled", !canNavigate);
    els.next.toggleAttribute("disabled", !canNavigate);
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.hidden = false;
  }

  function hideError() {
    els.error.hidden = true;
    els.error.textContent = "";
  }

  function formatErrors(errors) {
    if (!errors.length) return "";
    const first = errors[0];
    const tail = errors.length > 1 ? ` (+${errors.length - 1} more)` : "";
    return `Regex error in "${first.keyword}": ${first.message}${tail}`;
  }

  // ---------- Highlighting ----------

  function injectHighlightStyles() {
    if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.setAttribute(FINDPP_NODE_ATTR, "true");
    style.textContent = MARK_STYLES;
    document.documentElement.appendChild(style);
  }

  function collectPageText() {
    const chunks = [];
    const walker = createTextWalker();
    let node = walker.nextNode();
    while (node) {
      chunks.push(node.nodeValue || "");
      node = walker.nextNode();
    }
    return chunks.join("\n");
  }

  function highlightMatches(core, plan) {
    state.capped = false;
    const walker = createTextWalker();
    const textNodes = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node);
      node = walker.nextNode();
    }

    let produced = 0;
    for (const textNode of textNodes) {
      if (produced >= MAX_MATCHES) {
        state.capped = true;
        break;
      }
      const value = textNode.nodeValue || "";
      const matches = core.selectNonOverlappingMatches(core.findMatchesInText(value, plan));
      if (matches.length === 0) continue;
      const sliced = produced + matches.length > MAX_MATCHES
        ? matches.slice(0, MAX_MATCHES - produced)
        : matches;
      wrapMatches(textNode, sliced);
      produced += sliced.length;
      if (produced >= MAX_MATCHES) {
        state.capped = true;
        break;
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

  function clearHighlights() {
    for (const mark of state.marks) {
      if (!mark.isConnected || !mark.parentNode) continue;
      const text = document.createTextNode(mark.textContent || "");
      const parent = mark.parentNode;
      parent.replaceChild(text, mark);
      parent.normalize();
    }
    state.marks = [];
    state.activeIndex = -1;
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
    if (!element) return true;
    if (element.closest(`[${FINDPP_NODE_ATTR}], .${FINDPP_MARK_CLASS}`)) return true;
    if (element.closest("script, style, noscript, template, input, textarea, select, option")) return true;
    if (element.isContentEditable) return true;
    if (element.closest("[contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']")) return true;
    const cs = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    if (cs && (cs.visibility === "hidden" || cs.display === "none")) return true;
    return false;
  }

  // ---------- Templates ----------

  const BAR_TEMPLATE = `
    <section class="bar" role="dialog" aria-label="Find on page" hidden>
      <div class="row main">
        <svg class="leading" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 4a6 6 0 1 0 3.873 10.582l4.272 4.272a1 1 0 0 0 1.414-1.414l-4.272-4.272A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" fill="currentColor"/>
        </svg>
        <input class="search" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Search terms" placeholder="Find on page — comma separates keywords">
        <span class="count" data-kind="idle" aria-live="polite"></span>
        <span class="sep" aria-hidden="true"></span>
        <button class="iconbtn" data-action="prev" title="Previous match (Shift+Enter)" aria-label="Previous match" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.343 15.071 12 9.414l5.657 5.657a1 1 0 1 0 1.414-1.414l-6.364-6.364a1 1 0 0 0-1.414 0L4.929 13.657a1 1 0 1 0 1.414 1.414Z" fill="currentColor"/></svg>
        </button>
        <button class="iconbtn" data-action="next" title="Next match (Enter)" aria-label="Next match" disabled>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.657 8.929 12 14.586 6.343 8.929a1 1 0 1 0-1.414 1.414l6.364 6.364a1 1 0 0 0 1.414 0l6.364-6.364a1 1 0 1 0-1.414-1.414Z" fill="currentColor"/></svg>
        </button>
        <span class="sep" aria-hidden="true"></span>
        <button class="iconbtn close" data-action="close" title="Close (Esc)" aria-label="Close find bar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.343 4.929 12 10.586l5.657-5.657a1 1 0 1 1 1.414 1.414L13.414 12l5.657 5.657a1 1 0 1 1-1.414 1.414L12 13.414l-5.657 5.657a1 1 0 0 1-1.414-1.414L10.586 12 4.929 6.343a1 1 0 0 1 1.414-1.414Z" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="row options">
        <div class="segmented" role="group" aria-label="Match mode">
          <button class="seg" type="button" data-mode="or" aria-pressed="true">OR</button>
          <button class="seg" type="button" data-mode="and" aria-pressed="false">AND</button>
        </div>
        <button class="flag" type="button" data-flag="exact" aria-pressed="false" title="Whole word">
          <span class="flag-glyph"><u>ab</u></span>
        </button>
        <button class="flag" type="button" data-flag="caseSensitive" aria-pressed="false" title="Match case">
          <span class="flag-glyph">Aa</span>
        </button>
        <button class="flag" type="button" data-flag="regex" aria-pressed="false" title="Regular expression">
          <span class="flag-glyph">.*</span>
        </button>
        <div class="chips" aria-label="Active keywords"></div>
      </div>
      <div class="row error" role="alert" hidden></div>
    </section>
  `;

  const BAR_STYLES = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }

    .bar {
      position: fixed;
      top: 14px;
      right: 14px;
      width: 440px;
      max-width: calc(100vw - 28px);
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(18px) saturate(180%);
      -webkit-backdrop-filter: blur(18px) saturate(180%);
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 14px;
      box-shadow:
        0 24px 48px -16px rgba(15, 23, 42, 0.28),
        0 4px 12px rgba(15, 23, 42, 0.08);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", sans-serif;
      font-size: 13px;
      line-height: 1.4;
      color: #0f172a;
      pointer-events: auto;
      transform-origin: top right;
      animation: findpp-pop 160ms cubic-bezier(0.22, 0.9, 0.28, 1.15);
      overflow: hidden;
    }

    .bar[hidden] { display: none; }

    @keyframes findpp-pop {
      from { opacity: 0; transform: translateY(-6px) scale(0.985); }
      to   { opacity: 1; transform: none; }
    }

    .row {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 8px;
    }

    .row.main {
      gap: 2px;
      padding: 6px 6px 6px 10px;
    }

    .row.options {
      gap: 6px;
      padding: 6px 10px 8px;
      border-top: 1px solid rgba(15, 23, 42, 0.06);
      flex-wrap: wrap;
    }

    .leading {
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
      color: rgba(15, 23, 42, 0.45);
      margin-right: 6px;
    }

    .search {
      flex: 1 1 auto;
      min-width: 0;
      height: 28px;
      border: 0;
      padding: 0 2px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 14px;
      outline: none;
    }

    .search::placeholder {
      color: rgba(15, 23, 42, 0.38);
    }

    .search::selection {
      background: rgba(23, 105, 255, 0.28);
    }

    .count {
      flex: 0 0 auto;
      font-size: 12px;
      color: rgba(15, 23, 42, 0.6);
      padding: 0 6px;
      font-variant-numeric: tabular-nums;
      min-width: 50px;
      text-align: right;
      white-space: nowrap;
    }

    .count[data-kind="zero"], .count[data-kind="error"] { color: #b42318; }
    .count[data-kind="idle"] { color: rgba(15, 23, 42, 0.4); }

    .sep {
      width: 1px;
      height: 18px;
      background: rgba(15, 23, 42, 0.08);
      flex: 0 0 1px;
      margin: 0 2px;
    }

    .iconbtn {
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: background 120ms ease;
    }

    .iconbtn svg { width: 16px; height: 16px; }
    .iconbtn:hover { background: rgba(15, 23, 42, 0.06); }
    .iconbtn:active { background: rgba(15, 23, 42, 0.1); }
    .iconbtn[disabled] { opacity: 0.32; cursor: default; }
    .iconbtn[disabled]:hover { background: transparent; }
    .iconbtn:focus-visible {
      outline: 2px solid #1769ff;
      outline-offset: 1px;
    }

    .segmented {
      display: inline-flex;
      background: rgba(15, 23, 42, 0.06);
      border-radius: 7px;
      padding: 2px;
      flex: 0 0 auto;
    }

    .seg {
      border: 0;
      background: transparent;
      padding: 3px 10px;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: rgba(15, 23, 42, 0.6);
      border-radius: 5px;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;
    }

    .seg[aria-pressed="true"] {
      background: #ffffff;
      color: #1769ff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
    }

    .flag {
      border: 0;
      background: rgba(15, 23, 42, 0.05);
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      color: rgba(15, 23, 42, 0.6);
      height: 24px;
      min-width: 30px;
      padding: 0 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .flag:hover { background: rgba(15, 23, 42, 0.09); }
    .flag[aria-pressed="true"] {
      background: rgba(23, 105, 255, 0.14);
      color: #1769ff;
    }
    .flag:focus-visible, .seg:focus-visible {
      outline: 2px solid #1769ff;
      outline-offset: 1px;
    }

    .flag-glyph u { text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 2px; }

    .chips {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      margin-left: auto;
      max-width: 60%;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 1px 7px 1px 5px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.05);
      font-size: 11px;
      max-width: 100%;
      color: rgba(15, 23, 42, 0.78);
    }

    .chip-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex: 0 0 8px;
      border: 1px solid rgba(15, 23, 42, 0.18);
    }

    .chip-label {
      max-width: 90px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row.error {
      padding: 8px 12px;
      background: rgba(217, 45, 32, 0.08);
      color: #b42318;
      font-size: 12px;
      border-top: 1px solid rgba(217, 45, 32, 0.2);
    }

    @media (prefers-color-scheme: dark) {
      .bar {
        background: rgba(24, 27, 33, 0.94);
        border-color: rgba(255, 255, 255, 0.08);
        color: #e7eaf0;
        box-shadow:
          0 24px 48px -16px rgba(0, 0, 0, 0.6),
          0 4px 12px rgba(0, 0, 0, 0.35);
      }
      .row.options { border-top-color: rgba(255, 255, 255, 0.08); }
      .leading { color: rgba(231, 234, 240, 0.5); }
      .search::placeholder { color: rgba(231, 234, 240, 0.38); }
      .search::selection { background: rgba(110, 166, 255, 0.32); }
      .count { color: rgba(231, 234, 240, 0.6); }
      .count[data-kind="idle"] { color: rgba(231, 234, 240, 0.36); }
      .count[data-kind="zero"], .count[data-kind="error"] { color: #ff8a80; }
      .sep { background: rgba(255, 255, 255, 0.08); }
      .iconbtn:hover { background: rgba(255, 255, 255, 0.08); }
      .iconbtn:active { background: rgba(255, 255, 255, 0.12); }
      .iconbtn:focus-visible, .flag:focus-visible, .seg:focus-visible { outline-color: #6ea6ff; }
      .segmented { background: rgba(255, 255, 255, 0.06); }
      .seg { color: rgba(231, 234, 240, 0.6); }
      .seg[aria-pressed="true"] {
        background: rgba(255, 255, 255, 0.14);
        color: #80b6ff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }
      .flag { background: rgba(255, 255, 255, 0.06); color: rgba(231, 234, 240, 0.6); }
      .flag:hover { background: rgba(255, 255, 255, 0.1); }
      .flag[aria-pressed="true"] { background: rgba(110, 166, 255, 0.22); color: #80b6ff; }
      .chip { background: rgba(255, 255, 255, 0.08); color: rgba(231, 234, 240, 0.85); }
      .chip-dot { border-color: rgba(255, 255, 255, 0.2); }
      .row.error { background: rgba(255, 138, 128, 0.14); color: #ffb0a9; border-top-color: rgba(255, 138, 128, 0.28); }
    }

    @media (prefers-reduced-motion: reduce) {
      .bar { animation: none; }
      .iconbtn, .flag, .seg { transition: none; }
    }
  `;

  const MARK_STYLES = `
    mark.${FINDPP_MARK_CLASS} {
      all: unset;
      background-color: var(--findpp-color, #ffe066);
      color: inherit;
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
      border-radius: 2px;
      padding: 0 1px;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      scroll-margin: 96px 24px;
    }

    mark.${FINDPP_MARK_CLASS}.${FINDPP_ACTIVE_CLASS} {
      box-shadow:
        0 0 0 2px rgba(15, 23, 42, 0.92),
        0 0 0 4px rgba(255, 255, 255, 0.95),
        0 2px 8px rgba(15, 23, 42, 0.25);
      filter: saturate(1.2);
      z-index: 1;
      position: relative;
    }

    @media (prefers-color-scheme: dark) {
      mark.${FINDPP_MARK_CLASS} {
        color: #0f172a;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2);
      }
      mark.${FINDPP_MARK_CLASS}.${FINDPP_ACTIVE_CLASS} {
        box-shadow:
          0 0 0 2px rgba(255, 255, 255, 0.95),
          0 0 0 4px rgba(15, 23, 42, 0.92),
          0 2px 8px rgba(0, 0, 0, 0.5);
      }
    }
  `;
})();
