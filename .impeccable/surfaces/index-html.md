---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: ["css/style.css","js/script.js"]
---

# Shelf page (index.html)

Scope: the single app page — shelf view, cover grid view, book detail drawer, add/category/series modals, auth chrome. Mode: Operate (core job is curating one's collection; visitors browse read-only).

Audience/job: open community of genre-fiction readers keeping their read books up to date; visitors open shared shelves by link.

Constraints: static HTML/CSS/JS + Supabase, no build step; German copy; shelf metaphor (spines on shelves) is a brand commitment. Covers come from Open Library at runtime (no cover column in the DB); books without a match get a generated typographic cover.

## Direction contract

THESIS: A contemporary design-bookshop wall: real books stand spine-out on black steel ledges, each spine generated from its real cover, and one click turns the book face-out. Refuses both the flat list tracker and the wood-and-brass library.

OWN-WORLD: Gallery-wall ground #efeeeb, ink #141414, matte steel ledges #1b1b1b, one signal red #d23a24 for primary actions, selection and stars. Geist throughout, tight negative tracking on display sizes, tabular numerals for counts. Covers are the only rich colour; spines take their colour and blurred artwork from the cover. White cards with soft long shadows for drawer and modals.

STORY: The visitor recognises the collection by its covers at a glance, opens any book to read rating, date and notes; the owner adds a book and watches its spine appear with its own cover, rates and annotates in place.

FIRST VIEWPORT: Top bar (menu, brand, people search, share, account/login). Header: shelf owner name at 44px, @handle and member-since, stats (books, series, average rating) right. Toolbar: shelf search, category chips, Regal/Cover segmented toggle, owner's red "+ Buch". Below, full-width ledges, one per series, headed by series name, author and volume count. Detail opens as a right drawer (bottom sheet on phones).

FORM: Safer-register round, grounded candidate "Galerie-Leisten" (1st of 2) fused with the canon card (cover grid as the second view), at the user's request. Signature move: the 3D spine-to-cover turn. seed:f13f7207c9ac735a

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Cover matches are fuzzy (title+author search); owners cannot yet pick or override a cover.
- German editions often have no Open Library cover and fall back to the generated cover.
