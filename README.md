# Find++

Find++ is a compact Chrome extension shell for multi-keyword in-page find.

## Features

- Multiple keywords, separated by commas or new lines
- OR and AND matching modes
- Exact, case-sensitive, and regex toggles
- Per-keyword color chips
- Match count with previous and next navigation
- Clear highlights
- Persisted popup settings with `chrome.storage.sync`
- Suggested shortcut: `Command+Shift+F` on macOS or `Ctrl+Shift+F` elsewhere

## Local Use

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select this folder.

The popup injects temporary highlights into the active tab with `chrome.scripting.executeScript`, so no bundled content script is required.
