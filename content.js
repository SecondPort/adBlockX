const DEFAULT_SETTINGS = {
  enabled: true,
  hidePromoted: true,
  hideWhoToFollow: false,
  hideTrends: false,
  debugMode: false
};

const SELECTORS = {
  timelineCards: [
    'article[data-testid="tweet"]',
    'article[role="article"]',
    'article'
  ],
  sidebarRoots: [
    '[data-testid="sidebarColumn"]',
    'aside[role="complementary"]',
    'aside'
  ],
  sidebarBlocks: [
    'section',
    '[role="region"]',
    '[data-testid="trend"]',
    '[data-testid="UserCell"]'
  ]
};

const PROMOTED_PATTERNS = [
  /\bpromoted\b/,
  /\bpromocionado\b/,
  /\bpatrocinado\b/,
  /\bsponsored\b/,
  /\bgesponsert\b/,
  /\bpublicite\b/,
  /\bpublicidad\b/
];

const PROMOTED_CONTEXT_PATTERNS = [
  /\bfollow\b/,
  /\bfollowing\b/,
  /\breply\b/,
  /\breplies\b/,
  /\bretweet\b/,
  /\blike\b/,
  /\bview(s)?\b/,
  /\bpost\b/,
  /\btweet\b/,
  /\bseguir\b/,
  /\bresponder\b/,
  /\bme gusta\b/,
  /\brepostear\b/,
  /\brepost\b/
];

const SIDEBAR_RULES = {
  whoToFollow: {
    settingKey: "hideWhoToFollow",
    reason: "who-to-follow",
    patterns: [
      /\bwho to follow\b/,
      /\ba quien seguir\b/,
      /\ba quién seguir\b/,
      /\bsuggested for you\b/,
      /\btal vez te interese\b/
    ]
  },
  trends: {
    settingKey: "hideTrends",
    reason: "trends",
    patterns: [
      /\btrends for you\b/,
      /\bwhat'?s happening\b/,
      /\bque esta pasando\b/,
      /\bqué esta pasando\b/,
      /\bqué está pasando\b/,
      /\btendencias para ti\b/,
      /\btrending\b/
    ]
  }
};

const HIDDEN_ATTRIBUTE = "data-x-cleaner-hidden";
const HIDDEN_REASON_ATTRIBUTE = "data-x-cleaner-reason";
const SIGNATURE_ATTRIBUTE = "data-x-cleaner-signature";
const DEBUG_ATTRIBUTE = "data-x-cleaner-debug";
const DEBUG_DETAILS_ATTRIBUTE = "data-x-cleaner-debug-details";

let settings = { ...DEFAULT_SETTINGS };
let observer = null;
let scanTimer = null;
let navigationHooked = false;
const pendingScanRoots = new Set();

function normalizeText(value) {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeMatches(node, selector) {
  return node instanceof Element && typeof node.matches === "function" && node.matches(selector);
}

function safeClosest(node, selector) {
  return node instanceof Element && typeof node.closest === "function" ? node.closest(selector) : null;
}

function uniqueElements(elements) {
  return [...new Set(elements.filter(Boolean))];
}

function collectNodeText(node) {
  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const textParts = [
    node.innerText,
    node.textContent,
    node.getAttribute("aria-label"),
    node.getAttribute("title"),
    node.getAttribute("data-testid")
  ];

  return normalizeText(textParts.filter(Boolean).join(" "));
}

function getSignature(node) {
  if (!(node instanceof HTMLElement)) {
    return "";
  }

  const text = collectNodeText(node).slice(0, 500);
  const hrefs = [...node.querySelectorAll("a[href]")]
    .slice(0, 10)
    .map((link) => link.getAttribute("href") || "")
    .join("|");

  return `${text}::${hrefs}`;
}

function hideElement(element, reason) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  if (settings.debugMode) {
    element.removeAttribute(HIDDEN_ATTRIBUTE);
    element.setAttribute(DEBUG_ATTRIBUTE, reason);
    return;
  }

  element.setAttribute(HIDDEN_ATTRIBUTE, "true");
  element.setAttribute(HIDDEN_REASON_ATTRIBUTE, reason);
}

function showElement(element) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  element.removeAttribute(HIDDEN_ATTRIBUTE);
  element.removeAttribute(HIDDEN_REASON_ATTRIBUTE);
  element.removeAttribute(DEBUG_ATTRIBUTE);
  element.removeAttribute(DEBUG_DETAILS_ATTRIBUTE);
}

function setDebugDetails(element, reason, details) {
  if (!(element instanceof HTMLElement) || !settings.debugMode) {
    return;
  }

  element.setAttribute(DEBUG_ATTRIBUTE, reason);
  element.setAttribute(DEBUG_DETAILS_ATTRIBUTE, details);
}

function clearDebugDetails(element) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  element.removeAttribute(DEBUG_ATTRIBUTE);
  element.removeAttribute(DEBUG_DETAILS_ATTRIBUTE);
}

function isLikelyTimelineCard(node) {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  if (node.tagName === "ARTICLE") {
    return true;
  }

  return Boolean(
    node.querySelector('article, [data-testid="tweet"], [role="article"]')
  );
}

function isLikelySidebarBlock(node) {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  return Boolean(safeClosest(node, SELECTORS.sidebarRoots.join(",")));
}

function countPatternMatches(text, patterns) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function extractPromotedSignals(card) {
  const text = collectNodeText(card);
  const hrefs = [...card.querySelectorAll("a[href]")]
    .map((link) => normalizeText(link.getAttribute("href")))
    .filter(Boolean);

  const promotedLabelHits = countPatternMatches(text, PROMOTED_PATTERNS);
  const promotedHrefHits = hrefs.some((href) => href.includes("/ads") || href.includes("/advertiser"));
  const contextHits = countPatternMatches(text, PROMOTED_CONTEXT_PATTERNS);
  const hasSocialActions = Boolean(
    card.querySelector(
      '[data-testid="reply"], [data-testid="retweet"], [data-testid="like"], [role="group"]'
    )
  );
  const hasMenu = Boolean(
    card.querySelector('[aria-label*="more" i], [aria-label*="más" i], [data-testid="caret"]')
  );

  let score = 0;

  if (promotedLabelHits > 0) {
    score += 4;
  }

  if (promotedHrefHits) {
    score += 2;
  }

  if (contextHits > 0) {
    score += 1;
  }

  if (hasSocialActions) {
    score += 1;
  }

  if (hasMenu) {
    score += 1;
  }

  return {
    score,
    text,
    promotedLabelHits,
    promotedHrefHits,
    contextHits,
    hasSocialActions,
    hasMenu
  };
}

function shouldHidePromotedCard(card) {
  const signals = extractPromotedSignals(card);

  if (signals.promotedLabelHits === 0) {
    return false;
  }

  return signals.score >= 5;
}

function processTimelineCard(card) {
  if (!(card instanceof HTMLElement)) {
    return;
  }

  const signature = getSignature(card);
  const previousSignature = card.getAttribute(SIGNATURE_ATTRIBUTE);
  const hiddenReason = card.getAttribute(HIDDEN_REASON_ATTRIBUTE);

  if (previousSignature === signature && hiddenReason !== "promoted") {
    return;
  }

  card.setAttribute(SIGNATURE_ATTRIBUTE, signature);

  const signals = extractPromotedSignals(card);
  const promotedDetails = [
    `score=${signals.score}`,
    `labels=${signals.promotedLabelHits}`,
    `adLinks=${signals.promotedHrefHits ? 1 : 0}`,
    `context=${signals.contextHits}`,
    `actions=${signals.hasSocialActions ? 1 : 0}`,
    `menu=${signals.hasMenu ? 1 : 0}`
  ].join(" | ");

  if (settings.debugMode && signals.promotedLabelHits > 0) {
    setDebugDetails(card, "promoted-candidate", promotedDetails);
  } else {
    clearDebugDetails(card);
  }

  if (
    settings.enabled &&
    settings.hidePromoted &&
    signals.promotedLabelHits > 0 &&
    signals.score >= 5
  ) {
    setDebugDetails(card, "promoted-match", promotedDetails);
    hideElement(card, "promoted");
    return;
  }

  if (hiddenReason === "promoted") {
    showElement(card);
  }
}

function findSidebarBlocks(root) {
  const sidebarRoots = uniqueElements([
    ...root.querySelectorAll(SELECTORS.sidebarRoots.join(",")),
    ...SELECTORS.sidebarRoots.map((selector) => safeClosest(root, selector))
  ]);

  return uniqueElements(
    sidebarRoots.flatMap((sidebarRoot) => [
      ...(SELECTORS.sidebarBlocks.some((selector) => safeMatches(sidebarRoot, selector))
        ? [sidebarRoot]
        : []),
      ...uniqueElements(
        SELECTORS.sidebarBlocks.flatMap((selector) => [
          ...sidebarRoot.querySelectorAll(selector)
        ])
      )
    ])
  );
}

function matchSidebarRule(text) {
  return Object.values(SIDEBAR_RULES).find((rule) =>
    rule.patterns.some((pattern) => pattern.test(text))
  );
}

function processSidebarBlock(block) {
  if (!(block instanceof HTMLElement)) {
    return;
  }

  const text = collectNodeText(block);
  const rule = matchSidebarRule(text);
  const hiddenReason = block.getAttribute(HIDDEN_REASON_ATTRIBUTE);

  if (settings.debugMode && rule) {
    setDebugDetails(block, `${rule.reason}-candidate`, `rule=${rule.reason}`);
  } else {
    clearDebugDetails(block);
  }

  if (
    settings.enabled &&
    rule &&
    settings[rule.settingKey]
  ) {
    setDebugDetails(block, `${rule.reason}-match`, `rule=${rule.reason}`);
    hideElement(block, rule.reason);
    return;
  }

  if (hiddenReason === "who-to-follow" || hiddenReason === "trends") {
    showElement(block);
  }
}

function queryTimelineCards(root) {
  return uniqueElements(
    SELECTORS.timelineCards.flatMap((selector) => [
      ...root.querySelectorAll(selector)
    ])
  );
}

function scanNode(root) {
  if (!(root instanceof Document) && !(root instanceof HTMLElement)) {
    return;
  }

  const cards = uniqueElements([
    ...(isLikelyTimelineCard(root) ? [safeClosest(root, "article") || root] : []),
    ...queryTimelineCards(root)
  ]);

  cards.forEach(processTimelineCard);

  const sidebarBlocks = findSidebarBlocks(root);
  sidebarBlocks.forEach(processSidebarBlock);
}

function scheduleScan(root = document, delay = 80) {
  pendingScanRoots.add(root);

  if (scanTimer) {
    clearTimeout(scanTimer);
  }

  scanTimer = setTimeout(() => {
    const roots = [...pendingScanRoots];
    pendingScanRoots.clear();
    scanTimer = null;

    if (roots.length > 6 || roots.includes(document)) {
      scanNode(document);
      return;
    }

    roots.forEach((pendingRoot) => scanNode(pendingRoot));
  }, delay);
}

function handleMutations(mutations) {
  const rootsToScan = new Set();

  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      const element = mutation.target.parentElement;
      if (!element) {
        continue;
      }

      const promotedCard = safeClosest(element, "article");
      if (promotedCard) {
        rootsToScan.add(promotedCard);
      }

      const sidebarBlock = safeClosest(element, "section, [role='region'], aside");
      if (sidebarBlock && isLikelySidebarBlock(sidebarBlock)) {
        rootsToScan.add(sidebarBlock);
      }

      continue;
    }

    for (const node of mutation.addedNodes) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      if (isLikelyTimelineCard(node) || isLikelySidebarBlock(node)) {
        rootsToScan.add(node);
        continue;
      }

      const card = safeClosest(node, "article");
      if (card) {
        rootsToScan.add(card);
      }

      const sidebarBlock = safeClosest(node, "section, [role='region'], aside");
      if (sidebarBlock && isLikelySidebarBlock(sidebarBlock)) {
        rootsToScan.add(sidebarBlock);
      }

      if (node.querySelector("article, aside, [data-testid='sidebarColumn']")) {
        rootsToScan.add(node);
      }
    }
  }

  if (rootsToScan.size === 0) {
    return;
  }

  rootsToScan.forEach((root) => scheduleScan(root));
}

function startObserver() {
  if (observer || !document.body) {
    return;
  }

  observer = new MutationObserver(handleMutations);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function hookNavigation() {
  if (navigationHooked) {
    return;
  }

  navigationHooked = true;

  const wrapHistoryMethod = (methodName) => {
    const original = window.history[methodName];

    window.history[methodName] = function wrappedHistoryMethod(...args) {
      const result = original.apply(this, args);
      scheduleScan(document, 120);
      return result;
    };
  };

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
  window.addEventListener("popstate", () => scheduleScan(document, 120));
}

function applySettingsRefresh() {
  document.querySelectorAll(`[${HIDDEN_ATTRIBUTE}="true"]`).forEach((element) => {
    showElement(element);
  });

  document.querySelectorAll(`[${DEBUG_ATTRIBUTE}]`).forEach((element) => {
    clearDebugDetails(element);
  });

  document.querySelectorAll(`[${SIGNATURE_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(SIGNATURE_ATTRIBUTE);
  });

  scheduleScan(document, 0);
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
      settings = { ...DEFAULT_SETTINGS, ...result };
      resolve(settings);
    });
  });
}

function handleStorageChanges(changes, areaName) {
  if (areaName !== "sync") {
    return;
  }

  let changed = false;

  for (const [key, change] of Object.entries(changes)) {
    if (!(key in settings)) {
      continue;
    }

    settings[key] = change.newValue;
    changed = true;
  }

  if (changed) {
    applySettingsRefresh();
  }
}

async function bootstrap() {
  await loadSettings();
  scanNode(document);
  startObserver();
  hookNavigation();
}

chrome.storage.onChanged.addListener(handleStorageChanges);
bootstrap();
