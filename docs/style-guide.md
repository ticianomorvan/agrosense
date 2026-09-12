# AgroSense frontend implementation contract

Version 1 — 2026-09-12. Required for future UI work; the starter screen has not
been migrated. This specifies implementation, not a completed component system.

**Make the land visible and the next action clear.**

## 1. Authority

MUST means required. MUST NOT means prohibited. The interview established the
visual direction; the concrete defaults below implement the user's subsequent
request for strict guidelines. Apply them without reopening font, color, spacing,
or generic aesthetic choices.

[Product context](../PRODUCT.md) owns product facts. This guide owns visual
rules. An explicit user instruction overrides a conflicting rule; record that
specific exception. Generic skills, library defaults, and the starter screen
cannot override this contract. Do not broaden a task to retrofit unrelated UI.

Character: calm, credible, approachable, and agricultural.
[Landtoken](https://landtoken.io/) informs natural colors, farmland imagery, and
restrained controls. MUST NOT copy its marketing layout, logo, copy, or imagery
into the operational workspace.

## 2. Fixed tokens

Light theme only for this version; MUST NOT add a theme switch or automatic dark
mode. On the first UI implementation, define these custom properties once in
`apps/web/src/styles.css`. All authored UI colors MUST reference them; no local
hex values or near-identical alternate tokens. Third-party map imagery is exempt;
authored overlays are not. Do not add a CSS framework or UI kit for styling.

```css
:root {
  color-scheme: light;
  --color-canvas: #f4f3eb;
  --color-surface: #ffffff;
  --color-subtle: #e8ede7;
  --color-text: #173c2d;
  --color-muted: #4b6054;
  --color-brand: #245c3b;
  --color-brand-hover: #173c2d;
  --color-on-brand: #ffffff;
  --color-divider: #b9c7bc;
  --color-control-border: #728879;
  --color-focus: #235eaa;
  --color-ok: #245c3b;
  --color-ok-bg: #e9f2e8;
  --color-warning: #854600;
  --color-warning-bg: #fff3db;
  --color-critical: #a32d2d;
  --color-critical-bg: #fbeaea;
  --color-info: #285c8a;
  --color-info-bg: #eaf2f8;
  --color-unknown: #58635c;
  --color-unknown-bg: #eef0ed;
  --font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --radius-control: 0.25rem;
  --radius-panel: 0.5rem;
  --shadow-overlay: 0 0.25rem 1rem rgb(23 60 45 / 16%);
}
```

Use only these pairings (names omit `--color-`):

| Use | Foreground | Background |
| --- | --- | --- |
| Main/secondary text | `text` / `muted` | `canvas`, `surface`, or `subtle` |
| Primary action | `on-brand` | `brand`; `brand-hover` on hover/active |
| Selected item | `text`, with `brand` border and explicit selected state | `subtle` |
| Status | Matching `ok`, `warning`, `critical`, `info`, or `unknown` | Matching `*-bg` |
| Disabled control | `muted` | `subtle` |

MUST NOT reduce text opacity or use `divider` for text or essential control
boundaries. Inputs and outlined controls use `control-border`; dividers are
only decorative. Status always includes words. Green brand styling MUST NOT
imply a healthy field. Status roles do not define agronomic thresholds.

## 3. Type, spacing, and surfaces

MUST use `--font-ui`; no font downloads, display serif, or monospace branding.
Leave the browser root font size unchanged and use this type scale:

| Role | Size / line-height | Weight |
| --- | --- | --- |
| Page title | Desktop 2rem / 1.25; below 1024px 1.5rem / 1.3 | 600 |
| Section title | 1.25rem / 1.4 | 600 |
| Body, inputs, actions, field names | 1rem / 1.5 | 400; 600 for labels/actions |
| Metadata, table headings, status | 0.875rem / 1.5 | 400; 600 for headings/status |
| Key measurement, only when requested | 2rem / 1.25; unit at body size | 600 |

MUST NOT use text below 14px equivalent, all-caps headings, decorative letter
spacing, or workspace titles above 32px equivalent at the default root size.
Use one `h1` and sequential heading levels. Comparison numbers use tabular
numerals; units and timestamps stay visible. Field names wrap; never hide the
only field identifier behind truncation or hover.

Padding and gaps MUST use spacing tokens or zero. Borders are 1px; selection
borders, icon strokes, and focus outlines may be 2px. Controls use
`radius-control`; panels use `radius-panel`. No pill buttons or cards. Panels
use `surface`, a 1px divider, 16px padding, and no shadow. Only floating menus
and dialogs may use `shadow-overlay`. MUST NOT nest bordered cards.

## 4. Device layouts

These templates apply to the field overview. Other screens inherit the tokens
and priorities without acquiring unrequested maps or metrics. Pixel dimensions
below may be expressed as equivalent rem values, except breakpoint thresholds.

| Width | Required overview structure |
| --- | --- |
| 1024px and above | Header, page title/filters, then map `minmax(0, 1fr)` and priority/detail panel `20rem`, gap 24px. Outer padding 24px; max content width 1600px, centered. |
| 768–1023px | Single column, outer padding 24px. Priorities precede the map; details appear in the content flow. |
| Below 768px | Single column, outer padding 16px, gap 16px. Priorities lead; map is a user-selected alternate view. No compressed desktop sidebar. |

Desktop map MUST be the largest content region, minimum height 480px; allow
page scrolling. Selecting a field replaces the side panel with details and a
visible Back action, not a third column. Phone map minimum height is 320px and
includes an obvious way back to priorities. Preserve selection and filters.

Header minimum height: 64px desktop, 56px below 1024px. Let it grow with wrapped
content. MUST NOT lock the page to `100vh`, clip text to preserve dimensions,
or cause page-wide horizontal scrolling. At increased text size/zoom, reflow;
stack columns if they cannot fit rather than clipping or shrinking text.
Tables may scroll in a labeled region when comparisons need columns; core phone
actions and field identity MUST NOT require horizontal scrolling.

MUST NOT add KPI grids, welcome banners, a marketing hero, bottom navigation,
or extra routes unless requested. Phone actions stay in normal document flow;
no floating action bar by default.

## 5. Components

| Component | Required contract |
| --- | --- |
| Primary button | Brand fill, on-brand text, 16px horizontal/8px vertical padding, minimum 44px height and width. At most one primary action per task group. |
| Secondary button | Surface fill, text foreground, control border; subtle fill on hover/active. Same sizing as primary. |
| Link | Underlined with visible focus. Links navigate; buttons perform actions. |
| Input/select | Persistent visible label, surface fill, control border, 16px text, minimum 44px height. Error text adjacent and programmatically associated. Placeholder is not a label. |
| Field priority item | Field name → labeled status → reason → observation time/source → supported next action. Reason is visible without hover. Selection has visual and programmatic states. |
| Status label | Matching status pair, 14px text, 4px vertical/8px horizontal padding, control radius; status words always visible. |
| Table | Semantic headers; numbers right-aligned with units; body-size values, 12px vertical/16px horizontal padding; no decorative striping. |
| Dialog/menu, only if needed | Keyboard-operable, visible focus, Escape closes; dialogs trap focus and return it to the trigger. Do not implement a modal as only a styled `div`. |

Controls MUST implement default, hover, focus-visible, active, disabled, and
pending states where applicable. Focus uses a 2px `color-focus` outline with
2px offset on neutral surfaces. Map controls sit on an opaque surface. Disabled
controls retain readable text and explain unavailable actions when needed.
Pending writes prevent duplicate submission and keep a meaningful action label.

Use visible text labels by default. Necessary icons reuse the existing set;
if none exists, use simple inline SVG line icons, 20px with 2px stroke and
`currentColor`. No mixed styles, emoji controls, or icon dependencies for
ornament. Icon-only controls need an accessible name and 44px target. Decorative
SVGs are hidden from assistive technology. Text-link targets also meet 44px unless
embedded within a sentence; sentence links remain underlined and well separated.

## 6. Maps, data, and copy

- MUST provide a keyboard-accessible field list equivalent to the map's field
  identity, status, explanation, and actions. Hover cannot be the only access.
- Map layers expose legend, source, observation time, and relevant units.
  Selection uses an outline and an explicit label, not fill alone. Use an opaque
  label backing and contrasting outline casing over variable imagery.
- Critical status uses `critical`; attention uses `warning`; unavailable data
  uses `unknown`. Pair colors with labels/patterns. Scientific color scales need
  a task-specific specification; do not invent them or recolor source imagery.
- Missing data MUST read as unavailable, never zero, healthy, or current. Label
  stale observations when the data contract identifies them; show observation
  time. Never invent freshness limits, priority logic, or recommendations.
- Use actual data and supported actions. Demonstrations MUST be visibly labeled.
  Do not fabricate advice, confidence scores, yields, trends, or testimonials.
- Use sentence case and concrete labels: “View field,” not “Learn more.” Follow
  the requested language; otherwise retain current English consistently. Do not
  silently select a target market or mix languages.
- Real farmland imagery provides useful context. No body text over photographs,
  decorative textures, or photograph substituted for a functioning map. Use
  project-provided or appropriately licensed assets; never imply a stock image
  depicts a user's actual field.

## 7. Data states and motion

Each data-driven region MUST implement the states reachable by the feature:

| State | Required presentation |
| --- | --- |
| Loading | Stable reserved region plus readable loading status; no fake values. |
| Empty | Distinguish no fields from no filter matches; offer only supported recovery. |
| Error | Explain what failed; Retry if supported. Preserve entered data. |
| Partial | Keep valid results and identify missing information. |
| Stale | Retain observation time and label freshness; never imply live data. |
| Success | Show the resulting state; a toast cannot be the only persistent evidence. |

Only 150ms `ease-out` transitions for color, border-color, and opacity. MUST NOT
use entrance choreography, bounce, pulsing alerts, parallax, animated counters,
hover scaling, gradients, glow, glass effects, or `transition: all`. Reduced
motion disables transitions and makes map camera changes instant. Keep map
interaction usable; no decorative camera movements.

## 8. Acceptance checklist

Every UI task MUST report evidence for applicable checks below. N/A requires a
reason. Unperformed checks remain unverified; a build is not browser evidence.

- [ ] Tokens, type scale, spacing, and component rules match this guide.
- [ ] No prohibited decoration or unrequested features were introduced.
- [ ] Browser screenshots inspected at 1440×900, 1024×768, 768×1024, 390×844,
  and 320×568; report saved paths.
- [ ] Desktop overview is map-led; phone prioritizes actions before its optional
  map. The first priority's identity, reason, and action are easy to find.
- [ ] No clipped text or page-wide overflow, including at 200% zoom and with long
  field names; controls stay reachable.
- [ ] Tab/Shift+Tab/Enter/Space and Escape where applicable work. Focus is visible,
  logical, and unobscured; equivalent map information is accessible in the list.
- [ ] Text contrast is at least 4.5:1; essential control/state graphics at least
  3:1 against adjacent backgrounds. Status is understandable without color.
- [ ] Applicable loading, empty, error, partial, stale, disabled, and pending
  states were exercised; no fake success or fabricated information appears.
- [ ] Reduced-motion behavior works; controls have 44×44px minimum targets.
- [ ] `pnpm check` passes; changed UI works without new browser console errors.
  Report any failed or unavailable checks accurately.

The text threshold follows [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html);
this project also requires 4.5:1 for large text. Graphical contrast follows
[WCAG non-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
The 44px target is a project rule, with the inline-link exception above. This
checklist alone does not establish complete WCAG conformance.

## 9. Remaining product decisions

Market/language, data sources, priority logic, recommendations, available actions,
and offline behavior require product requirements. Use honest unavailable states;
ask only when a missing fact blocks requested behavior. Visual defaults are
settled for this version and MUST NOT be reinterpreted independently.

Impeccable remains the selected design workflow; its local installation was not
located during the interview. This contract is self-contained: no installation,
new interview, image generation, or concept-selection round is required.
