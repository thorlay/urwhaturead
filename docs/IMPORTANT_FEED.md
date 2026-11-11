# Important Reading Feed

The reader's Important/All switch is independent of unread/favorite filters and
source-scoped AI briefings. All remains the default. Important is a navigation
list, not another generated report or a guarantee of complete news coverage.
Generating a briefing while viewing Important still loads ordinary candidates
from the current source/tag/search scope; it does not summarize only highlighted items.

- `GET /api/v1/feed?mode=important` reads persisted recommendations, with no AI
  or external HTTP calls on the request path. Existing source/tag/search filters apply.
- Recommendations come only from the `优先阅读` section of completed AI briefings,
  mapping `[Axx]` to the original ordered article IDs. A cited title without an
  explicit reason is not promoted. Truncated reports are ignored.
- Latest recommendations expire after 72 hours. Results contain at most 15
  articles and 3 per source, ordered by recommendation generation time. Disabled
  and normally hidden sources are excluded. There is no pagination in this view.
- `highlight_reason` provides the AI's stated reason, not a numeric importance score.
  No reason is fabricated from clicks or article popularity.
- Sources without recent qualifying briefings may be absent. The view states
  this limitation and offers the All switch; an empty view never silently falls
  back to ordinary articles.
- Migration 2 creates `article_highlights`. At startup, a bounded background
  backfill reads up to 200 reports from the last 72 hours. New manual and scheduled
  briefings save their recommendations automatically. Older backfill records
  cannot overwrite newer recommendations.
- Existing subscriptions, article data and briefing-generation controls are unchanged.

Tests cover citation ordering, section boundaries, source limits, filters, expiry,
mode switching, empty states, and desktop/mobile layout.
