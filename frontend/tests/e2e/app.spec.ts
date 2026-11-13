import { expect, test, type Page, type Route } from '@playwright/test'
import { sortThreadCommentsByUpvotes } from '../../src/lib/thread-comment-sort'

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

async function mockAPI(page: Page, options: { admin?: boolean; catchUpCount?: number } = {}) {
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
      if (url.searchParams.get('mode') === 'important') {
        return json(route, { data: [{ ...feedItem, highlight_reason: '提供具体实验数据，适合判断技术变化的实际影响。' }], meta: { limit: 15, count: 1, next_cursor: '' } })
      }
      return json(route, { data: [feedItem], meta: { limit: 20, count: 1, total_count: url.searchParams.has('since') ? options.catchUpCount : undefined, next_cursor: '' } })
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

test('important feed shows reasons and preserves source briefing access', async ({ page }) => {
  await mockAPI(page)
  await page.goto('/')
  const modes = page.getByRole('group', { name: '阅读重点', exact: true })
  await modes.getByRole('button', { name: '重点', exact: true }).click()
  await expect(modes.getByRole('button', { name: '重点', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.feed-highlight-reason')).toContainText('提供具体实验数据')
  await expect(page.getByRole('button', { name: 'AI 速览', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await modes.getByRole('button', { name: '全部', exact: true }).click()
  await expect(page.locator('.feed-highlight-reason')).toHaveCount(0)
  await expect(page.getByText(feedItem.title, { exact: true })).toBeVisible()
})

test('AI briefing in important mode still uses ordinary source candidates', async ({ page }) => {
  await mockAPI(page)
  await page.route('**/api/v1/feed?**', (route) => {
    const url = new URL(route.request().url())
    if (!url.searchParams.has('mode') && url.searchParams.get('limit') === '30') {
      return json(route, { data: [feedItem, { ...feedItem, id: 102, title: 'An ordinary non-highlighted article' }], meta: { next_cursor: '' } })
    }
    return route.fallback()
  })
  await page.route('**/api/v1/feed/briefing', (route) => json(route, { data: {
    digest_key: 'test-briefing', summary: 'A generated test briefing', model: 'deepseek-v4-flash', provider: 'test', generated_at: generatedAt, article_count: 2, input_items: [], cache_hit: false,
  } }))
  await page.goto('/')
  await page.getByRole('group', { name: '阅读重点', exact: true }).getByRole('button', { name: '重点', exact: true }).click()
  await expect(page.locator('.feed-highlight-reason')).toBeVisible()
  const request = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/v1/feed/briefing' && r.method() === 'POST')
  await page.getByRole('button', { name: 'AI 速览', exact: true }).click()
  expect((await request).postDataJSON().article_ids).toEqual([101, 102])
})

test('important feed empty state does not pretend ordinary articles are recommendations', async ({ page }) => {
  await mockAPI(page)
  await page.route('**/api/v1/feed?**', (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('mode') === 'important') return json(route, { data: [], meta: { count: 0, next_cursor: '' } })
    return route.fallback()
  })
  await page.goto('/')
  await page.getByRole('group', { name: '阅读重点', exact: true }).getByRole('button', { name: '重点', exact: true }).click()
  await expect(page.getByText(/当前范围暂无 AI 推荐/)).toBeVisible()
  await expect(page.getByText(feedItem.title, { exact: true })).toHaveCount(0)
})

test('a delayed important response cannot overwrite the all feed after switching back', async ({ page }) => {
  await mockAPI(page)
  await page.route('**/api/v1/feed?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('mode') !== 'important') return route.fallback()
    await new Promise((resolve) => setTimeout(resolve, 300))
    return json(route, { data: [{ ...feedItem, highlight_reason: 'An outdated recommendation response.' }], meta: { next_cursor: '' } })
  })
  await page.goto('/')
  await expect(page.getByText(feedItem.title, { exact: true })).toBeVisible()
  const modes = page.getByRole('group', { name: '阅读重点', exact: true })
  const response = page.waitForResponse((r) => new URL(r.url()).searchParams.get('mode') === 'important')
  await modes.getByRole('button', { name: '重点', exact: true }).click()
  await modes.getByRole('button', { name: '全部', exact: true }).click()
  await response
  await expect(page.getByText(feedItem.title, { exact: true })).toBeVisible()
  await expect(page.locator('.feed-highlight-reason')).toHaveCount(0)
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

test('article images stay proportional and within the reading viewport', async ({ page }) => {
  await mockAPI(page)
  await page.route(/\/api\/v1\/articles\/101(?:\/enrichment)?$/, (route) => json(route, {
    ...feedItem,
    content_html: '<p>Image examples</p><img src="https://example.com/tall.png" alt="Tall image" width="600" height="6000"><img src="https://example.com/small.png" alt="Small image" width="80" height="40">',
  }))
  await page.route(/https:\/\/example\.com\/(?:tall|small)\.png/, (route) => {
    const tall = route.request().url().includes('tall.png')
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${tall ? 600 : 80}" height="${tall ? 6000 : 40}"><rect width="100%" height="100%" fill="#ddd"/></svg>` })
  })
  await page.goto('/')
  await page.getByText(feedItem.title, { exact: true }).click()
  const tall = page.getByRole('img', { name: 'Tall image', exact: true })
  await tall.scrollIntoViewIfNeeded()
  await expect.poll(() => tall.evaluate((image) => (image as HTMLImageElement).naturalHeight)).toBe(6000)
  const size = await tall.boundingBox()
  expect(size!.height).toBeLessThanOrEqual(Math.min(420, page.viewportSize()!.height * 0.55) + 1)
  expect(Math.abs(size!.width / size!.height - 0.1)).toBeLessThan(0.02)
  const small = page.getByRole('img', { name: 'Small image', exact: true })
  await expect(small).toBeVisible()
  expect((await small.boundingBox())!.width).toBeLessThanOrEqual(82)
  await expect(tall.locator('..')).toHaveAttribute('aria-label', '查看完整图片')
  await expect(tall.locator('..')).toHaveAttribute('target', '_blank')
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

test('article reader uses desktop columns and a full mobile page', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.startsWith('mobile')
  await mockAPI(page)
  await page.goto('/')
  await page.getByText(feedItem.title, { exact: true }).click()
  const detail = page.locator('.detail-floating')
  await expect(detail).toContainText(feedItem.content)
  await expect(page.locator('.subscription-sidebar')).toHaveClass(/collapsed/)
  if (mobile) {
    await expect(page.locator('.reader-stack')).toBeHidden()
    const bounds = await detail.boundingBox()
    expect(bounds!.width).toBeGreaterThan((page.viewportSize()!.width) * 0.9)
  } else {
    await expect(page.locator('.feed')).toBeVisible()
    const feed = await page.locator('.feed').boundingBox()
    const reader = await detail.boundingBox()
    expect(reader!.x).toBeGreaterThanOrEqual(feed!.x + feed!.width - 1)
    expect(feed!.width).toBeGreaterThanOrEqual(300)
    expect(await detail.evaluate((element) => getComputedStyle(element).position)).toBe('relative')
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await detail.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(detail).toHaveCount(0)
  await expect(page.getByText(feedItem.title, { exact: true })).toBeVisible()
})


test('split feed toolbar and catch-up text do not collide', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockAPI(page, { catchUpCount: 3256 })
  await page.goto('/')
  await page.getByText(feedItem.title, { exact: true }).click()
  await expect(page.locator('.detail-floating')).toContainText(feedItem.content)
  const status = page.locator('.feed-catch-up-status')
  await expect(status).toContainText('3256')
  const heading = await page.locator('.feed-header-title').boundingBox()
  const toolbar = await page.locator('.feed-header-tools').boundingBox()
  const catchUp = await page.locator('.feed-catch-up').boundingBox()
  const statusBounds = await status.boundingBox()
  const actions = await page.locator('.feed-catch-up-actions').boundingBox()
  expect(toolbar!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height)
  expect(catchUp!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height)
  expect(actions!.y).toBeGreaterThanOrEqual(statusBounds!.y + statusBounds!.height)
  const text = await status.locator('span').boundingBox()
  expect(text!.height).toBeLessThan(40)
})

test('reading targets remain still on hover and sidebar collapse', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockAPI(page)
  await page.goto('/')
  const row = page.locator('.feed-item').filter({ hasText: feedItem.title })
  const title = row.locator('.feed-item-title')
  const before = await title.boundingBox()
  await row.hover()
  const after = await title.boundingBox()
  expect(after!.x).toBe(before!.x)
  expect(await row.evaluate((element) => getComputedStyle(element).animationName)).toBe('none')
  expect(await page.locator('.reader-stack').evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s')
  await row.click()
  await expect(page.locator('.detail-floating')).toContainText(feedItem.content)
  expect(await page.locator('.detail-floating').evaluate((element) => getComputedStyle(element).scrollbarGutter)).toBe('stable')
})

test('opening an article keeps its row visible after the split resizes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 })
  await mockAPI(page)
  await page.route('**/api/v1/feed?**', async (route) => {
    const items = Array.from({ length: 40 }, (_, index) => index === 18 ? feedItem : {
      ...feedItem, id: 200 + index, title: `Other article ${index}`,
    })
    return json(route, { data: items, meta: { count: items.length, next_cursor: '' } })
  })
  await page.goto('/')
  const row = page.locator('.feed-item').filter({ hasText: feedItem.title })
  await row.scrollIntoViewIfNeeded()
  await row.click()
  await expect(page.locator('.detail-title')).toHaveText(feedItem.title)
  await expect(row).toHaveClass(/active/)
  await expect.poll(async () => {
    const list = await page.locator('.feed-list').boundingBox()
    const selected = await row.boundingBox()
    return selected!.y >= list!.y - 1 && selected!.y + selected!.height <= list!.y + list!.height + 1
  }).toBe(true)
})

const secondArticle = {
  ...feedItem, id: 102, title: 'The second selected article',
  content: 'Only the second article belongs in this reader.',
}

async function mockReaderPair(page: Page) {
  await mockAPI(page)
  await page.route('**/api/v1/feed?**', (route) => json(route, {
    data: [feedItem, secondArticle], meta: { count: 2, next_cursor: '' },
  }))
  await page.route(/\/api\/v1\/articles\/102(?:\/enrichment)?$/, (route) => json(route, secondArticle))
}

async function holdFirstArticle(page: Page, status = 200) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route(/\/api\/v1\/articles\/101(?:\/enrichment)?$/, async (route) => {
    await gate
    return json(route, status === 200 ? {
      ...feedItem, content: 'A late response from the first article.', content_html: '',
    } : { error: 'Delayed first article failure' }, status)
  })
  return async () => {
    const responses = [
      page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/articles/101'),
      page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/articles/101/enrichment'),
    ]
    release()
    await Promise.all((await Promise.all(responses)).map((response) => response.finished()))
    // Let the browser consume both responses before asserting the visible selection.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  }
}

test('a slow article response cannot replace a newer selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockReaderPair(page)
  const releaseFirst = await holdFirstArticle(page)
  await page.goto('/')
  await page.locator('.feed-item').filter({ hasText: feedItem.title }).click()
  await expect(page.locator('.detail-title')).toHaveText(feedItem.title)
  await page.locator('.feed-item').filter({ hasText: secondArticle.title }).click()
  await expect(page.locator('.detail-title')).toHaveText(secondArticle.title)
  await releaseFirst()
  await expect(page.locator('.detail-title')).toHaveText(secondArticle.title)
  await expect(page.locator('.detail-floating')).toContainText(secondArticle.content)
  await expect(page.locator('.feed-item.active')).toContainText(secondArticle.title)
  await expect(page.locator('.detail-floating')).not.toContainText('A late response')
})

test('closing pending reading ignores its late error and allows reopening', async ({ page }) => {
  await mockReaderPair(page)
  const releaseFirst = await holdFirstArticle(page, 500)
  await page.goto('/')
  await page.locator('.feed-item').filter({ hasText: feedItem.title }).click()
  await expect(page.locator('.detail-title')).toHaveText(feedItem.title)
  await page.locator('.detail-floating').getByRole('button', { name: '关闭', exact: true }).click()
  await releaseFirst()
  await expect(page.locator('.detail-floating, .detail-page')).toHaveCount(0)
  await expect(page.locator('.notice').filter({ hasText: '加载文章详情失败' })).toHaveCount(0)
  await page.locator('.feed-item').filter({ hasText: secondArticle.title }).click()
  await expect(page.locator('.detail-title')).toHaveText(secondArticle.title)
})

test('opening a library briefing invalidates an unfinished article', async ({ page }) => {
  await mockReaderPair(page)
  const releaseFirst = await holdFirstArticle(page)
  await page.goto('/')
  await page.locator('.feed-item').filter({ hasText: feedItem.title }).click()
  await page.getByRole('tab', { name: 'AI', exact: true }).click()
  // Briefings in the AI library have their own immersive reading entry.
  const briefing = page.getByText('A stable briefing for the AI library.', { exact: false })
  await expect(briefing.first()).toBeVisible()
  await page.getByRole('button', { name: '回到阅读视角', exact: true }).click()
  await expect(page.locator('.detail-page')).toContainText('A stable briefing for the AI library.')
  await releaseFirst()
  await expect(page.locator('.detail-page')).toContainText('A stable briefing for the AI library.')
  await expect(page.locator('.detail-page')).not.toContainText('A late response')
  await expect(page.locator('.detail-page .skeleton')).toHaveCount(0)
  await page.locator('.detail-origin-return').getByRole('button', { name: /返回/ }).click()
  await expect(page.getByRole('heading', { name: '每日 AI 简报' })).toBeVisible()
})

test('immersive reading returns to the same scrolled list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await mockAPI(page)
  await page.route('**/api/v1/feed?**', (route) => json(route, {
    data: Array.from({ length: 40 }, (_, index) => index === 18 ? feedItem : {
      ...feedItem, id: 200 + index, title: `Scroll preservation article ${index}`,
    }), meta: { count: 40, next_cursor: '' },
  }))
  await page.goto('/')
  const row = page.locator('.feed-item').filter({ hasText: feedItem.title })
  await row.scrollIntoViewIfNeeded()
  await row.click()
  await expect(page.locator('.detail-title')).toHaveText(feedItem.title)
  const list = page.locator('.feed-list')
  const scrollBefore = await list.evaluate((element) => element.scrollTop)
  await page.locator('.detail-floating').getByRole('button', { name: '更多', exact: true }).click()
  await page.getByRole('menuitem', { name: '沉浸阅读' }).click()
  await expect(page.locator('.detail-page')).toBeVisible()
  await page.locator('.detail-page').getByRole('button', { name: /返回/ }).click()
  await expect(page.locator('.detail-page')).toHaveCount(0)
  await expect(row).toBeInViewport()
  expect(await list.evaluate((element) => element.scrollTop)).toBe(scrollBefore)
})

test('mobile whole-page reading restores the list scroll position', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile document scrolling')
  await mockAPI(page)
  await page.route('**/api/v1/feed?**', (route) => json(route, {
    data: Array.from({ length: 40 }, (_, index) => index === 18 ? feedItem : {
      ...feedItem, id: 200 + index, title: `Mobile scroll article ${index}`,
    }), meta: { count: 40, next_cursor: '' },
  }))
  await page.goto('/')
  const row = page.locator('.feed-item').filter({ hasText: feedItem.title })
  await row.scrollIntoViewIfNeeded()
  const scrollBefore = await page.evaluate(() => window.scrollY)
  expect(scrollBefore).toBeGreaterThan(0)
  await row.click()
  await expect(page.locator('.detail-title')).toHaveText(feedItem.title)
  await page.locator('.detail-floating').getByRole('button', { name: '关闭', exact: true }).click()
  await expect(row).toBeInViewport()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore)
})

test('forum discussion briefing selects forum evidence and opens original threads', async ({ page }) => {
  await mockAPI(page, { admin: true })
  const thread = { ...feedItem, id: 201, source_id: 2, source_name: 'Example Forum', source_tag: 'forum', title: 'Is this tool worth using?', link: 'https://v2ex.com/t/201' }
  await page.route('**/api/v1/feed?**', (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('tag') === 'forum') {
      return json(route, { data: [thread], meta: { next_cursor: '' } })
    }
    return route.fallback()
  })
  await page.route('**/api/v1/feed/briefing', (route) => json(route, { data: {
    digest_key: 'forum-test', summary: '# 论坛讨论简报\n\n## 大家在聊什么\n\n### 工具体验\n\n- 主要观点：有人认为省时，也有人担心隐私成本。\n- 原帖：[A01]', model: 'test', provider: 'test', generated_at: generatedAt, article_count: 1,
    input_items: [{ ...thread }], cache_hit: false,
  } }))
  await page.goto('/')
  const request = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/v1/feed/briefing' && r.method() === 'POST')
  await page.getByRole('button', { name: '论坛讨论简报', exact: true }).click()
  expect((await request).postDataJSON()).toMatchObject({ tag: 'forum', article_ids: [201] })
  await expect(page.getByRole('heading', { name: '大家在聊什么' })).toBeVisible()
  await expect(page.getByRole('link', { name: '原帖 1', exact: true })).toHaveAttribute('href', thread.link)
})

test('forum briefing explains empty evidence without generating a report', async ({ page }) => {
  await mockAPI(page)
  let generations = 0
  await page.route('**/api/v1/feed?**', (route) => {
    if (new URL(route.request().url()).searchParams.get('tag') === 'forum') return json(route, { data: [], meta: { next_cursor: '' } })
    return route.fallback()
  })
  await page.route('**/api/v1/feed/briefing', (route) => { if (!route.request().postDataJSON()?.cache_only) generations += 1; return json(route, { error: 'cache not found' }, 404) })
  await page.goto('/')
  await page.getByRole('button', { name: '论坛讨论简报', exact: true }).click()
  await expect(page.getByText('最近 24 小时暂无论坛讨论。请检查 V2EX、HN 订阅的抓取状态。')).toBeVisible()
  expect(generations).toBe(0)
})

async function openFeedQuerySearch(page: Page) {
  await page.locator('.feed-ai-more').getByRole('button').click()
  await page.getByRole('menuitem', { name: '打开搜索与筛选' }).click()
  await expect(page.getByPlaceholder('搜索标题/摘要')).toBeVisible()
}

// Manual-pagination tests control when loading starts; other cases keep the real observer.
async function disableFeedAutoLoad(page: Page) {
  await page.addInitScript(() => {
    const Observer = window.IntersectionObserver
    window.IntersectionObserver = class extends Observer {
      observe(target: Element) {
        if (!target.classList.contains('feed-auto-load-sentinel')) super.observe(target)
      }
    }
  })
}

test('feed UI: rapid searches keep the latest submitted filter', async ({ page }) => {
  await mockAPI(page)
  let releaseOld!: () => void
  const gate = new Promise<void>((resolve) => { releaseOld = resolve })
  await page.route('**/api/v1/feed?**', async (route) => {
    const query = new URL(route.request().url()).searchParams
    if (query.has('since') || !query.has('q')) return route.fallback()
    const keyword = query.get('q')!
    if (keyword === 'older') await gate
    return json(route, { data: [{ ...feedItem, id: keyword === 'older' ? 301 : 302, title: `Search result ${keyword}` }], meta: { next_cursor: '' } })
  })
  await page.goto('/')
  await openFeedQuerySearch(page)
  const input = page.getByPlaceholder('搜索标题/摘要')
  const search = page.getByRole('button', { name: '搜索', exact: true })
  const oldRequest = page.waitForRequest((request) => new URL(request.url()).searchParams.get('q') === 'older')
  await input.fill('older')
  await search.click()
  await oldRequest
  await input.fill('latest')
  await search.click()
  await expect(page.locator('.feed-item-inline-title')).toHaveText('Search result latest')
  const oldResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get('q') === 'older')
  releaseOld()
  await (await oldResponse).finished()
  await expect(page.locator('.feed-item-inline-title')).toHaveText('Search result latest')
  await expect(search).toBeEnabled()
})

test('feed UI: switching source while a page loads never appends the old source', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await disableFeedAutoLoad(page)
  await mockAPI(page)
  let releasePage!: () => void
  const gate = new Promise<void>((resolve) => { releasePage = resolve })
  const pageRequests: Array<{ source: string; cursor: string }> = []
  await page.route('**/api/v1/feed?**', async (route) => {
    const params = new URL(route.request().url()).searchParams
    const source = params.get('source_ids')
    if (!source || params.has('since')) return route.fallback()
    const cursor = params.get('cursor') || ''
    if (cursor) pageRequests.push({ source, cursor })
    if (source === '1') {
      if (cursor) await gate
      return json(route, { data: [{ ...feedItem, id: cursor ? 310 : 311, title: cursor ? 'Obsolete source page' : 'First source row' }], meta: { next_cursor: cursor ? '' : 'source-one-page' } })
    }
    return json(route, { data: [{ ...feedItem, id: cursor ? 313 : 312, source_id: 2, source_name: 'Example Forum', title: cursor ? 'Second source next page' : 'Second source row' }], meta: { next_cursor: cursor ? '' : 'source-two-page' } })
  })
  await page.goto('/')
  const oldPage = page.waitForRequest((request) => new URL(request.url()).searchParams.get('cursor') === 'source-one-page')
  await page.locator('.subscription-item').filter({ hasText: 'Example Technology' }).click()
  await page.locator('.feed-load-more-button').click()
  await oldPage
  await page.locator('.subscription-item').filter({ hasText: 'Example Forum' }).click()
  await expect(page.locator('.feed-item-inline-title').first()).toHaveText('Second source row')
  await page.locator('.feed-load-more-button').click()
  const oldResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get('cursor') === 'source-one-page')
  releasePage()
  await (await oldResponse).finished()
  await expect(page.getByText('Second source next page', { exact: true })).toBeVisible()
  await expect(page.locator('.feed-item-inline-title')).toHaveText(['Second source row', 'Second source next page'])
  expect(pageRequests).toEqual([
    { source: '1', cursor: 'source-one-page' }, { source: '2', cursor: 'source-two-page' },
  ])
})

test('feed UI: repeated load-more clicks issue one page and keep rows unique', async ({ page }) => {
  await disableFeedAutoLoad(page)
  await mockAPI(page)
  let pageCalls = 0
  let releasePage!: () => void
  const gate = new Promise<void>((resolve) => { releasePage = resolve })
  await page.route('**/api/v1/feed?**', async (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.has('since')) return route.fallback()
    if (!params.has('cursor')) return json(route, { data: [feedItem], meta: { next_cursor: 'duplicate-page' } })
    pageCalls += 1
    await gate
    return json(route, { data: [feedItem, { ...feedItem, id: 320, title: 'Unique appended row' }], meta: { next_cursor: '' } })
  })
  await page.goto('/')
  const more = page.locator('.feed-load-more-button')
  await expect(more).toBeEnabled()
  const request = page.waitForRequest((request) => new URL(request.url()).searchParams.get('cursor') === 'duplicate-page')
  await more.evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await request
  await expect(more).toBeDisabled()
  releasePage()
  await expect(page.locator('.feed-item-inline-title')).toHaveText([feedItem.title, 'Unique appended row'])
  expect(pageCalls).toBe(1)
})

test('feed UI: failed first page and failed pagination retry their original requests', async ({ page }) => {
  await disableFeedAutoLoad(page)
  await mockAPI(page)
  let firstCalls = 0
  let pageCalls = 0
  await page.route('**/api/v1/feed?**', (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.has('since')) return route.fallback()
    if (!params.has('cursor')) {
      if (++firstCalls === 1) return json(route, { error: 'First page temporarily unavailable' }, 500)
      return json(route, { data: [feedItem], meta: { next_cursor: 'retry-page' } })
    }
    expect(params.get('cursor')).toBe('retry-page')
    if (++pageCalls === 1) return json(route, { error: 'Next page temporarily unavailable' }, 500)
    return json(route, { data: [{ ...feedItem, id: 330, title: 'Recovered pagination row' }], meta: { next_cursor: '' } })
  })
  await page.goto('/')
  await page.locator('.feed .inline-error').getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.locator('.feed-item-inline-title')).toHaveText(feedItem.title)
  const more = page.locator('.feed-load-more-button')
  await more.click()
  await expect(page.getByText('加载 feed 失败: Next page temporarily unavailable', { exact: true })).toBeVisible()
  await expect(page.locator('.feed-item-inline-title')).toHaveText(feedItem.title)
  await expect(more).toBeEnabled()
  await more.click()
  await expect(page.locator('.feed-item-inline-title')).toHaveText([feedItem.title, 'Recovered pagination row'])
  expect(pageCalls).toBe(2)
})

test('feed UI: pagination ignores search text until it is submitted', async ({ page }) => {
  await disableFeedAutoLoad(page)
  await mockAPI(page)
  const appendedQueries: string[] = []
  await page.route('**/api/v1/feed?**', (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.has('since')) return route.fallback()
    if (!params.has('cursor')) return json(route, { data: [feedItem], meta: { next_cursor: 'applied-query-page' } })
    appendedQueries.push(params.get('q') || '')
    return json(route, { data: [{ ...feedItem, id: 340, title: 'Next page of the applied query' }], meta: { next_cursor: '' } })
  })
  await page.goto('/')
  await openFeedQuerySearch(page)
  await page.getByPlaceholder('搜索标题/摘要').fill('not submitted yet')
  await page.locator('.feed-load-more-button').click()
  await expect(page.getByText('Next page of the applied query', { exact: true })).toBeVisible()
  expect(appendedQueries).toEqual([''])
})

test('feed UI: automatic pagination stops after an error until manually retried', async ({ page }) => {
  await page.clock.install()
  await mockAPI(page)
  let pageCalls = 0
  await page.route('**/api/v1/feed?**', (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.has('since')) return route.fallback()
    if (!params.has('cursor')) return json(route, { data: [feedItem], meta: { next_cursor: 'auto-retry-page' } })
    if (++pageCalls === 1) return json(route, { error: 'Automatic pagination failed' }, 500)
    return json(route, { data: [{ ...feedItem, id: 350, title: 'Recovered automatic page' }], meta: { next_cursor: '' } })
  })
  await page.goto('/')
  await expect(page.getByText('加载 feed 失败: Automatic pagination failed', { exact: true })).toBeVisible()
  await page.clock.runFor(1500)
  expect(pageCalls).toBe(1)
  await expect(page.locator('.feed-item-inline-title')).toHaveText(feedItem.title)
  await page.locator('.feed-load-more-button').click()
  await expect(page.getByText('Recovered automatic page', { exact: true })).toBeVisible()
  expect(pageCalls).toBe(2)
})

test('NGA reader displays replies separately below the main post', async ({ page }) => {
  await mockAPI(page)
  await page.route(/\/api\/v1\/articles\/101(?:\/enrichment)?$/, (route) => {
    if (!['/api/v1/articles/101', '/api/v1/articles/101/enrichment'].includes(new URL(route.request().url()).pathname)) return route.fallback()
    return json(route, { ...feedItem, link: 'https://nga.178.com/read.php?tid=123', content_html: '<p>NGA original HTML</p>', thread: {
      topic_url: 'https://nga.178.com/read.php?tid=123', feed_url: 'http://rsshub:1200/nga/post/123', topic_title: 'NGA discussion', full_content: 'NGA main post', total_posts: 2, truncated: false,
      comments: [{ post_number: 0, author: 'Alice', link: 'https://nga.178.com/read.php?tid=123#postcontent456', content: 'NGA reply with a different opinion' }],
    } })
  })
  await page.goto('/')
  await page.getByText(feedItem.title, { exact: true }).click()
  await expect(page.getByRole('heading', { name: '讨论 · 1 条回复' })).toBeVisible()
  await expect(page.getByText('NGA reply with a different opinion', { exact: true })).toBeVisible()
  await expect(page.getByText('NGA main post', { exact: true })).toHaveCount(1)
  await expect(page.getByText('这里展示已获取的部分回复，完整讨论可打开原帖查看。')).toBeVisible()
})


test('NGA likes sort all loaded replies before previewing and preserve floor labels', async ({ page }) => {
  await mockAPI(page)
  const comments = [
    { author: 'Unknown', content: 'Unknown votes', upvotes: undefined },
    { author: 'Zero', content: 'Zero votes', upvotes: 0 },
    { author: 'Low', content: 'One vote', upvotes: 1 },
    { author: 'Top', content: 'Top voted reply', upvotes: 36 },
    { author: 'Tied', content: 'Another top reply', upvotes: 36 },
  ].map((comment, index) => ({ ...comment, post_number: index + 2, link: `https://nga.178.com/read.php?tid=123#postcontent${index + 1}` }))
  await page.route(/\/api\/v1\/articles\/101(?:\/enrichment)?$/, (route) => json(route, {
    ...feedItem, link: 'https://nga.178.com/read.php?tid=123', thread: {
      topic_url: 'https://nga.178.com/read.php?tid=123', feed_url: 'http://rsshub/nga/post/123', topic_title: 'Thread', full_content: 'Main', total_posts: 6, truncated: false, comments,
    },
  }))
  await page.goto('/')
  await page.getByText(feedItem.title, { exact: true }).click()
  await expect(page.getByText('Top voted reply', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('赞数 0', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '按赞数排序', exact: true }).click()
  const replies = page.locator('.thread-comment')
  await expect(replies).toHaveCount(3)
  await expect(replies.nth(0)).toContainText('Top voted reply')
  await expect(replies.nth(0)).toContainText('#5')
  await expect(replies.nth(1)).toContainText('Another top reply')
  await expect(replies.nth(2)).toContainText('One vote')
  await page.getByRole('button', { name: '查看全部评论（5）' }).click()
  await expect(replies.last()).toContainText('Unknown votes')
  await expect(replies.last().getByLabel(/赞数/)).toHaveCount(0)
  await page.getByRole('button', { name: '最早在前', exact: true }).click()
  await expect(replies.first()).toContainText('Unknown votes')
  await expect(page.getByRole('button', { name: '按赞数排序', exact: true })).toHaveAttribute('aria-pressed', 'false')
})

test('comment vote sorting is stable and does not mutate chronological replies', () => {
  const comments = [{ upvotes: undefined }, { upvotes: 0 }, { upvotes: 9 }, { upvotes: 9 }, { upvotes: null }]
  const ranked = sortThreadCommentsByUpvotes(comments)
  expect(ranked).toEqual([comments[2], comments[3], comments[1], comments[0], comments[4]])
  expect(comments[0].upvotes).toBeUndefined()
})
