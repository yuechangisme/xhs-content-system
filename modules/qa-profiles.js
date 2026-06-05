/**
 * QA rule profiles keyed by manifest.styleVersion.
 *
 * Missing styleVersion intentionally maps to legacy so existing content keeps
 * the original QA behavior.
 */

const config = require('../config');

const legacyTextClasses = [
  'food-desc', 'check-text', 'cta-opt',
  'comfort-body', 'body', 'pain-text',
  'habit-scene', 'intro-text', 'summary-text',
];

const profiles = {
  legacy: {
    name: 'legacy',
    typography: legacyTextClasses.map(cls => ({
      selector: `.${cls}`,
      min: config.qa.fontSizeMin,
      tier: 'legacy_body',
    })),
  },

  'lazy-health-v6.1': {
    name: 'lazy-health-v6.1',
    typography: [
      { selector: '.cover-title', min: 90, tier: 'cover_title' },

      { selector: '.page-title', min: 52, tier: 'page_title' },

      { selector: '.subtitle', min: 34, tier: 'subtitle_cta' },
      { selector: '.cta-card .big', min: 34, tier: 'subtitle_cta' },
      { selector: '.save-btn', min: 34, tier: 'subtitle_cta' },

      { selector: '.note-value', min: 32, tier: 'primary_body' },
      { selector: '.method-text', min: 32, tier: 'primary_body' },
      { selector: '.sum-value', min: 32, tier: 'primary_body' },
      { selector: '.menu-foods', min: 32, tier: 'primary_body' },
      { selector: '.principle-main', min: 32, tier: 'primary_body' },

      { selector: '.food-desc', min: 24, tier: 'secondary_body' },
      { selector: '.principle-note', min: 24, tier: 'secondary_body' },
      { selector: '.menu-fit', min: 24, tier: 'secondary_body' },
      { selector: '.bottom-tip', min: 24, tier: 'secondary_body' },
      { selector: '.memory-line', min: 24, tier: 'secondary_body' },
      { selector: '.compare-line .muted', min: 24, tier: 'secondary_body' },

      { selector: '.food-tag', min: 18, tier: 'label_brand' },
      { selector: '.brand', min: 18, tier: 'label_brand' },
      { selector: '.topbar .left', min: 18, tier: 'label_brand' },
      { selector: '.topbar .right', min: 18, tier: 'label_brand' },
      { selector: '.cover-offer .hint', min: 18, tier: 'label_brand' },
    ],
  },

  'lazy-health-v7': {
    name: 'lazy-health-v7',
    typography: [
      { selector: '.cover-title', min: 90, tier: 'cover_title' },
      { selector: '.title', min: 52, tier: 'page_title' },

      { selector: '.cover-sub', min: 34, tier: 'subtitle' },
      { selector: '.save', min: 34, tier: 'summary_warning' },

      { selector: '.item-title', min: 34, tier: 'item_title' },
      { selector: '.item-text', min: 32, tier: 'primary_body' },
      { selector: '.summary-line', min: 32, tier: 'summary_body' },
      { selector: '.one-line', min: 34, tier: 'emphasis' },

      { selector: '.tiny', min: 18, tier: 'label_brand' },
      { selector: '.kicker', min: 18, tier: 'label_brand' },
      { selector: '.brand', min: 18, tier: 'label_brand' },
      { selector: '.page', min: 18, tier: 'label_brand' },
    ],
    customChecks: ['lazy_health_v7'],
  },
};

function resolveProfile(styleVersion) {
  if (!styleVersion) return profiles.legacy;
  return profiles[styleVersion] || null;
}

module.exports = { resolveProfile, profiles };
