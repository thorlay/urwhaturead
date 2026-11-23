import { expect, test, type Page, type Route } from '@playwright/test'

const generatedAt = new Date().toISOString()
const articles = [101, 102].map((id) => ({
  id, source_id: 1, source_name: 'Polling test source', source_tag: 'tech',
  title: `Polling test article ${id}`, link: `https://example.com/${id}`,
  summary: 'Preview', content: `Body for article ${id}`, created_at: generatedAt,
}))

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function mockReader(page: Page, status: (route: Route, articleID: number) => Promise<void>) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path === '/api/v1/admin/session') return json(route, { data: { enabled: true, configured: true, authenticated: true, ai_model: 'test' } })
    if (path === '/api/v1/sources') return json(route, { data: [{ id: 1, name: 'Polling test source', kind: 'feed', site_key: 'example.com', rss_url: 'https://example.com/feed', tags: ['tech'], enabled: true }], meta: { count: 1 } })
    if (path === '/api/v1/feed') return json(route, { data: articles, meta: { next_cursor: '', total_count: 0 } })
    if (path === '/api/v1/feed/briefings' || path === '/api/v1/articles/summaries') return json(route, { data: [], meta: { count: 0 } })
    const match = path.match(/^\/api\/v1\/articles\/(\d+)(.*)$/)
    if (match) {
      const articleID = Number(match[1])
      if (match[2] === '/summary/status') return status(route, articleID)
      if (match[2] === '/summary') {
        if (request.method() === 'POST') return json(route, { data: { article_id: articleID, status: 'queued', model: 'test', updated_at: generatedAt } }, 202)
        return json(route, { error: 'no cached summary' }, 404)
      }
      if (match[2] === '/view') return route.fulfill({ status: 204 })
      return json(route, articles.find((article) => article.id === articleID))
    }
    return json(route, { error: 'not found' }, 404)
  })
}

async function startSummary(page: Page, articleID = 101) {
  await page.locator('.feed-item').filter({ hasText: `Polling test article ${articleID}` }).click()
  await page.locator('.detail-floating').getByRole('button', { name: '更多', exact: true }).click()
  await page.getByRole('menuitem', { name: '生成 AI 摘要', exact: true }).click()
}

test('summary polling waits between checks when task state updates', async ({ page }) => {
  let requests = 0
  await mockReader(page, async (route) => {
    requests++
    await json(route, { data: { status: 'running', updated_at: generatedAt } })
  })
  await page.goto('/')
  await startSummary(page)
  await expect.poll(() => requests).toBeGreaterThan(0)
  // Task updates and rerenders must not bypass the 2.5-second polling delay.
  await page.waitForTimeout(600)
  expect(requests).toBe(1)
})

test('slow summary checks never overlap and completion stops polling', async ({ page }) => {
  const pending: Route[] = []
  await mockReader(page, async (route) => { pending.push(route) })
  await page.goto('/')
  await startSummary(page)
  await expect.poll(() => pending.length).toBe(1)
  await page.waitForTimeout(2800)
  expect(pending).toHaveLength(1)
  await json(pending[0], { data: { status: 'running', updated_at: generatedAt } })
  await expect.poll(() => pending.length, { timeout: 4500 }).toBe(2)
  await page.route('**/api/v1/articles/101/summary?*', (route) => json(route, { data: {
    article_id: 101, summary: '## Finished summary\n\nThe task completed successfully.',
    model: 'test', provider: 'test', generated_at: generatedAt, cache_hit: true,
  } }))
  await json(pending[1], { data: { status: 'succeeded', updated_at: generatedAt } })
  await expect(page.locator('.ai-summary-card .markdown-block')).toContainText('The task completed successfully.')
  await expect(page.getByRole('button', { name: /^AI 任务队列/ })).not.toHaveAccessibleName(/1 个进行中/)
  await page.waitForTimeout(2800)
  expect(pending).toHaveLength(2)
})

test('a late summary uses the current article selection', async ({ page }) => {
  const pending: Route[] = []
  await mockReader(page, async (route) => { pending.push(route) })
  await page.goto('/')
  await startSummary(page)
  await expect.poll(() => pending.length).toBe(1)
  await page.locator('.detail-floating').getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('.feed-item').filter({ hasText: articles[1].title }).click()
  await expect(page.locator('.detail-article')).toContainText(articles[1].title)
  expect(pending).toHaveLength(1)
  await page.route('**/api/v1/articles/101/summary?*', (route) => json(route, { data: {
    article_id: 101, summary: 'Summary belonging only to article 101',
    model: 'test', provider: 'test', generated_at: generatedAt, cache_hit: true,
  } }))
  await json(pending[0], { data: { status: 'succeeded', updated_at: generatedAt } })
  await expect(page.getByRole('button', { name: /^AI 任务队列/ })).not.toHaveAccessibleName(/1 个进行中/)
  await expect(page.locator('.detail-article')).not.toContainText('Summary belonging only to article 101')
  await page.locator('.detail-floating').getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('.feed-item').filter({ hasText: articles[0].title }).click()
  await expect(page.locator('.ai-summary-card .markdown-block')).toContainText('Summary belonging only to article 101')
})

test('hiding the final pending task cancels its request', async ({ page }) => {
  const pending: Route[] = []
  let aborted = false
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname.endsWith('/summary/status')) aborted = true
  })
  await mockReader(page, async (route) => { pending.push(route) })
  await page.goto('/')
  await startSummary(page)
  await expect.poll(() => pending.length).toBe(1)
  await page.getByRole('button', { name: /^AI 任务队列/ }).click()
  const dialog = page.locator('.task-queue-dialog')
  await dialog.getByRole('button', { name: '隐藏', exact: true }).click()
  await expect(dialog.getByText(/暂无任务/)).toBeVisible()
  await expect.poll(() => aborted).toBe(true)
  await json(pending[0], { data: { status: 'succeeded', updated_at: generatedAt } }).catch(() => undefined)
  await expect(dialog.getByText(/暂无任务/)).toBeVisible()
})

test('a removed task stays removed while another task is still pending', async ({ page }) => {
  const pending: Route[] = []
  await mockReader(page, async (route, articleID) => {
    if (articleID === 101) pending.push(route)
    else await json(route, { data: { status: 'running', updated_at: generatedAt } })
  })
  await page.goto('/')
  await startSummary(page)
  await expect.poll(() => pending.length).toBe(1)
  await page.locator('.detail-floating').getByRole('button', { name: '关闭', exact: true }).click()
  await startSummary(page, 102)
  await page.getByRole('button', { name: /^AI 任务队列/ }).click()
  const dialog = page.locator('.task-queue-dialog')
  await dialog.locator('.ai-task-item').filter({ hasText: articles[0].title }).getByRole('button', { name: '隐藏', exact: true }).click()
  await expect(dialog.locator('.ai-task-title')).toHaveText(articles[1].title)
  await json(pending[0], { data: { status: 'running', updated_at: generatedAt } })
  await expect(dialog.locator('.ai-task-status')).toHaveText('生成中', { timeout: 4500 })
  await expect(dialog.locator('.ai-task-title')).toHaveText(articles[1].title)
  expect(pending).toHaveLength(1)
})
