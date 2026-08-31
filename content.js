const {
  DEFAULT_SETTINGS,
  normalizeText,
  collectPromotedSignals,
  shouldHidePromotedFromSignals,
  isTimelineCardMeta,
  shouldDebugPromotedCandidate,
  matchSidebarRule,
  buildDebugDetails
} = globalThis.XCleanerCore;

const SELECTORS = {
  timelineCards: [
    'article[data-testid="tweet"]',
    'article[role="article"]',
    'article'
  ],
  timelineRoots: [
    '[data-testid="primaryColumn"]',
    'main[role="main"]',
    'main'
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

const HIDDEN_ATTRIBUTE = 'data-x-cleaner-hidden';
const HIDDEN_REASON_ATTRIBUTE = 'data-x-cleaner-reason';
const DEBUG_ATTRIBUTE = 'data-x-cleaner-debug';
const DEBUG_DETAILS_ATTRIBUTE = 'data-x-cleaner-debug-details';
const DEBUG_PANEL_ID = 'x-cleaner-debug-panel';

let settings = { ...DEFAULT_SETTINGS };
let observers = [];
let observerRootsSignature = '';
let scanTimer = null;
let navigationHooked = false;
let processedSignatures = new WeakMap();
const pendingScanRoots = new Set();
const debugStats = {
  scans: 0,
  hiddenPromoted: 0,
  hiddenSidebar: 0,
  lastScanMs: 0
};

function safeMatches(node, selector) {
  return node instanceof Element && typeof node.matches === 'function' && node.matches(selector);
}

function safeClosest(node, selector) {
  return node instanceof Element && typeof node.closest === 'function' ? node.closest(selector) : null;
}

function uniqueElements(elements) {
  return [...new Set(elements.filter(Boolean))];
}

function collectNodeText(node) {
  if (!(node instanceof HTMLElement)) {
    return '';
  }

  const textParts = [
    node.innerText,
    node.textContent,
    node.getAttribute('aria-label'),
    node.getAttribute('title'),
    node.getAttribute('data-testid')
  ];

  return normalizeText(textParts.filter(Boolean).join(' '));
}

function getSignature(node) {
  if (!(node instanceof HTMLElement)) {
    return '';
  }

  const text = collectNodeText(node).slice(0, 500);
  const hrefs = [...node.querySelectorAll('a[href]')]
    .slice(0, 12)
    .map((link) => link.getAttribute('href') || '')
    .join('|');

  return `${text}::${hrefs}`;
}

function hideElement(element, reason) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (settings.debugMode) {
    element.removeAttribute(HIDDEN_ATTRIBUTE);
    element.removeAttribute(HIDDEN_REASON_ATTRIBUTE);
    element.setAttribute(DEBUG_ATTRIBUTE, reason);
    return false;
  }

  const alreadyHidden = element.getAttribute(HIDDEN_ATTRIBUTE) === 'true';
  element.setAttribute(HIDDEN_ATTRIBUTE, 'true');
  element.setAttribute(HIDDEN_REASON_ATTRIBUTE, reason);
  element.removeAttribute(DEBUG_ATTRIBUTE);

  return !alreadyHidden;
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

function ensureDebugPanel() {
  const existing = document.getElementById(DEBUG_PANEL_ID);

  if (!settings.debugMode) {
    existing?.remove();
    return null;
  }

  if (existing) {
    return existing;
  }

  const panel = document.createElement('div');
  panel.id = DEBUG_PANEL_ID;
  document.documentElement.appendChild(panel);
  return panel;
}

function updateDebugPanel() {
  const panel = ensureDebugPanel();

  if (!panel) {
    return;
  }

  panel.textContent = `X Cleaner debug · scans ${debugStats.scans} · promoted ${debugStats.hiddenPromoted} · sidebar ${debugStats.hiddenSidebar} · ${debugStats.lastScanMs}ms`;
}

function isTimelineCardElement(node) {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  return isTimelineCardMeta({
    tagName: node.tagName,
    dataTestId: node.getAttribute('data-testid'),
    role: node.getAttribute('role')
  });
}

function containsTimelineCard(node) {
  return (
    node instanceof HTMLElement &&
    Boolean(node.querySelector('article, [data-testid="tweet"], [role="article"]'))
  );
}

function isLikelySidebarBlock(node) {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  return Boolean(safeClosest(node, SELECTORS.sidebarRoots.join(',')));
}

const SIDEBAR_SEARCH_SELECTORS = [
  '[data-testid="SearchBox_Search_Input"]',
  'input[placeholder*="buscar" i]',
  'input[aria-label*="buscar" i]',
  'input[placeholder*="search" i]',
  'input[aria-label*="search" i]'
].join(', ');

function containsSidebarSearch(node) {
  return node instanceof HTMLElement && Boolean(node.querySelector(SIDEBAR_SEARCH_SELECTORS));
}

function isSidebarModuleCandidate(node, rule) {
  if (!(node instanceof HTMLElement) || !rule) {
    return false;
  }

  if (containsSidebarSearch(node)) {
    return false;
  }

  const text = collectNodeText(node);
  const hasHeading = rule.patterns.some((pattern) => pattern.test(text));

  if (!hasHeading) {
    return false;
  }

  if (rule.reason === 'who-to-follow') {
    return Boolean(node.querySelector('[data-testid="UserCell"]')) && /\b(seguir|follow)\b/.test(text);
  }

  if (rule.reason === 'trends') {
    return Boolean(node.querySelector('a[href*="/search?q="], [data-testid="trend"]'));
  }

  return false;
}

function resolveSidebarModule(element, sidebarRoot, rule) {
  if (!(element instanceof HTMLElement) || !(sidebarRoot instanceof HTMLElement) || !rule) {
    return null;
  }

  let current = element;

  while (current && current !== sidebarRoot) {
    if (isSidebarModuleCandidate(current, rule)) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function findMatchedSidebarModules(sidebarRoot) {
  if (!(sidebarRoot instanceof HTMLElement)) {
    return [];
  }

  const matchedModules = [];
  const candidates = [sidebarRoot, ...sidebarRoot.querySelectorAll('*')];

  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) {
      continue;
    }

    const text = collectNodeText(candidate);
    if (!text || text.length > 120) {
      continue;
    }

    const rule = matchSidebarRule(text);
    if (!rule) {
      continue;
    }

    const moduleRoot = resolveSidebarModule(candidate, sidebarRoot, rule);
    if (moduleRoot) {
      matchedModules.push(moduleRoot);
    }
  }

  return uniqueElements(matchedModules);
}

function extractPromotedSignals(card) {
  const text = collectNodeText(card);
  const hrefs = [...card.querySelectorAll('a[href]')]
    .map((link) => normalizeText(link.getAttribute('href')))
    .filter(Boolean);
  const ariaLabels = [
    card.getAttribute('aria-label'),
    ...[...card.querySelectorAll('[aria-label]')].map((element) => element.getAttribute('aria-label'))
  ].filter(Boolean);
  const badgeTexts = [...card.querySelectorAll('[role="link"], [role="button"], span, div')]
    .slice(0, 20)
    .map((element) => element.textContent)
    .filter(Boolean);
  const testIds = [
    card.getAttribute('data-testid'),
    ...[...card.querySelectorAll('[data-testid]')].map((element) => element.getAttribute('data-testid'))
  ].filter(Boolean);

  return collectPromotedSignals({
    text,
    hrefs,
    ariaLabels,
    badgeTexts,
    testIds,
    hasSocialActions: Boolean(
      card.querySelector(
        '[data-testid="reply"], [data-testid="retweet"], [data-testid="like"], [role="group"]'
      )
    ),
    hasMenu: Boolean(
      card.querySelector('[aria-label*="more" i], [aria-label*="más" i], [data-testid="caret"]')
    ),
    hasSponsoredBadge: Boolean(
      card.querySelector('[data-testid*="placement" i], [data-testid*="promoted" i], [aria-label*="sponsor" i]')
    )
  });
}

function processTimelineCard(card) {
  if (!(card instanceof HTMLElement)) {
    return;
  }

  if (safeClosest(card, '[role="dialog"], [aria-modal="true"]')) {
    return;
  }

  const signature = getSignature(card);
  const previousSignature = processedSignatures.get(card);
  const hiddenReason = card.getAttribute(HIDDEN_REASON_ATTRIBUTE);

  if (previousSignature === signature && hiddenReason !== 'promoted') {
    return;
  }

  processedSignatures.set(card, signature);

  const signals = extractPromotedSignals(card);
  const promotedDetails = buildDebugDetails(signals, settings.promotedScoreThreshold);

  if (settings.debugMode && shouldDebugPromotedCandidate(signals, settings.promotedScoreThreshold)) {
    setDebugDetails(card, 'promoted-candidate', promotedDetails);
  } else {
    clearDebugDetails(card);
  }

  if (
    settings.enabled &&
    settings.hidePromoted &&
    shouldHidePromotedFromSignals(signals, settings.promotedScoreThreshold)
  ) {
    console.warn('[x-cleaner] hiding tweet', {
      text: signals.text.slice(0, 120),
      score: signals.score,
      threshold: settings.promotedScoreThreshold,
      promotedLabelHits: signals.promotedLabelHits,
      structuralSponsoredBadge: signals.structuralSponsoredBadge,
      hasSponsoredBadge: signals.hasSponsoredBadge,
      adLinks: signals.adLinks,
      placementTrackingHits: signals.placementTrackingHits,
      hasMenu: signals.hasMenu,
      hasSocialActions: signals.hasSocialActions
    });
    setDebugDetails(card, 'promoted-match', promotedDetails);
    if (hideElement(card, 'promoted')) {
      debugStats.hiddenPromoted += 1;
    }
    return;
  }

  if (hiddenReason === 'promoted') {
    showElement(card);
  }
}

function getSidebarHideTarget(block) {
  if (!(block instanceof HTMLElement)) {
    return block;
  }

  const parent = block.parentElement;
  if (
    parent instanceof HTMLElement &&
    parent.childElementCount === 1 &&
    !containsSidebarSearch(parent) &&
    !safeMatches(parent, SELECTORS.sidebarRoots.join(','))
  ) {
    return parent;
  }

  return block;
}

function findSidebarBlocks(root) {
  const sidebarRoots = uniqueElements([
    ...root.querySelectorAll(SELECTORS.sidebarRoots.join(',')),
    ...SELECTORS.sidebarRoots.map((selector) => safeClosest(root, selector))
  ]);

  return uniqueElements(
    sidebarRoots.flatMap((sidebarRoot) => [
      ...findMatchedSidebarModules(sidebarRoot),
      ...(SELECTORS.sidebarBlocks.some((selector) => safeMatches(sidebarRoot, selector))
        ? [sidebarRoot]
        : []),
      ...uniqueElements(
        SELECTORS.sidebarBlocks.flatMap((selector) => [...sidebarRoot.querySelectorAll(selector)])
      )
    ])
  );
}

function processSidebarBlock(block) {
  if (!(block instanceof HTMLElement)) {
    return;
  }

  const text = collectNodeText(block);
  const rule = matchSidebarRule(text);
  const hideTarget = getSidebarHideTarget(block);
  const hiddenReason = hideTarget?.getAttribute(HIDDEN_REASON_ATTRIBUTE);

  if (settings.debugMode && rule) {
    setDebugDetails(block, `${rule.reason}-candidate`, `rule=${rule.reason}`);
  } else {
    clearDebugDetails(block);
  }

  if (settings.enabled && rule && settings[rule.settingKey]) {
    setDebugDetails(block, `${rule.reason}-match`, `rule=${rule.reason}`);
    if (hideElement(hideTarget, rule.reason)) {
      debugStats.hiddenSidebar += 1;
    }
    return;
  }

  if (hiddenReason === 'who-to-follow' || hiddenReason === 'trends') {
    showElement(hideTarget);
  }
}

function queryTimelineCards(root) {
  return uniqueElements(
    SELECTORS.timelineCards.flatMap((selector) => [...root.querySelectorAll(selector)])
  );
}

function scanNode(root) {
  if (!(root instanceof Document) && !(root instanceof HTMLElement)) {
    return;
  }

  const startedAt = performance.now();

  const cards = uniqueElements([
    ...(isTimelineCardElement(root) ? [root] : []),
    ...queryTimelineCards(root)
  ]);

  cards.forEach(processTimelineCard);

  const sidebarBlocks = findSidebarBlocks(root);
  sidebarBlocks.forEach(processSidebarBlock);

  debugStats.scans += 1;
  debugStats.lastScanMs = Math.round((performance.now() - startedAt) * 10) / 10;
  updateDebugPanel();
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

function shouldScanNode(node) {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  if (isTimelineCardElement(node) || isLikelySidebarBlock(node)) {
    return true;
  }

  return containsTimelineCard(node) || Boolean(node.querySelector('aside, [data-testid="sidebarColumn"]'));
}

function handleMutations(mutations) {
  const rootsToScan = new Set();

  for (const mutation of mutations) {
    if (mutation.type === 'characterData') {
      const element = mutation.target.parentElement;
      if (!element) {
        continue;
      }

      const promotedCard = safeClosest(element, 'article');
      if (promotedCard) {
        rootsToScan.add(promotedCard);
      }

      const sidebarBlock = safeClosest(element, 'section, [role="region"], aside');
      if (sidebarBlock && isLikelySidebarBlock(sidebarBlock)) {
        rootsToScan.add(sidebarBlock);
      }

      continue;
    }

    for (const node of mutation.addedNodes) {
      if (!shouldScanNode(node)) {
        continue;
      }

      if (isTimelineCardElement(node) || isLikelySidebarBlock(node)) {
        rootsToScan.add(node);
        continue;
      }

      const card = safeClosest(node, 'article');
      if (card) {
        rootsToScan.add(card);
      }

      const sidebarBlock = safeClosest(node, 'section, [role="region"], aside');
      if (sidebarBlock && isLikelySidebarBlock(sidebarBlock)) {
        rootsToScan.add(sidebarBlock);
      }

      rootsToScan.add(node);
    }
  }

  if (rootsToScan.size === 0) {
    return;
  }

  rootsToScan.forEach((root) => scheduleScan(root));
}

function resolveObserverRoots() {
  const roots = uniqueElements([
    SELECTORS.timelineRoots.map((selector) => document.querySelector(selector)).find(Boolean),
    ...SELECTORS.sidebarRoots.map((selector) => document.querySelector(selector))
  ]);

  return roots.length > 0 ? roots : [document.body].filter(Boolean);
}

function disconnectObservers() {
  observers.forEach((currentObserver) => currentObserver.disconnect());
  observers = [];
  observerRootsSignature = '';
}

function startObserver() {
  const nextRoots = resolveObserverRoots();
  const nextSignature = nextRoots
    .map((root) => root?.getAttribute?.('data-testid') || root?.tagName || 'unknown')
    .join('|');

  if (nextRoots.length === 0) {
    return;
  }

  if (observers.length > 0 && observerRootsSignature === nextSignature) {
    return;
  }

  disconnectObservers();
  observerRootsSignature = nextSignature;

  nextRoots.forEach((root) => {
    if (!root) {
      return;
    }

    const nextObserver = new MutationObserver(handleMutations);
    nextObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true
    });
    observers.push(nextObserver);
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
      startObserver();
      scheduleScan(document, 120);
      return result;
    };
  };

  wrapHistoryMethod('pushState');
  wrapHistoryMethod('replaceState');
  window.addEventListener('popstate', () => {
    startObserver();
    scheduleScan(document, 120);
  });
}

function applySettingsRefresh() {
  debugStats.hiddenPromoted = 0;
  debugStats.hiddenSidebar = 0;
  processedSignatures = new WeakMap();

  document.querySelectorAll(`[${HIDDEN_ATTRIBUTE}="true"]`).forEach((element) => {
    showElement(element);
  });

  document.querySelectorAll(`[${DEBUG_ATTRIBUTE}]`).forEach((element) => {
    clearDebugDetails(element);
  });

  updateDebugPanel();
  scheduleScan(document, 0);
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
      settings = {
        ...DEFAULT_SETTINGS,
        ...result,
        promotedScoreThreshold: Number(result.promotedScoreThreshold ?? DEFAULT_SETTINGS.promotedScoreThreshold)
      };
      resolve(settings);
    });
  });
}

function handleStorageChanges(changes, areaName) {
  if (areaName !== 'sync') {
    return;
  }

  let changed = false;

  for (const [key, change] of Object.entries(changes)) {
    if (!(key in settings)) {
      continue;
    }

    settings[key] = key === 'promotedScoreThreshold' ? Number(change.newValue) : change.newValue;
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
