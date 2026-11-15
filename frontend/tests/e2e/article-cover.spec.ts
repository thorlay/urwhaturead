import { expect, test, type Page } from '@playwright/test'

const now = new Date().toISOString()
const cover = 'https://example.com/cover.png'
const article = {
  id: 101, source_id: 1, source_name: 'Cover test source', title: 'Cover test article',
  link: 'https://example.com/article', image_url: cover, summary: 'Article preview',
  content: 'Text-only article body.', published_at: now, created_at: now,
}

async function mockArticle(page: Page, overrides: Record<string, unknown>) {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const data = { ...article, ...overrides }
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === '/api/v1/admin/session') return json({ data: { enabled: true, configured: true, authenticated: false, ai_model: 'test' } })
    if (path === '/api/v1/sources') return json({ data: [{ id: 1, name: article.source_name, rss_url: 'https://example.com/feed', tags: ['tech'], enabled: true, kind: 'feed', new_articles_24h: 1 }], meta: { count: 1 } })
    if (path === '/api/v1/feed') return json({ data: [article], meta: { next_cursor: '' } })
    if (path === '/api/v1/articles/101' || path === '/api/v1/articles/101/enrichment') return json(data)
    if (path === '/api/v1/articles/101/view') return route.fulfill({ status: 204 })
    if (path === '/api/v1/articles/summaries') return json({ data: [], meta: { count: 0 } })
    if (path === '/api/v1/feed/briefings') return json({ data: [{
      digest_key: 'cover-test', scope_label: article.source_name, source_ids: '1', article_ids: '101',
      article_refs: [article], summary: '## 主要判断\n\nThis article is worth reading.',
      model: 'test', provider: 'test', generated_at: now, article_count: 1, truncated: false,
    }], meta: { count: 1 } })
    if (path === '/api/v1/images/proxy') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200"><rect width="600" height="1200" fill="#ddd"/></svg>' })
    return json({ error: 'not found' }, 404)
  })
  await page.route('https://example.com/*.png', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200"/>' }))
}

const cases = [
  { name: 'matching HTML image', body: { content_html: `<p>Body before image</p><img src="${cover}" alt="Body illustration">` }, hasImage: true },
  { name: 'different HTML image', body: { content_html: '<p>Body before image</p><img src="/other.png" alt="Body illustration">' }, hasImage: true },
  { name: 'thread standalone image', body: { thread: { full_content: `Thread text\n\n#1 ${cover}`, comments: [], total_posts: 1 } }, hasImage: true },
  { name: 'external standalone image', body: { external: { content: `External body\n\n${cover}` } }, hasImage: true },
  { name: 'text-only body', body: {}, hasImage: false },
  { name: 'unused RSS image', body: { content_html: `<img src="${cover}">`, external: { content: 'Actual external text without images.' } }, hasImage: false },
]

for (const view of ['reader', 'ai'] as const) {
  for (const scenario of cases) {
    test(`${view} cover policy: ${scenario.name}`, async ({ page }) => {
      await mockArticle(page, scenario.body)
      await page.goto('/')
      if (view === 'reader') {
        await page.locator('.feed-item').filter({ hasText: article.title }).click()
      } else {
        await page.getByRole('tab', { name: 'AI', exact: true }).click()
        await page.getByRole('button', { name: '本次简报依据 1 篇文章' }).click()
        await page.locator('.ai-briefing-source-item').filter({ hasText: article.title }).click()
      }
      const panel = page.locator(view === 'reader' ? '.detail-article' : '.ai-article-reader-panel')
      await expect(panel).toBeVisible()
      const hero = panel.locator(view === 'reader' ? '.detail-hero-image' : '.ai-article-reader-image')
      await expect(hero).toHaveCount(scenario.hasImage ? 0 : 1)
      await expect(panel.locator('img')).toHaveCount(1)
      const image = panel.locator('img')
      await image.scrollIntoViewIfNeeded()
      await expect(image).toBeVisible()
      if (!scenario.hasImage) {
        const box = await image.boundingBox()
        expect(box!.height).toBeLessThanOrEqual(Math.min(420, page.viewportSize()!.height * 0.55) + 1)
      }
      await expect.poll(() => panel.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    })
  }
}
