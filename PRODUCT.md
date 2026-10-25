# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

An open community: anyone can sign in with Google, claim a username, and keep their own shelf. Visitors without an account can open any shelf by link (`?u=<username>`) or find people through the user search. The default landing shelf is `@antonio`.

## Product Purpose

A virtual bookshelf for books you have read, grouped by series. The core job is curating your own collection: adding books, rating them, writing notes and blurbs, recording read dates and page counts, and organising series and categories. Sharing and browsing other people's shelves are secondary to that upkeep. Success means maintaining the shelf feels quick and satisfying enough that people keep it up to date.

## Positioning

Not a reading tracker with lists and progress bars: books live as spines on shelves, one shelf per series, so a collection reads like a physical bookcase you tend.

## Operating Context

- Owners edit inline: rating stars, read date, page count, blurb and notes save on change; title/author via an edit mode; series rename and category assignment via the series label.
- Adding a book: title, author, optional page count and blurb, optional series (existing series reuse their categories), categories.
- Visitors see a read-only view with a banner naming whose shelf it is, plus a share action (native share or copied link).
- Navigation aids: in-shelf search by series or title, category filter, a table of contents of series with scroll-spy.
- Used on desktop and phones.

## Capabilities and Constraints

- Static HTML/CSS/vanilla JS served as files (`index.html`, `css/style.css`, `js/script.js`), Supabase for auth (Google OAuth), data, and row-level security. No build step.
- Data model: profiles (username, display name, avatar, created_at), shelves (label, is_series), books (title, author, series_order, rating 0–5, notes, summary, date_read, page_count), categories, shelf_categories.
- UI copy is German.
- `buecherregal.html` is a legacy standalone prototype, not part of the live app.

## Brand Commitments

- The shelf metaphor stays: books appear as spines standing on shelves. The current dark wood-and-brass rendering of it is not binding.
- The name "Bücherregal" and German language are current but not declared binding.

## Evidence on Hand

- Real shelf data in Supabase (e.g. `@antonio`: Dungeon Crawler Carl, Fourth Wing, Red Rising and more).
- Favicons in `img/`. No logo, photography, testimonials, or user counts exist; do not invent them.

## Product Principles

1. Upkeep first: every edit is one gesture away and saves without ceremony.
2. The collection is the interface; chrome stays out of the way of the spines.
3. Series are the unit of organisation; a standalone book is a series of one.
4. Visitors and owners see the same shelf; only the edit affordances differ.
