const { DEFAULT_SETTINGS } = globalThis.XCleanerCore;
const fieldIds = Object.keys(DEFAULT_SETTINGS);

function readInputValue(input) {
  if (!input) {
    return undefined;
  }

  if (input.type === 'checkbox') {
    return Boolean(input.checked);
  }

  if (input.type === 'range' || input.type === 'number') {
    return Number(input.value);
  }

  return input.value;
}

function updateThresholdLabel(value) {
  const output = document.getElementById('promotedScoreThresholdValue');
  if (output) {
    output.textContent = String(value);
  }
}

function saveSettings() {
  const nextSettings = fieldIds.reduce((acc, fieldId) => {
    const input = document.getElementById(fieldId);
    const value = readInputValue(input);

    if (typeof value !== 'undefined') {
      acc[fieldId] = value;
    }

    return acc;
  }, {});

  updateThresholdLabel(nextSettings.promotedScoreThreshold);
  chrome.storage.sync.set(nextSettings);
}

function restoreSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    fieldIds.forEach((fieldId) => {
      const input = document.getElementById(fieldId);
      if (!input) {
        return;
      }

      if (input.type === 'checkbox') {
        input.checked = Boolean(settings[fieldId]);
      } else {
        input.value = String(settings[fieldId]);
      }

      input.addEventListener('change', saveSettings);
      input.addEventListener('input', saveSettings);
    });

    updateThresholdLabel(settings.promotedScoreThreshold);
  });
}

document.addEventListener('DOMContentLoaded', restoreSettings);
