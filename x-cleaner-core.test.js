const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SETTINGS,
  normalizeText,
  collectPromotedSignals,
  shouldHidePromotedFromSignals,
  matchSidebarRule,
  buildDebugDetails,
  isTimelineCardMeta,
  shouldDebugPromotedCandidate
} = require('./x-cleaner-core.js');

test('normalizeText removes accents and collapses whitespace', () => {
  assert.equal(normalizeText('  Qué   está   pasando  '), 'que esta pasando');
});

test('detects promoted cards even without explicit promoted label when strong ad signals exist', () => {
  const signals = collectPromotedSignals({
    text: 'Install now Learn more Limited offer',
    hrefs: ['/i/ads/123', '/advertiser/acme'],
    hasSocialActions: true,
    hasMenu: true,
    hasSponsoredBadge: true,
    ariaLabels: ['Sponsored content'],
    testIds: ['placementTracking']
  });

  assert.equal(signals.promotedLabelHits, 0);
  assert.equal(shouldHidePromotedFromSignals(signals), true);
});

test('does not hide regular posts with normal social actions only', () => {
  const signals = collectPromotedSignals({
    text: 'reply retweet like view post',
    hrefs: ['/user/status/1'],
    hasSocialActions: true,
    hasMenu: true
  });

  assert.equal(shouldHidePromotedFromSignals(signals), false);
});

test('treats explicit promoted labels as decisive only when timeline context AND structural signal exist', () => {
  const withStructural = collectPromotedSignals({
    text: 'Promoted reply retweet like',
    hrefs: ['/i/ads/count'],
    hasSocialActions: true,
    hasMenu: true
  });
  assert.equal(shouldHidePromotedFromSignals(withStructural), true);

  const textOnlyNoStructural = collectPromotedSignals({
    text: 'Promoted reply retweet like',
    hrefs: ['/some/path'],
    hasSocialActions: true,
    hasMenu: true
  });
  assert.equal(shouldHidePromotedFromSignals(textOnlyNoStructural), false);
});

test('matches sidebar rules across normalized locales', () => {
  const rule = matchSidebarRule('Qué está pasando Tendencias para ti');
  assert.equal(rule?.reason, 'trends');
});

test('buildDebugDetails includes decisive signals for inspection', () => {
  const signals = collectPromotedSignals({
    text: 'Sponsored Learn more',
    hrefs: ['/advertiser/acme'],
    hasSocialActions: true,
    hasMenu: false,
    ariaLabels: ['Sponsored']
  });

  const details = buildDebugDetails(signals);
  assert.match(details, /score=/);
  assert.match(details, /adLinks=1/);
  assert.match(details, /badges=/);
});

test('exports default settings used by popup and content script', () => {
  assert.equal(DEFAULT_SETTINGS.enabled, true);
  assert.equal(DEFAULT_SETTINGS.hidePromoted, true);
});

test('only real card elements are treated as timeline cards', () => {
  assert.equal(isTimelineCardMeta({ tagName: 'MAIN', dataTestId: 'primaryColumn', role: 'main' }), false);
  assert.equal(isTimelineCardMeta({ tagName: 'ARTICLE' }), true);
  assert.equal(isTimelineCardMeta({ tagName: 'DIV', role: 'article' }), true);
});


test('debug candidate gating ignores weak organic signals', () => {
  const weakOrganic = collectPromotedSignals({
    text: 'reply retweet like',
    hrefs: ['/user/status/1'],
    hasSocialActions: true,
    hasMenu: true
  });

  const strongCandidate = collectPromotedSignals({
    text: 'Learn more limited offer',
    hrefs: ['/advertiser/acme'],
    hasSocialActions: true,
    hasMenu: true
  });

  assert.equal(shouldDebugPromotedCandidate(weakOrganic), false);
  assert.equal(shouldDebugPromotedCandidate(strongCandidate), true);
});
