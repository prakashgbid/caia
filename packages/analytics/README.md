# @pokerzeno/analytics

Shared analytics package for all Pokerzeno sites. Provides:
- **Google Analytics 4** — consent-gated, deep event data
- **Cloudflare Web Analytics** — cookieless, always-on pageview data
- **GDPR/CCPA Consent Banner** — WCAG 2.2 AA, keyboard-accessible, focus-trapped modal
- **Typed Event Taxonomy** — shared event names and typed helper functions

## Architecture

```
AnalyticsProvider (root wrapper)
  └── ConsentProvider (state management)
       └── AnalyticsInner (loads GA4 after consent, Cloudflare immediately)
       └── ConsentBanner (bottom-fixed banner + customise modal)
```

### Two-Layer Analytics Strategy

| Layer | Tool | Consent Required | Cookies | Purpose |
|-------|------|-----------------|---------|---------|
| 1 | Cloudflare Web Analytics | No | No | Baseline pageviews, Core Web Vitals |
| 2 | Google Analytics 4 | Yes | Yes | Deep events, funnels, conversions |

Cloudflare fires immediately on load (cookieless = no consent needed under GDPR).
GA4 only loads after the user clicks "Accept all" or toggles analytics on.

## Usage

### 1. Add to root layout

```tsx
import { AnalyticsProvider, ConsentBanner } from '@pokerzeno/analytics';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <AnalyticsProvider
          measurementId={process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID}
          appName="my-site"
          debug={process.env.NODE_ENV === 'development'}
        >
          {children}
          <ConsentBanner />
        </AnalyticsProvider>
      </body>
    </html>
  );
}
```

### 2. Add env vars

```bash
# .env.local
NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-XXXXXXXXXX
```

### 3. Add "Manage cookies" link to footer

```tsx
'use client';
import { useConsent } from '@pokerzeno/analytics';

function Footer() {
  const { openBanner } = useConsent();
  return (
    <footer>
      <button onClick={openBanner}>Manage cookies</button>
    </footer>
  );
}
```

### 4. Track events

```tsx
import {
  trackBetPlaced, trackGameStart, trackGameEnd,
  trackCTAClicked, trackEmailCaptured, trackLessonStarted,
} from '@pokerzeno/analytics';

// Game events
trackGameStart({ variant: 'european', difficulty: 'medium', app_name: 'my-site' });
trackBetPlaced({ amount: 10, bet_type: 'red', variant: 'EU' });
trackGameEnd({ variant: 'EU', outcome: 'win', net_profit: 50, duration_sec: 120 });

// CTA clicks
trackCTAClicked({ name: 'play_now', position: 'hero', page: '/', destination: '/play' });

// Email capture
trackEmailCaptured('homepage_waitlist', '/');
```

### 5. Use the hook (in client components)

```tsx
import { useAnalytics } from '@pokerzeno/analytics';

function MyComponent() {
  const { track, analyticsEnabled } = useAnalytics();
  return <button onClick={() => track('custom_event', { key: 'value' })}>Click</button>;
}
```

## Event Taxonomy

All event names are in `src/events/taxonomy.ts`. Typed helpers exist for every event category.

### Game Events
| Function | Event | Key Params |
|----------|-------|-----------|
| `trackGameStart` | `game_start` | variant, difficulty, app_name |
| `trackGameEnd` | `game_end` | variant, outcome, net_profit, duration_sec |
| `trackBetPlaced` | `bet_placed` | amount, bet_type, variant, chip_value |
| `trackActionTaken` | `action_taken` | action, position, pot_size, street |
| `trackVariantChanged` | `variant_changed` | from, to |
| `trackDifficultySelected` | `difficulty_selected` | difficulty |

### Content Events
| Function | Event | Key Params |
|----------|-------|-----------|
| `trackLessonStarted` | `lesson_started` | lesson_id, lesson_title, category |
| `trackLessonCompleted` | `lesson_completed` | lesson_id, lesson_title, category |
| `trackArticleRead` | `article_read` | article_id, title, scroll_pct |
| `trackPaperRead` | `paper_read` | article_id, title |
| `trackVideoPlayed` | `video_played` | video_id, title, duration_sec |

### Community Events
| Function | Event | Key Params |
|----------|-------|-----------|
| `trackGroupJoined` | `group_joined` | group_id, group_name |
| `trackThreadPosted` | `thread_posted` | thread_id, forum |
| `trackCommentAdded` | `comment_added` | thread_id |
| `trackReactionAdded` | `reaction_added` | reaction, target_type |

### Commerce Events
| Function | Event | Key Params |
|----------|-------|-----------|
| `trackProductViewed` | `product_viewed` | product_id, product_name, price |
| `trackAddToCart` | `add_to_cart` | product_id, quantity |
| `trackCheckoutStarted` | `checkout_started` | value, item_count |

### Engagement Events
| Function | Event | Key Params |
|----------|-------|-----------|
| `trackCTAClicked` | `cta_clicked` | name, position, page, destination |
| `trackScrollDepth` | `scroll_depth` | scroll_pct (25/50/75/90/100) |
| `trackTimeOnPage` | `time_on_page` | duration_sec |
| `trackFullscreenToggled` | `fullscreen_toggled` | entered |
| `trackSoundToggled` | `sound_toggled` | muted |
| `trackUserPreferenceChanged` | `user_preference_changed` | preference_key, preference_value |

### Conversion Events
| Function | Event | Key Params |
|----------|-------|-----------|
| `trackSignup` | `signup` | method |
| `trackEmailCaptured` | `email_captured` | list_name, page |
| `trackFirstBet` | `first_bet` | variant, amount |
| `trackCertificationAchieved` | `certification_achieved` | cert_id, cert_name, score |
| `trackReferralSent` | `referral_sent` | method |

## Consent Banner Theming

The banner uses CSS custom properties. Set them on your `<body>`:

```tsx
<body style={{
  '--consent-bg': '#111111',           // Banner/modal background
  '--consent-text': '#f5f5f5',         // Text color
  '--consent-accent': '#c9a961',       // Gold/brand accent (buttons, links)
  '--consent-border': 'rgba(201,169,97,0.35)', // Border color
} as React.CSSProperties}>
```

## Privacy

- GA4 IP anonymisation is enabled by default (GA4 property setting) and asserted via `anonymize_ip: true` in the config
- DNT (`navigator.doNotTrack === '1'`) → auto-deny, no banner
- GPC (`navigator.globalPrivacyControl === true`) → auto-deny, no banner
- Cloudflare Web Analytics is cookieless and collects no personal data

## Scaling to 20+ sites

Each site needs:
1. `@pokerzeno/analytics` in `devDependencies` (file: protocol locally)
2. `AnalyticsProvider` + `ConsentBanner` in root layout
3. `NEXT_PUBLIC_GA4_MEASUREMENT_ID` env var
4. "Manage cookies" button in footer calling `useConsent().openBanner()`
5. Track key events for its domain (game, content, CTA, conversions)

Use **separate GA4 properties per site** so data is clean per property. A single GA4 account ("Prakash Ventures") can hold all properties.

In GA4, use **exploration reports** filtered by `app_name` to see cross-site behaviour in one view.
