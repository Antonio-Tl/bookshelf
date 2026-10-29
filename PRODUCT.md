# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

An open community: anyone can sign in with Google, claim a username, and keep their own shelf. Visitors without an account can open any shelf by link (`?u=<username>`) or find public profiles through the user search. Profiles are public by default; a private profile is left out of the search and the overview but still opens by link. The overview (`?view=regale`) only lists public profiles that opted in, plus three demo shelves (`@lenamarie`, `@jonas_kr`, `@sophie_liest`). The default landing shelf is `@antonio`.

## Product Purpose

A virtual bookshelf for books you have read, grouped by series. The core job is curating your own collection: adding books, rating them, writing notes and blurbs, recording read dates and page counts, and organising series and categories. Sharing and browsing other people's shelves are secondary to that upkeep. Success means maintaining the shelf feels quick and satisfying enough that people keep it up to date.

## Positioning

Not a reading tracker with lists and progress bars: books live as spines on shelves, one shelf per series, so a collection reads like a physical bookcase you tend.

## Operating Context

- Owners edit inline: rating stars, read date and notes save on change; title, author, page count and blurb via the edit mode (pencil); series rename and category assignment via the series label.
- Signed-in readers can follow other shelves. Followed shelves are listed under the bell next to the theme button, which also shows a notification when a followed account adds a book and rates it (per-follow toggle, on by default).
- Adding a book: title, author, optional page count and blurb, optional series (existing series reuse their categories), categories.
- Visitors see a read-only view with a banner naming whose shelf it is, plus a share action (native share or copied link).
- Navigation aids: in-shelf search by series or title, category filter, a table of contents of series with scroll-spy.
- Used on desktop and phones.

## Capabilities and Constraints

- Static HTML/CSS/vanilla JS served as files (`index.html`, `css/style.css`, `js/*.js`, six classic scripts in a fixed order), Supabase for auth (Google OAuth or an email magic link), data, and row-level security. No build step.
- Data model: profiles (username, display name, avatar, created_at, is_private, listed), shelves (label, is_series, is_private), books (title, author, series_order, rating 0–5, notes, summary, date_read, page_count, is_private), categories, shelf_categories, follows (follower, followee, notify), notifications (created by a trigger on the first rating of a book), showcases (premium Vitrine: a series with up to three chosen volumes, or up to three single books). Private series and books are only ever returned to their owner.
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
