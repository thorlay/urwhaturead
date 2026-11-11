import { expect, test, type Page, type Route } from '@playwright/test'

const generatedAt = new Date().toISOString()

const sources = [
  {
    id: 1,
    owner_user_id: null,
    name: 'Example Technology',
    rss_url: 'https://example.com/technology.xml',
    site_key: 'example.com',
    kind: 'feed',
    tags: ['tech'],
    new_articles_24h: 4,
    click_count: 3,
    enabled: true,
    poll_interval_sec: 1800,
    created_at: generatedAt,
    updated_at: generatedAt,
  },
  {
    id: 2,
    owner_user_id: null,
    name: 'Example Forum',
    rss_url: 'https://forum.example.com/latest.rss',
    site_key: 'forum.example.com',
    kind: 'feed',
    tags: ['forum'],
    new_articles_24h: 2,
    click_count: 1,
    enabled: true,
    poll_interval_sec: 3600,
    created_at: generatedAt,
    updated_at: generatedAt,
  },
]

const feedItem = {
  id: 101,
  source_id: 1,
  source_name: 'Example Technology',
  source_tag: 'tech',
  title: 'A durable test article for the reading flow',
  link: 'https://example.com/articles/101',
  summary: 'A compact preview that verifies the high-density feed remains readable.',
  content: 'The complete article body is loaded only after opening the article.',
  author: 'Example Author',
  published_at: generatedAt,
  created_at: generatedAt,
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function mockAPI(page: Page, options: { admin?: boolean } = {}) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (path === '/api/v1/admin/session') {
      return json(route, {
        data: {
          enabled: !options.admin,
          configured: true,
          authenticated: Boolean(options.admin),
          username: options.admin ? 'admin' : undefined,
          ai_model: 'deepseek-v4-flash',
        },
      })
    }
    if (path === '/api/v1/sources' && request.method() === 'GET') {
      return json(route, { data: sources, meta: { limit: 100, offset: 0, count: sources.length } })
    }
    if (path === '/api/v1/feed' && request.method() === 'GET') {
      return json(route, { data: [feedItem], meta: { limit: 20, count: 1, next_cursor: '' } })
    }
    if (path === '/api/v1/admin/source-status') {
      return json(route, {
        data: sources.map((source) => ({
          source_id: source.id,
          name: source.name,
          primary_tag: source.tags[0],
          enabled: true,
          rss_url: source.rss_url,
          poll_interval_sec: source.poll_interval_sec,
          effective_poll_interval_sec: source.poll_interval_sec,
          consecutive_failures: 0,
          latest_status: 'success',
          latest_fetched_at: generatedAt,
          latest_http_status: 200,
          latest_item_count: 10,
          latest_duration_ms: 120,
          next_due_at: '2026-09-12T07:00:00Z',
          is_stale: false,
          window_hours: 24,
          window_total: 4,
          window_success: 4,
          window_not_modified: 0,
          window_failed: 0,
          window_success_rate: 1,
          health: 'ok',
        })),
        meta: { window_hours: 24, count: sources.length, generated_at: generatedAt },
      })
    }
    if (path === '/api/v1/articles/summaries') {
      return json(route, {
        data: [{
          article_id: 101,
          source_id: 1,
          source_name: 'Example Technology',
          title: feedItem.title,
          link: feedItem.link,
          published_at: generatedAt,
          summary: 'The article summary explains why this item matters.',
          model: 'deepseek-v4-flash',
          provider: 'test',
          input_chars: 500,
          truncated: false,
          stop_reason: 'stop',
          generated_at: generatedAt,
        }],
        meta: { limit: 50, offset: 0, count: 1 },
      })
    }
    if (path === '/api/v1/feed/briefings' && request.method() === 'GET') {
      return json(route, {
        data: [{
          digest_key: 'test-digest',
          scope_label: 'Example Technology',
          tag: 'tech',
          keyword: '',
          source_ids: '1',
          article_ids: '101',
          article_refs: [{
            id: 101,
            source_id: 1,
            source_name: 'Example Technology',
            title: feedItem.title,
            link: feedItem.link,
            published_at: generatedAt,
          }],
          limit: 20,
          summary: '## 先看这个\n\nA stable briefing for the AI library.',
          model: 'deepseek-v4-flash',
          provider: 'test',
          input_chars: 1200,
          truncated: false,
          stop_reason: 'stop',
          generated_at: generatedAt,
          article_count: 1,
        }],
        meta: { limit: 30, offset: 0, count: 1 },
      })
    }
    if (path === '/api/v1/articles/101' || path === '/api/v1/articles/101/enrichment') {
      return json(route, {
        ...feedItem,
        content_html: '<p>The complete article body is loaded only after opening the article.</p><p>A second paragraph keeps a clear visual pause between ideas.</p>',
      })
    }
    if (path === '/api/v1/articles/101/view') {
      return route.fulfill({ status: 204, body: '' })
    }
    if (path === '/api/v1/system/status') {
      return json(route, {
        data: {
          api: { status: 'ok' },
          db: { status: 'ok' },
          rsshub: { status: 'ok' },
          ai: { status: 'ok' },
          version: 'test',
          uptime_sec: 3600,
          checked_at: generatedAt,
        },
      })
    }

    return json(route, { error: `unmocked request: ${request.method()} ${path}` }, 404)
  })
}

test('reader, AI library, and source management remain navigable', async ({ page }) => {
  await mockAPI(page, { admin: true })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '聚合流' })).toBeVisible()
  await expect(page.getByText(feedItem.title, { exact: true })).toBeVisible()
  await page.getByText(feedItem.title, { exact: true }).click()
  await expect(page.getByText('The complete article body is loaded only after opening the article.', { exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'AI' }).click()
  await expect(page.getByRole('heading', { name: '每日 AI 简报' })).toBeVisible()
  await expect(page.getByText('Example Technology', { exact: true }).first()).toBeVisible()

  await page.getByRole('tab', { name: /管理/ }).click()
  await expect(page.getByRole('heading', { name: '来源管理' })).toBeVisible()
  await expect(
    page.locator('.source-table:visible, .source-mobile-card:visible').getByText('Example Technology', { exact: true }).first(),
  ).toBeVisible()
})

test('management entry stays hidden for unauthenticated visitors', async ({ page }) => {
  await mockAPI(page)
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '聚合流' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /管理/ })).toHaveCount(0)
})

test('article paragraphs preserve reading space', async ({ page }) => {
  await mockAPI(page)
  await page.goto('/')
  await page.getByText(feedItem.title, { exact: true }).click()
  const paragraph = page.getByText('A second paragraph keeps a clear visual pause between ideas.', { exact: true })
  await expect(paragraph).toBeVisible()
  await expect.poll(() => paragraph.evaluate((element) => Number.parseFloat(getComputedStyle(element).marginTop))).toBeGreaterThan(12)
})

async function mockThreadArticle(page: Page, withReplies: boolean) {
  await mockAPI(page)
  await page.route(/\/api\/v1\/articles\/101(?:\/enrichment)?$/, (route) => json(route, {
    ...feedItem,
    content: '#1 https://example.com/tool.png',
    thread: {
      topic_url: feedItem.link,
      feed_url: `${feedItem.link}.rss`,
      topic_title: feedItem.title,
      full_content: '#1 https://example.com/tool.png',
      total_posts: withReplies ? 2 : 1,
      truncated: false,
      comments: withReplies ? [{ post_number: 2, author: 'Reader', link: `${feedItem.link}#2`, content: 'A useful reply below the article.' }] : [],
    },
  }))
  await page.route('**/api/v1/images/proxy?**', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="#ddd"/></svg>',
  }))
}

test('thread reading hides empty discussion and displays image URLs', async ({ page }) => {
  await mockThreadArticle(page, false)
  await page.goto('/')
  await page.getByText(feedItem.title, { exact: true }).click()
  const article = page.locator('.detail-article')
  await expect(article.getByRole('img', { name: '文章配图' })).toBeVisible()
  await expect(article.locator('.thread-section')).toHaveCount(0)
  await expect(article.getByRole('navigation', { name: '详情内容切换' })).toHaveCount(0)
  await expect(article.getByText('继续阅读', { exact: true })).toHaveCount(0)
  await expect(article.locator('.detail-signals')).toHaveCount(0)
  await article.getByRole('button', { name: '更多', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: '生成 AI 摘要' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(() => article.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
})

test('thread replies appear directly below the body once', async ({ page }) => {
  await mockThreadArticle(page, true)
  await page.goto('/')
  await page.getByText(feedItem.title, { exact: true }).click()
  const article = page.locator('.detail-article')
  await expect(article.getByRole('heading', { name: '讨论 · 1 条回复' })).toBeVisible()
  await expect(article.getByText('A useful reply below the article.', { exact: true })).toHaveCount(1)
})

test('core views do not overflow narrow screens', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile-'), 'mobile layout assertion')
  await mockAPI(page, { admin: true })
  await page.goto('/')

  const expectNoHorizontalOverflow = async () => {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  }

  await expectNoHorizontalOverflow()
  await page.getByText(feedItem.title, { exact: true }).click()
  await expect(page.getByText('The complete article body is loaded only after opening the article.', { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow()

  await page.getByRole('tab', { name: /管理/ }).click()
  await expect(page.locator('.source-mobile-card').first()).toBeVisible()
  await expectNoHorizontalOverflow()
})
