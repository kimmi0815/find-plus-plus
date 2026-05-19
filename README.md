# Find++

Find++ is a Chrome extension that brings native-style in-page find — but with multi-keyword search, color-coded highlights, and AND/OR/regex modes — directly to any page. No popup window: the find bar lives in the top-right corner of the page itself, exactly where you expect it.

## Features

- **In-page find bar** — Shadow-DOM overlay that floats over the page (top-right), not a separate popup window.
- **Multi-keyword search** — separate keywords with commas; each gets its own highlight color.
- **Real-time results** — search updates as you type (130 ms debounce).
- **AND / OR matching** — require all keywords on the page or any.
- **Whole-word, case-sensitive, and regex toggles**.
- **Native-style navigation** — `Enter` → next, `Shift+Enter` → previous, `Esc` → close.
- **Active-match ring** — a strong outline around the current match plus the keyword's color, so it stays distinguishable from peers.
- **Auto dark/light theme** based on `prefers-color-scheme`.
- **Settings persist** via `chrome.storage.sync` (text, mode, flags).
- **Suggested shortcut**: `Command+Shift+F` (macOS) / `Ctrl+Shift+F` (Win/Linux). Pressing it again toggles the bar off.

## Keyboard

| Key | Action |
| --- | --- |
| Type | Live search |
| `Enter` | Next match |
| `Shift`+`Enter` | Previous match |
| `Cmd/Ctrl`+`↓` | Next match |
| `Cmd/Ctrl`+`↑` | Previous match |
| `Esc` | Close bar |
| `Cmd/Ctrl`+`Shift`+`F` | Toggle bar |

## Local Use

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this folder.

Press `Cmd/Ctrl+Shift+F` on any regular web page, or click the toolbar icon. The find bar appears in the top-right corner of the page. On restricted pages (`chrome://`, the Chrome Web Store, etc.) Chrome blocks extension injection — the toolbar icon will briefly flash a red `x` badge.

## Architecture

- `src/background/service-worker.js` — Receives the action click and `toggle-find-bar` command, then sends a `FINDPP_TOGGLE` message to the active tab. Injects the content script on demand if the tab hasn't received it yet.
- `src/content/findbar.js` — The find bar UI (closed Shadow DOM) **and** the page-text walker + highlighter. Single self-contained content script.
- `src/shared/search-core.js` — Pure functions: keyword parsing, regex plan construction, and non-overlapping match selection. Covered by `tests/search-core.test.mjs`.

## Scripts

```bash
npm test       # run unit tests for search-core
npm run check  # syntax-check all JS entry points
npm run package # build release/find-plus-plus.zip
```
