(function initXCleanerCore(root, factory) {
  const exported = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  }

  root.XCleanerCore = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildXCleanerCore() {
  const DEFAULT_SETTINGS = {
    enabled: true,
    hidePromoted: true,
    hideWhoToFollow: false,
    hideTrends: false,
    debugMode: false,
    promotedScoreThreshold: 6
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

  const PROMOTED_BADGE_PATTERNS = [
    ...PROMOTED_PATTERNS,
    /\bad\b/,
    /\badvertiser\b/,
    /\bpaid partnership\b/,
    /\bsponsored content\b/
  ];

  const PROMOTED_CTA_PATTERNS = [
    /\blearn more\b/,
    /\bshop now\b/,
    /\binstall\b/,
    /\bsign up\b/,
    /\bbook now\b/,
    /\bwatch now\b/,
    /\bapply now\b/,
    /\bcomprar\b/,
    /\binstalar\b/
  ];

  const SIDEBAR_RULES = {
    whoToFollow: {
      settingKey: 'hideWhoToFollow',
      reason: 'who-to-follow',
      patterns: [
        /\bwho to follow\b/,
        /\ba quien seguir\b/,
        /\ba quién seguir\b/,
        /\bsuggested for you\b/,
        /\btal vez te interese\b/
      ]
    },
    trends: {
      settingKey: 'hideTrends',
      reason: 'trends',
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

  function normalizeText(value) {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function countPatternMatches(text, patterns) {
    return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  }

  function normalizeList(values) {
    return (values || []).map((value) => normalizeText(String(value))).filter(Boolean);
  }

  function collectPromotedSignals(rawInput) {
    const input = rawInput || {};
    const text = normalizeText(input.text);
    const hrefs = normalizeList(input.hrefs);
    const ariaLabels = normalizeList(input.ariaLabels);
    const testIds = normalizeList(input.testIds);
    const badgeTexts = normalizeList(input.badgeTexts);
    const joinedBadges = normalizeText([...ariaLabels, ...badgeTexts, ...testIds].join(' '));

    const promotedLabelHits = countPatternMatches(text, PROMOTED_PATTERNS);
    const badgeHits = countPatternMatches(joinedBadges, PROMOTED_BADGE_PATTERNS);
    const contextHits = countPatternMatches(text, PROMOTED_CONTEXT_PATTERNS);
    const ctaHits = countPatternMatches(text, PROMOTED_CTA_PATTERNS);
    const adLinks = hrefs.filter((href) => /\/(i\/ads\/|advertiser\/)/.test(href));
    const advertiserLinks = hrefs.filter((href) => href.includes('/advertiser/'));
    const placementTrackingHits = testIds.filter((testId) =>
      /(placement|promoted|sponsored|\bad\b|^ad-)/.test(testId)
    ).length;
    const ariaSponsoredHits = countPatternMatches(ariaLabels.join(' '), PROMOTED_BADGE_PATTERNS);
    const hasSocialActions = Boolean(input.hasSocialActions);
    const hasMenu = Boolean(input.hasMenu);
    const structuralSponsoredBadge = Boolean(input.hasSponsoredBadge);
    const hasSponsoredBadge = structuralSponsoredBadge || badgeHits > 0 || ariaSponsoredHits > 0;

    let score = 0;

    if (promotedLabelHits > 0) {
      score += 5;
    }

    if (hasSponsoredBadge) {
      score += 4;
    }

    if (adLinks.length > 0) {
      score += 4;
    }

    if (advertiserLinks.length > 0) {
      score += 2;
    }

    if (placementTrackingHits > 0) {
      score += 3;
    }

    if (ctaHits > 0) {
      score += 1;
    }

    if (contextHits > 0) {
      score += 1;
    }

    if (hasMenu) {
      score += 1;
    }

    return {
      text,
      hrefs,
      promotedLabelHits,
      badgeHits,
      contextHits,
      ctaHits,
      adLinks,
      advertiserLinks,
      placementTrackingHits,
      ariaSponsoredHits,
      hasSocialActions,
      hasMenu,
      hasSponsoredBadge,
      structuralSponsoredBadge,
      score
    };
  }

  function shouldHidePromotedFromSignals(signals, threshold = DEFAULT_SETTINGS.promotedScoreThreshold) {
    if (!signals) {
      return false;
    }

    // Only count signals derived from DOM attributes/URLs, not from tweet body text
    const structuralSignals = [
      signals.structuralSponsoredBadge,
      signals.adLinks.length > 0,
      signals.placementTrackingHits > 0
    ].filter(Boolean).length;

    const hasTimelineContext = signals.contextHits > 0 || signals.hasSocialActions || signals.hasMenu;
    const hasStructuralAdSignal = signals.structuralSponsoredBadge || signals.adLinks.length > 0 || signals.placementTrackingHits > 0;

    if (signals.promotedLabelHits > 0 && hasTimelineContext && hasStructuralAdSignal) {
      return true;
    }

    if (structuralSignals >= 2 && signals.score >= threshold) {
      return true;
    }

    return false;
  }


  function isTimelineCardMeta(meta) {
    if (!meta) {
      return false;
    }

    const tagName = String(meta.tagName || '').toUpperCase();
    const dataTestId = normalizeText(meta.dataTestId);
    const role = normalizeText(meta.role);

    return tagName === 'ARTICLE' || dataTestId === 'tweet' || role === 'article';
  }

  function shouldDebugPromotedCandidate(signals, threshold = DEFAULT_SETTINGS.promotedScoreThreshold) {
    if (!signals) {
      return false;
    }

    if (shouldHidePromotedFromSignals(signals, threshold)) {
      return true;
    }

    return (
      signals.promotedLabelHits > 0 ||
      signals.hasSponsoredBadge ||
      signals.adLinks.length > 0 ||
      signals.placementTrackingHits > 0 ||
      signals.score >= Math.max(4, threshold - 1)
    );
  }

  function matchSidebarRule(text) {
    const normalized = normalizeText(text);

    return Object.values(SIDEBAR_RULES).find((rule) =>
      rule.patterns.some((pattern) => pattern.test(normalized))
    );
  }

  function buildDebugDetails(signals, threshold = DEFAULT_SETTINGS.promotedScoreThreshold) {
    return [
      `score=${signals.score}`,
      `threshold=${threshold}`,
      `labels=${signals.promotedLabelHits}`,
      `badges=${signals.badgeHits}`,
      `adLinks=${signals.adLinks.length}`,
      `placement=${signals.placementTrackingHits}`,
      `cta=${signals.ctaHits}`,
      `context=${signals.contextHits}`,
      `actions=${signals.hasSocialActions ? 1 : 0}`,
      `menu=${signals.hasMenu ? 1 : 0}`
    ].join(' | ');
  }

  return {
    DEFAULT_SETTINGS,
    SIDEBAR_RULES,
    normalizeText,
    countPatternMatches,
    collectPromotedSignals,
    shouldHidePromotedFromSignals,
    isTimelineCardMeta,
    shouldDebugPromotedCandidate,
    matchSidebarRule,
    buildDebugDetails
  };
});
