# AgroSense frontend implementation contract

Required for all frontend work.

**Make the land visible and the next action clear.**

## 1. Component and styling foundation

MUST means required. MUST NOT means prohibited.
[Product context](../PRODUCT.md) owns product facts; this guide owns visual and
interaction rules. Implement only the requested slice. A component or pattern in
this guide is not authorization to add features, routes, data, or agronomic logic.

MUST use **shadcn/ui with its stock `base-nova` style and neutral palette**.
[components.json](../apps/web/components.json) defines the component configuration;
[styles.css](../apps/web/src/styles.css) contains the generated tokens and app
layout rules. Use Tailwind v4 through the Vite integration.

- Add required primitives through the official shadcn CLI. Use the existing
  Button, Badge, NativeSelect and Input before adding more components.
- Preserve the generated palette, font, radii, variants, borders, shadows and
  interaction styling. MUST NOT introduce a custom AgroSense theme, brand-color
  substitutions, a parallel primitive library, or another UI kit.
- Compose application behavior around the primitives. Keep business rules and
  data-source assumptions out of generated component files.
- Caller-side classes may adjust layout, width, minimum target size, readable text
  size and wrapping. They MUST NOT recolor or restyle the primitives.
- Use the existing semantic CSS variables for app-authored surfaces and map
  overlays. MUST NOT introduce raw colors or duplicate theme tokens. Source
  imagery is exempt; authored overlays are not.
- Keep the app in light mode. MUST NOT add a theme switch or automatic dark mode.

Use these semantic roles:

| Use | Tokens or component variant |
| --- | --- |
| Main content | `foreground` on `background` or `card` |
| Secondary text | `muted-foreground` on `background` or `card` |
| Primary action | Button `default` |
| Secondary action | Button `outline` or `secondary` |
| Informational status | Badge `secondary` |
| High or critical risk | Badge `destructive`, with an explicit risk label |
| Moderate risk | Badge `secondary`, with an explicit risk label |
| Low or unavailable risk | Badge `outline`, with distinct explicit labels |
| Panel | `card`, `border`, `radius-lg` |
| Map selection | `primary` outline, contrasting casing and a visible selected label |

Status words MUST carry the meaning independently of color. Component variants
MUST NOT define agronomic thresholds or imply that a field is healthy.

## 2. Type, spacing, and surfaces

Use the preset's bundled Geist font through `font-sans`. MUST NOT add display
fonts, external font downloads, decorative letter spacing or all-caps headings.
Leave the browser root font size unchanged.

| Role | Size / line-height | Weight |
| --- | --- | --- |
| Page title | Desktop 2rem / 1.25; below 1024px 1.5rem / 1.3 | 600 |
| Section title | 1.25rem / 1.4 | 600 |
| Body and field names | 1rem / 1.5 | 400; 600 for names/headings |
| Metadata and status | 0.875rem / 1.5 | 400; 600 for headings |
| Controls | Stock shadcn typography, at least 14px equivalent | Stock weight |
| Key measurement, only when requested | 2rem / 1.25; unit at body size | 600 |

Status badges MUST use readable text and wrap when necessary. MUST NOT hide the
only field identifier behind truncation or hover. Use one `h1` and sequential
heading levels. Comparison numbers use tabular numerals; units and timestamps
stay visible. Workspace titles MUST NOT exceed 32px at the default root size.

App layout padding and gaps use the existing spacing scale: 4, 8, 12, 16, 24, 32,
48 and 64px, expressed through spacing variables or equivalent Tailwind utilities.
Zero is also allowed. Preserve the primitives' own internal spacing.

App panels use `card`, a 1px `border`, `radius-lg`, 16px padding and no shadow.
MUST NOT nest bordered panels. Use shadcn defaults for component surfaces rather
than adding panel rules to every control. Do not add decorative cards or shadows.

## 3. Device layouts

These templates apply to the field overview. Other screens inherit the component
foundation and priorities without acquiring unrequested maps or metrics. Pixel
sizes below may be expressed as equivalent rem values, except breakpoints.

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

## 4. Component behavior

| Component | Required contract |
| --- | --- |
| Button | Use the stock shadcn Button. At most one primary action per task group. Minimum 44px height and width. Buttons perform actions. |
| Link | Links navigate. Underlined with visible focus; at least a 44px target unless embedded within a sentence. |
| Input/select | Use shadcn Input or NativeSelect for native controls. Persistent visible label, minimum 44px height. Errors are adjacent and programmatically associated. Placeholder is not a label. |
| Field priority item | Field name → labeled status → reason → observation time/source → supported next action. Reason is visible without hover. |
| Status | Use Badge with the semantic variant above and explicit words. Preserve observation time and freshness context. |
| Table | Semantic headers; numbers right-aligned with units. Place wide comparisons in a labeled scroll region. |
| Dialog/menu, only if needed | Use the appropriate shadcn component. Keyboard-operable, visible focus, Escape closes; dialogs trap focus and return it to the trigger. |

Preserve stock hover, focus-visible, active and disabled states. Focus MUST remain
visible, logical and unobscured. App CSS MUST NOT suppress the primitives' focus
rings. Map controls sit on an opaque surface. Explain unavailable actions when
needed. Pending writes disable duplicate submission, retain a meaningful action
label and expose `aria-busy`.

View actions use ordinary buttons. Use toggle state only for a persistent setting
with a stable accessible label. Selection MUST have a visible and programmatic
representation wherever a selected item remains on screen.

Use visible text labels by default. Necessary icons use the configured Lucide
library and the component's stock sizing. MUST NOT add mixed icon sets, emoji
controls or ornamental icons. Icon-only controls need an accessible name and a
44px target. Decorative SVGs are hidden from assistive technology.

## 5. Maps, data, and copy

- MUST provide a keyboard-accessible field list equivalent to the map's field
  identity, status, explanation and actions. Hover cannot be the only access.
- Map layers expose legend, source, observation time and relevant units.
  Selection uses an outline and an explicit label, not fill alone. Use an opaque
  label backing and contrasting outline casing over variable imagery.
- Place third-party map CSS in a lower cascade layer so app label wrapping and
  semantic map styles remain effective. Keep map camera changes instant.
- Scientific color scales require a task-specific specification. MUST NOT invent
  them, recolor source imagery or infer crop health from image color.
- Missing data MUST read as unavailable, never zero, healthy or current. Label
  stale observations when the data contract identifies them and show their time.
  Never invent freshness limits, priority logic or recommendations.
- Use actual data and supported actions. Demonstrations MUST be visibly labeled
  for the data they describe. Monitoring mode does not establish whether field
  boundaries or satellite imagery are synthetic. Failed requests MUST NOT silently
  substitute fixtures. Keep test fixtures outside the runtime application.
- Use sentence case and concrete labels: “View field,” not “Learn more.” Follow
  the requested language; otherwise retain current English consistently.
- Real farmland imagery provides useful context. No body text over photographs,
  decorative textures or photograph substituted for a functioning map. Use
  project-provided or appropriately licensed assets; never imply a stock image
  depicts a user's actual field.
- MUST NOT fabricate advice, confidence scores, yields, trends or testimonials.

## 6. Data states and motion

Each data-driven region MUST implement the states reachable by the feature:

| State | Required presentation |
| --- | --- |
| Loading | Stable reserved region plus readable loading status; no fake values. |
| Empty | Distinguish no fields from no filter matches; offer only supported recovery. |
| Error | Explain what failed; Retry if supported. Preserve entered data. |
| Partial | Keep valid results and identify missing information. |
| Stale | Retain observation time and label freshness; never imply live data. |
| Success | Show the resulting state; a toast cannot be the only persistent evidence. |

Preserve stock shadcn interaction transitions. MUST NOT add entrance choreography,
bounce, pulsing alerts, parallax, animated counters, gradients, glow or glass
effects. Respect reduced motion by disabling transitions, animations and button
movement. Reduced-motion rules MUST take precedence over component utilities.

## 7. Acceptance checklist

Every UI task MUST report evidence for applicable checks below. N/A requires a
reason. Unperformed checks remain unverified; a build is not browser evidence.

- [ ] Controls use the configured shadcn primitives and stock neutral styling;
  no custom theme or competing primitive library was introduced.
- [ ] App typography, spacing, surfaces and component behavior match this guide.
- [ ] No prohibited decoration or unrequested features were introduced.
- [ ] Browser screenshots inspected at 1440×900, 1024×768, 768×1024, 390×844,
  and 320×568; report saved paths.
- [ ] Desktop overview is map-led; phone priorities precede its optional map.
  The first priority's identity, reason and action are easy to find.
- [ ] No clipped text or page-wide overflow, including at 200% zoom and with long
  field names; controls stay reachable.
- [ ] Tab/Shift+Tab/Enter/Space and Escape where applicable work. Focus is visible,
  logical and unobscured; equivalent map information is accessible in the list.
- [ ] App-authored text meets 4.5:1 contrast and essential map/state graphics
  meet 3:1. Measure component text, borders and focus indicators; report any
  limitations in the stock styling without claiming blanket compliance.
- [ ] Status is understandable without color. Applicable loading, empty, error,
  partial, stale, disabled and pending states were exercised.
- [ ] Reduced-motion behavior works; controls have 44×44px minimum targets.
- [ ] `pnpm check` passes; changed UI works without new browser console errors.
  Report any failed or unavailable checks accurately.

Contrast checks follow [WCAG text guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
and [non-text guidance](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
Stock components do not by themselves establish WCAG conformance. Keep measured
limitations explicit; do not create an ad hoc theme to conceal them.

Missing product facts belong in the [product context](../PRODUCT.md) and
[domain model](domain-model.md). Use honest unavailable states and ask only when a
missing fact blocks the requested behavior.
