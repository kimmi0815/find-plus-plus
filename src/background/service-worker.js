const TOGGLE_COMMAND = "toggle-find-bar";
const FINDBAR_FILE = "src/content/findbar.js";

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.storage.sync.set({
      findppSettings: {
        mode: "or",
        exact: false,
        caseSensitive: false,
        regex: false,
        termsText: ""
      }
    });
  }
});

chrome.action.onClicked.addListener((tab) => {
  toggleFindBar(tab).catch(reportFailure);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== TOGGLE_COMMAND) return;
  toggleFindBar(tab).catch(reportFailure);
});

async function toggleFindBar(maybeTab) {
  const tab = maybeTab ?? (await getActiveTab());
  if (!tab?.id) return;

  if (!canInject(tab.url)) {
    await flashIcon(tab.id, "x");
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "FINDPP_TOGGLE" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [FINDBAR_FILE]
    });
    await chrome.tabs.sendMessage(tab.id, { type: "FINDPP_TOGGLE" });
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function canInject(url) {
  if (!url) return false;
  return /^(https?:|file:|ftp:)/i.test(url);
}

async function flashIcon(tabId, badge) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d92d20" });
    await chrome.action.setBadgeText({ tabId, text: badge });
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: "" }), 1500);
  } catch {
    /* ignore */
  }
}

function reportFailure(error) {
  console.warn("[Find++] toggle failed:", error);
}
