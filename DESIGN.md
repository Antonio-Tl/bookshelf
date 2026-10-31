---
name: Bücherregal
description: A design-bookshop wall where real books stand spine-out on black steel ledges and turn face-out on click.
colors:
  wall: "#efeeeb"
  wall-deep: "#e6e4df"
  surface: "#ffffff"
  surface-soft: "#f6f5f2"
  ink: "#141414"
  ink-soft: "#3a3936"
  dim: "#5e5c58"
  line: "#dcdad5"
  line-soft: "#ebe9e5"
  steel: "#1b1b1b"
  signal-red: "#d23a24"
  signal-red-deep: "#bb2f1b"
typography:
  display:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(34px, 5vw, 48px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  numeral:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  title:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  control:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "-0.005em"
  label:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  spine:
    fontFamily: "Geist, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12.5px"
    fontWeight: 650
    lineHeight: 1.1
    letterSpacing: "0.03em"
rounded:
  control: "12px"
  card: "18px"
  sheet: "22px"
  pill: "999px"
spacing:
  chip-gap: "6px"
  control-gap: "10px"
  row: "12px"
  block: "22px"
  gutter: "28px"
  gutter-phone: "16px"
  series-row: "60px"
  series-column: "72px"
components:
  button-primary:
    backgroundColor: "{colors.signal-red}"
    textColor: "{colors.surface}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.signal-red-deep}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-soft}"
  button-ghost:
    textColor: "{colors.ink-soft}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  icon-button:
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.control}"
    size: "40px"
  filter-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 13px"
    height: "32px"
  filter-pill-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
  segmented-toggle:
    backgroundColor: "{colors.wall-deep}"
    rounded: "{rounded.control}"
    padding: "3px"
  segmented-option-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    height: "32px"
    padding: "0 14px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
    height: "42px"
  category-tag:
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "22px"
  modal:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.sheet}"
    padding: "28px"
    width: "480px"
  detail-drawer:
    backgroundColor: "{colors.surface}"
    width: "420px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
---

# Design System: Bücherregal

## Overview

**Creative North Star: "The Gallery Wall"**

A contemporary design-bookshop wall, not a library and not a tracker. A pale, warm-grey gallery ground carries full-width black steel ledges; real books stand spine-out on them, every spine dressed in colours and a small art crop lifted from that book's own cover, and one click turns a volume face-out in 3D. The chrome is quiet, neutral and set entirely in Geist; the covers are the only rich colour on the page, so the collection itself is the interface.

Density is calm but not sparse: series sit side by side on their own ledges (wrapping on wide screens, one per row on phones), headed by a bold series title with author and volume count. Book detail lives in a white panel with a soft long shadow, beside the shelf on large screens and as a bottom sheet on phones. One signal red marks the primary action, the current selection and filled stars, and nothing else.

The world rejects both the flat list tracker and the wood-and-brass library rendering of the shelf metaphor.

**Key Characteristics:**
- Gallery-wall neutral ground, ink text, matte black steel ledges.
- Covers carry all saturated colour; spines are computed from covers at runtime.
- One signal red, reserved for primary action, selection and stars.
- Geist everywhere, heavy weights with tight negative tracking on display sizes, tabular numerals for counts.
- One signature motion: the CSS 3D spine-to-cover turn.
- White cards and drawers lifted by soft, long, ink-tinted shadows.

## Colors

A warm-neutral gallery palette of paper greys and near-black ink, punctuated by a single signal red; all other colour comes from the books.

### Primary
- **Signal Red** (signal-red): the primary action button ("+ Buch", modal confirms), filled rating stars, the selected cover tile's outline, the focus outline and field focus border, the text caret, and the text-selection tint (at 20% alpha). Its soft 10% tint backs destructive hovers.
- **Deep Signal Red** (signal-red-deep): hover state of the primary button and text colour of destructive hovers.

### Neutral
- **Gallery Wall** (wall): page ground, under a faint lighter radial wash at the top of the viewport; also the translucent sticky top bar (86% alpha with blur) and the active table-of-contents row.
- **Deep Wall** (wall-deep): the segmented toggle's track and avatar placeholders.
- **Card White** (surface): drawer, modals, popovers, inputs, secondary buttons and inactive filter pills.
- **Soft Card** (surface-soft): hover fill inside white surfaces, notes blocks, category chips.
- **Ink** (ink): primary text, the active filter pill fill, toast background, brand-mark bars.
- **Soft Ink** (ink-soft): secondary text, icon buttons, ghost buttons, field labels.
- **Dim** (dim): metadata, row labels, placeholders in search, stat labels.
- **Line** (line): control borders, top-bar and toolbar dividers.
- **Soft Line** (line-soft): row dividers inside the detail drawer, popover borders.
- **Steel** (steel): the ledge material; the ledge itself is rendered as a short vertical gradient from a lit top edge (#555) through #1d1d1d to #0e0e0e with bevelled end caps.

### Runtime-derived colour (not tokens)
These are computed per book in the browser and must never be authored as fixed values:
- **Spine ground**: the most frequent border colour of the book's Open Library cover (canvas sample at 40×60, colours bucketed).
- **Spine lettering**: the most frequent cover colour reaching at least 4.5:1 contrast against the ground; if none does, near-white (250,250,250) or near-black (20,20,20), whichever contrasts more.
- **Cover tint**: a saturation-weighted average of the cover, used as the cover's background fallback and to tint the detail drawer's hero.
- **Spine emblem**: a square crop of the cover's art window, searched outside the top and bottom title bands and rejected where hard-edge density is high (lettering); omitted when no window scores high enough.
- **Coverless volumes** borrow ground, lettering and emblem from the first covered volume of the same series; with no donor at all, a ground is picked by hash from a fixed set of eight deep, muted fallback colours in the script, with lettering chosen by lightness.
- **Cover choice**: per edition, preferring English or German editions (German when the title looks German) and exact title matches; product photos (white corners without a continuous white border) are skipped in favour of flat covers.

### Named Rules
**The Covers-Carry-Colour Rule.** Chrome stays in the wall, ink, line and steel neutrals plus one red. Every other saturated colour on screen comes from a book cover or is computed from one.

**The One Red Rule.** Signal red marks the primary action, the current selection, focus and filled stars. Active filters use ink, not red; red never fills a large area or decorates.

**The Derived Spine Rule.** Spine ground, lettering and emblem are computed from the cover at runtime. A spine colour is never hand-picked.

## Typography

**Display Font:** Geist (with system-ui, -apple-system, Segoe UI, sans-serif)
**Body Font:** Geist (same stack)

**Character:** One grotesque family across every role, from 800-weight tightly tracked headings to quiet 400-weight body, so the hierarchy comes from weight and tracking alone and never competes with the covers. Weights 400–800 are loaded from Google Fonts.

### Hierarchy
- **Display** (800, clamp(34px, 5vw, 48px), 1.0, -0.04em, balanced wrap): the shelf owner's name in the page header. Only one per page.
- **Headline** (800, 26px, 1.12, -0.035em): the book title in the detail drawer; modal titles use the same voice at 24px.
- **Numeral** (700, 26px, 1.1, -0.03em, tabular): header stats (books, series, average rating); 22px on phones.
- **Title** (700, 19px, -0.025em): series name heading each ledge.
- **Body** (400, 15px, 1.45): running text; blurbs at 1.55 line-height capped at 62ch.
- **Control** (600, 14px, -0.005em): buttons, search, menu items.
- **Label** (600, 13px): row labels, field labels, filter pills, segmented options; 12px for stat labels and category tags.
- **Spine** (650, 12.5px, 1.1, +0.03em, vertical writing): spine titles, shrunk in 0.5px steps down to 9px until they fit the spine; volume numbers at 10.5px tabular, set under a hairline rule.

### Named Rules
**The Tight Display Rule.** The larger the type, the heavier and tighter it sets: display at -0.04em, headlines at -0.035em, titles at -0.025em; body text is never negatively tracked.

**The Tabular Count Rule.** Every count, rating and volume number uses tabular numerals.

## Layout

A single centered column (max 1320px) with a 28px gutter (16px on phones), under a 64px sticky top bar. The page reads top-down: header (owner name left, stats right), a toolbar bounded by a hairline (shelf search, the Regal/Cover segmented toggle and the owner's actions on the first row; the filters on their own second row: a reading-status segmented toggle, a Kategorie menu button and, while filtered, a dim "n von m Büchern · Zurücksetzen" summary at the right), then the series. Nothing in the toolbar scrolls sideways.

In Regal view, series flow as wrapping blocks sized to their books (60px row gap, 72px column gap); each ledge scrolls horizontally without a visible scrollbar. In Cover view, every series spans the full width and holds an auto-fill grid of 2:3 covers (min 132px, 26px × 22px gaps; 100px and 20px × 14px on phones). The chosen view persists locally.

Spines are sized from the book: width from page count (24–64px; hashed 26–39px when unknown), height 90–99% of the 210px ledge height (172px and 0.86 width scale on phones). The face-out cover takes the cover's real aspect ratio.

Responsive behaviour: at ≤900px the toolbar reflows (search and actions first, filters last). At ≤640px the brand name, button labels and stat spacing compress, the people search collapses to a 40px icon that expands to 170px, ledges bleed to the screen edge and category tags on the shelf hide. At ≥1024px the detail drawer sits beside the shelf: no scrim, the page gains right padding of the drawer width so the turned book stays visible, and the drawer starts below the top bar.

## Elevation & Depth

Depth is physical and soft. Books stand on ledges with a small blurred contact shadow; the ledge casts a short and a long drop shadow onto the wall; cards, drawers and popovers float on long, negatively spread, ink-tinted (rgba(20,20,20)) shadows. Book faces get inset highlights and a hinge shading on the cover's left edge. Everything else (top bar, toolbar, chips, inputs) is flat, separated by hairlines.

### Shadow Vocabulary
- **Pop** (`box-shadow: 0 18px 40px -16px rgba(20,20,20,0.28), 0 2px 6px rgba(20,20,20,0.06)`): popovers (people search results, profile panel) and the toast.
- **Card** (`box-shadow: 0 30px 70px -28px rgba(20,20,20,0.4)`): modals.
- **Drawer** (`box-shadow: -20px 0 60px -20px rgba(20,20,20,0.35)`): detail drawer over a scrim; beside the shelf at ≥1024px it becomes a 1px line plus `-30px 0 60px -40px`.
- **Ledge** (`box-shadow: 0 4px 6px -2px rgba(20,20,20,0.3), 0 22px 26px -14px rgba(20,20,20,0.45)`): under each steel ledge.
- **Lifted cover** (`box-shadow: 18px 22px 30px -14px rgba(20,20,20,0.55)`): the face-out cover after the turn; tiles use `0 12px 20px -12px` at rest and deepen on hover.

### Named Rules
**The Soft Long Shadow Rule.** Shadows are long, soft, negatively spread and ink-tinted. No hard offset shadows, no coloured glows.

## Shapes

Gently rounded controls (12px) and cards (18px; modals and the phone sheet 22px), full pills for filters, tags, chips and the user chip, circles for avatars. Books keep almost square corners (spine 2px top / 1px bottom; covers 1–4px, tighter on the hinge side than the fore-edge), because they are objects, not UI. The brand mark is three bars, the last one leaning, echoing books on a ledge.

## Components

### Buttons
Compact, confident, 40px tall.
- **Shape:** gently rounded (12px).
- **Primary:** signal red with white 14px/600 text, 16px side padding, a faint inner top highlight and a small ink drop shadow. Hover deepens the red; disabled at 50% opacity.
- **Secondary:** white with a line border; hover darkens the border to #c4c1bb and fills soft card.
- **Ghost:** transparent soft-ink text, 5% ink fill on hover. The destructive variant ("Aus dem Regal entfernen") is a ghost button that turns soft-red with deep-red text on hover.
- **Press:** all buttons scale to 0.97 on active.
- **Icon buttons:** 40px square (32px small), 20px stroke SVG icons, 6% ink fill on hover.

### Chips
- **Filter pills:** 32px pills, white with line border and soft-ink 13px/600 text; active is an ink fill with white text. The same style serves the category toggles in modals and the admin filters.
- **Status filter:** the segmented toggle (Alle / Gelesen / Lese gerade / Merkliste) with dim tabular counts; on phones it spans the full width below the view toggle, and the counts drop when the four options would not fit in one line.
- **Category filter:** a 40px white menu button ("Kategorie" with a chevron) opening a 260px popover of categories with counts; the chosen one is set bold with a check. Active, the button turns ink and shows the category name plus a clear ×. Counts in both filters are faceted: each counts under the other filter.
- **Category management:** not in the shelf view; owners set categories in the book detail drawer and in the series dialog, both as toggle chips. In the drawer they sit in a collapsible row ("Kategorien" with the assigned names in one ellipsized line and a chevron) that is closed by default and stays open across re-renders. A dashed "+ Neue Kategorie" chip turns into a pill-shaped field that creates the category and assigns it at once. A category no series uses carries a 24px round × inside its chip that turns soft red and deletes it; used categories are deleted by unassigning them first.
- **Category tags:** 22px pills in a 5% ink tint, 12px/600, beneath series titles.
- **Category chips (editable):** soft card pills with a 24px circular remove button that turns soft red on hover.

### Segmented Toggle (Regal / Cover)
A deep-wall track (3px padding, 12px radius, line border) holding two 32px options; the pressed option becomes a white raised tab with ink text.

### Inputs / Fields
- **Style:** white, line border, 12px radius, 42px minimum height, 15px text; search fields 40px with a leading 16px icon and a clear button.
- **Focus:** border turns signal red with a 3px 28%-alpha red ring.
- **Labels:** 13px/600 soft ink above the field; hints 13px dim below.

### Detail Drawer
A white 420px panel opened from the right (bottom sheet up to 88vh with 22px top corners on phones). A 280px hero tinted from the cover colour holds the cover (150px wide), which rises in with a slight rotation; below, the headline title, dim author line and hairline-divided rows (112px label column) for rating, date and pages, then blurb and notes blocks. Over a 28% ink scrim below 1024px; beside the shelf without scrim at ≥1024px.

### Modals
White cards, max 480px, 28px padding, 22px radius, card shadow, over a 36% ink scrim; they rise in over 0.38s. On phones they anchor to the bottom edge.

### Navigation
Sticky translucent wall top bar with a hairline: menu icon (opens a 290px left table-of-contents panel of series with counts and scroll-spy), brand, people search, share, and the account pill or Google sign-in. Popovers drop from the top right with a short pop-in.

### Book (signature component)
A button containing a 3D book: a spine face and a front face at 90°. Spine is shaded as a rounded hardcover back (light from the left, darker hinges) with one hairline rule near head and foot in the lettering colour; it shows the optional emblem at the top (framed by the same hairline), the vertical title, and the volume number at the foot (series only). Exactly one volume per series stands face-out: the series' first volume by default, or the last selected volume of that series. Selecting a book turns it: the slot widens to cover width (0.6s) while the book rotates -90° about its spine (0.7s), both on the shared ease-out curve; resting spines lift 6px on hover. Coverless books get a generated typographic cover (800-weight title, author and volume) on their derived colour.

### Cover Tile
In Cover view: 2:3 cover with hinge shading and a drop shadow, then title (14px/600), volume or author (13px dim) and 11px red stars. Hover lifts 4px; the selected tile carries a 3px signal-red outline offset 3px.

### Toast
Ink pill-rectangle (12px radius), white 14px/500 text, bottom-centred, sliding up 10px.

### Named Rules
**The One Turn Rule.** The 3D spine-to-cover turn is the only signature motion. Everything else is a short ease-out (cubic-bezier(0.22, 1, 0.36, 1)) entrance or a 0.15s state change, and all motion collapses under reduced-motion.

**The One Face-Out Rule.** Each series shows exactly one cover; every other volume stays spine-out.

## Do's and Don'ts

### Do:
- **Do** derive every spine's ground, lettering and emblem from its cover at runtime, and let coverless volumes borrow from the series' first covered volume.
- **Do** keep chrome in the neutral tokens and reserve signal red for the primary action, selection, focus and stars.
- **Do** stand books on black steel ledges with soft contact and ledge shadows.
- **Do** set display sizes in Geist 800 with negative tracking, and counts in tabular numerals.
- **Do** lift white cards, drawers and popovers with the soft long shadows listed above.
- **Do** keep detail beside the shelf without a scrim at ≥1024px, and as a bottom sheet with a scrim on phones.

### Don't:
- **Don't** hand-pick spine colours or introduce chrome colours that compete with covers.
- **Don't** use red for active filters, decoration or large fills; active filters are ink.
- **Don't** render the shelf as wood and brass, or flatten it into a list tracker.
- **Don't** add a second signature motion beside the spine-to-cover turn.
- **Don't** use hard offset shadows or coloured glows.
- **Don't** show more than one face-out cover per series.
