chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.storage.sync.set({
      findppSettings: {
        mode: "or",
        exact: false,
        caseSensitive: false,
        regex: false
      }
    });
  }
});
