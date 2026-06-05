const DEFAULT_SETTINGS = {
  enabled: true,
  hidePromoted: true,
  hideWhoToFollow: false,
  hideTrends: false,
  debugMode: false
};

const fieldIds = Object.keys(DEFAULT_SETTINGS);

function saveSettings() {
  const nextSettings = fieldIds.reduce((acc, fieldId) => {
    const input = document.getElementById(fieldId);
    acc[fieldId] = Boolean(input?.checked);
    return acc;
  }, {});

  chrome.storage.sync.set(nextSettings);
}

function restoreSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    fieldIds.forEach((fieldId) => {
      const input = document.getElementById(fieldId);
      if (input) {
        input.checked = Boolean(settings[fieldId]);
        input.addEventListener("change", saveSettings);
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", restoreSettings);
