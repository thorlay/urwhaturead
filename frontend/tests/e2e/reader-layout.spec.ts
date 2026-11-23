import { expect, test, type Page } from '@playwright/test'

const now = new Date().toISOString()
const title = '芯片股刚刚创下四月以来最大单周涨幅，对冲基金却又选择逢高减持，市场分歧为何加剧？'
const paragraph = '芯片股强劲反弹，对冲基金却选择加码做空。这一反常信号，正在成为市场能否持续走高的核心悬念。研究者需要结合资金流向、产业基本面与估值变化判断，不能只看一天的价格波动。'
const rows = [101, 102].map((id) => ({ id, source_id: 1, source_name: '华尔街见闻 · 最新文章', title: id === 101 ? title : '另一篇值得阅读的文章', link: `https://example.com/articles/${id}`, summary: '这是信息流预览，不应在分屏中挤占标题。', published_at: now, created_at: now }))
const sources = [
  { id: 1, name: rows[0].source_name, rss_url: 'https://example.com/feed', site_key: 'example.com', tags: ['finance'], enabled: true, kind: 'feed', new_articles_24h: 2 },
  { id: 2, name: 'HN 精选', rss_url: 'https://hnrss.org/best', site_key: 'hnrss.org', tags: ['tech'], enabled: true, kind: 'feed', new_articles_24h: 3 },
  { id: 3, name: 'HN 首页', rss_url: 'https://hnrss.org/frontpage', site_key: 'hnrss.org', tags: ['tech'], enabled: true, kind: 'feed', new_articles_24h: 4 },
]

async function mockReader(page: Page, admin = false) {
  await page.route('**/api/v1/**', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === '/api/v1/admin/session') return json({ data: { enabled: true, configured: true, authenticated: admin, ai_model: 'test' } })
    if (path === '/api/v1/sources') return json({ data: sources, meta: { count: sources.length } })
    if (path === '/api/v1/admin/source-status') return json({ data: [], meta: { count: 0, window_hours: 24, generated_at: now } })
    if (path === '/api/v1/feed') {
      const selected = url.searchParams.get('source_ids')
      const data = selected && selected !== '1' ? [{ ...rows[0], id: 201, source_id: 2, source_name: 'HN 精选' }] : rows
      return json({ data, meta: { next_cursor: '', total_count: url.searchParams.has('since') ? 279 : undefined } })
    }
    if (/\/articles\/10[12](?:\/enrichment)?$/.test(path)) return json({ ...rows[path.includes('102') ? 1 : 0], content_html: `<p>${paragraph}</p><p>${paragraph}</p><h2>逢高做空，而非逢低买入</h2><p>${paragraph}</p>` })
    if (path.endsWith('/view')) return route.fulfill({ status: 204 })
    if (path === '/api/v1/articles/summaries' || path === '/api/v1/feed/briefings') return json({ data: [], meta: { count: 0 } })
    return json({ error: 'not found' }, 404)
  })
}

test('three main tabs share stable chrome and toolbar controls at every width', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  await mockReader(page, true)
  const mobile = testInfo.project.name.startsWith('mobile-')
  for (const width of mobile ? [320, 390, 768] : [1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    const topbar = page.locator('.topbar-unified')
    const initial = await topbar.boundingBox()
    const nav = await topbar.locator('.view-tabs').boundingBox()
    const controlStyle = (el: Element) => {
      const style = getComputedStyle(el)
      return { height: style.height, radius: style.borderRadius, font: style.fontSize, weight: style.fontWeight }
    }
    const readerControl = await page.getByRole('button', { name: '打开搜索与筛选', exact: true }).evaluate(controlStyle)
    for (const view of ['AI', '管理', '阅读流']) {
      await topbar.getByRole('tab', { name: view === '管理' ? /^管理/ : view, exact: view !== '管理' }).click()
      const toolbar = page.locator('.workspace-toolbar').first()
      await expect(toolbar).toBeVisible()
      const current = (await topbar.boundingBox())!
      const currentNav = (await topbar.locator('.view-tabs').boundingBox())!
      expect(Math.abs(current.y - initial!.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(current.height - initial!.height)).toBeLessThanOrEqual(1)
      expect(Math.abs(currentNav.x - nav!.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(currentNav.y - nav!.y)).toBeLessThanOrEqual(1)
      const control = view === 'AI' ? toolbar.getByRole('button', { name: /^搜索/ })
        : view === '管理' ? toolbar.getByRole('button', { name: /刷新状态|更新中/ })
        : toolbar.getByRole('button', { name: '打开搜索与筛选', exact: true })
      await expect(control).toBeEnabled()
      expect(await control.evaluate(controlStyle)).toEqual(readerControl)
      await expect(toolbar.locator('.workspace-toolbar-actions')).toHaveCSS('flex-direction', 'row')
      if (view === '管理') {
        await expect(page.getByRole('tablist', { name: '管理页面视图' })).toHaveCSS('flex-direction', 'row')
        await toolbar.getByRole('button', { name: '更多管理', exact: true }).click()
        await expect(page.getByRole('menuitem', { name: '检查系统', exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menu')).toHaveCount(0)
      }
      if (view === 'AI') {
        const empty = (await page.locator('.ai-library-empty').boundingBox())!
        expect(empty.width).toBeGreaterThan(Math.min(260, width * 0.6))
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      if (mobile) {
        await topbar.getByRole('button', { name: '页面选项', exact: true }).click()
        await expect(page.getByRole('menuitem', { name: '刷新当前视图', exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menu')).toHaveCount(0)
      }
      if (width === 1440 || width === 390) await page.screenshot({ path: `/tmp/quick-unified-${view}-${width}.png`, fullPage: true })
    }
    if (mobile) {
      await topbar.getByRole('button', { name: '页面选项', exact: true }).click()
      await expect(page.getByRole('menuitem', { name: '刷新当前视图', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
    }
  }
  await page.getByRole('tab', { name: /^管理/ }).click()
  const sourceTabs = page.getByRole('tablist', { name: '管理页面视图' })
  await sourceTabs.getByRole('tab', { name: '来源管理', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(sourceTabs.getByRole('tab', { name: '运行状态', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('desktop reader keeps scrolling inside the feed, including at the page edges', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'desktop reader scroll containment')
  await page.setViewportSize({ width: 1680, height: 740 })
  await mockReader(page)
  await page.route('**/api/v1/feed?**', (route) => route.fulfill({ json: {
    data: Array.from({ length: 40 }, (_, i) => ({ ...rows[0], id: 200 + i, title: `${title} ${i}` })),
    meta: { next_cursor: '' },
  } }))
  await page.goto('/')
  const list = page.locator('.feed-list')
  await expect(list.locator('[data-feed-row]')).toHaveCount(40)
  await expect(page.locator('html')).toHaveCSS('overscroll-behavior-y', 'none')
  await expect(page.locator('body')).toHaveCSS('overflow-y', 'hidden')
  await expect(page.locator('.app-shell')).toHaveCSS('position', 'fixed')
  await list.evaluate((el) => { el.scrollTop = el.scrollHeight })
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await list.hover()
  await page.mouse.wheel(0, 1000)
  await expect.poll(() => page.evaluate(() => {
    const root = document.scrollingElement!
    return { scrollTop: root.scrollTop, overflow: root.scrollHeight - root.clientHeight }
  })).toEqual({ scrollTop: 0, overflow: 0 })
  await page.evaluate(() => {
    window.addEventListener('wheel', (event) => {
      document.documentElement.dataset.lastWheel = `${event.clientX}:${event.defaultPrevented}`
    })
  })
  const topbar = page.locator('.topbar')
  const initialTop = (await topbar.boundingBox())!.y
  for (const x of [10, 1640]) {
    await page.mouse.move(x, 500)
    await page.mouse.wheel(0, 1200)
    await expect(page.locator('html')).toHaveAttribute('data-last-wheel', `${x}:true`)
    expect((await topbar.boundingBox())!.y).toBe(initialTop)
  }
  await list.hover()
  const before = await list.evaluate((el) => el.scrollTop)
  await page.mouse.wheel(0, -160)
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeLessThan(before)
  await page.getByRole('tab', { name: 'AI', exact: true }).click()
  await expect(page.locator('.ai-library-page')).toBeVisible()
  await expect(page.locator('html')).toHaveCSS('overscroll-behavior-y', 'auto')
  await expect(page.locator('.app-shell')).not.toHaveCSS('position', 'fixed')
})

test('pagination action scrolls with the feed and stays in place while loading or retrying', async ({ page }) => {
  await page.addInitScript(() => {
    const Observer = window.IntersectionObserver
    window.IntersectionObserver = class extends Observer {
      observe(target: Element) {
        if (!target.classList.contains('feed-auto-load-sentinel')) super.observe(target)
      }
    }
  })
  await mockReader(page)
  let releasePage!: () => void
  const firstPageAttempt = new Promise<void>((resolve) => { releasePage = resolve })
  let attempts = 0
  await page.route('**/api/v1/feed?**', async (route) => {
    const params = new URL(route.request().url()).searchParams
    if (params.has('since')) return route.fallback()
    if (!params.has('cursor')) {
      return route.fulfill({ json: { data: rows.slice(0, 1), meta: { next_cursor: 'more-articles' } } })
    }
    expect(params.get('cursor')).toBe('more-articles')
    if (++attempts === 1) {
      await firstPageAttempt
      return route.fulfill({ status: 500, json: { error: 'Page temporarily unavailable' } })
    }
    return route.fulfill({ json: { data: rows.slice(1), meta: { next_cursor: '' } } })
  })
  await page.goto('/')
  const list = page.locator('.feed-list')
  const action = list.locator('.feed-load-more-button')
  await expect(action).toHaveText('加载更多')
  const lastRow = (await list.locator('[data-feed-row]').last().boundingBox())!
  expect((await action.boundingBox())!.y).toBeGreaterThanOrEqual(lastRow.y + lastRow.height)
  await action.click()
  await expect(action).toHaveText('正在加载…')
  await expect(action).toBeDisabled()
  releasePage()
  await expect(action).toHaveText('重试')
  await expect(list.locator('[data-feed-row]')).toHaveCount(1)
  await action.click()
  await expect(list.locator('[data-feed-row]')).toHaveCount(2)
  await expect(action).toHaveCount(0)
})

test('desktop split uses the sidebar space for titles and opens sources from its toolbar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'desktop split layout')
  await page.setViewportSize({ width: 1024, height: 800 })
  await mockReader(page)
  await page.goto('/')
  const sidebar = page.locator('.reader-stack > .subscription-sidebar')
  await expect(sidebar).toBeVisible()
  await expect(sidebar).toHaveClass(/\bopen\b/)
  const sourceTrigger = page.getByRole('button', { name: '选择订阅源', exact: true })
  await expect(sourceTrigger).toHaveCount(0)
  await page.locator('[data-feed-row="101"]').click()
  const detail = page.locator('.detail-floating')
  await expect(detail).toBeVisible()
  await expect(sidebar).toBeHidden()
  const feed = page.locator('.feed')
  expect((await feed.boundingBox())!.width).toBe((await page.locator('.reader-stack').boundingBox())!.width)
  const before = await feed.boundingBox()
  const toolbar = page.locator('.feed-header')
  await expect.poll(() => toolbar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
  await sourceTrigger.focus()
  await page.keyboard.press('Enter')
  const sheet = page.getByRole('dialog', { name: '订阅源' })
  await expect(sheet).toBeVisible()
  expect(await feed.boundingBox()).toEqual(before)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(sourceTrigger).toBeFocused()
  await expect(detail).toBeVisible()
  await sourceTrigger.click()
  await sheet.locator('.subscription-item').filter({ hasText: rows[0].source_name }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.locator('.filter-chips')).toContainText(rows[0].source_name)
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
  await expect(sidebar).toBeVisible()
})

test('split reading gives titles space and bounds desktop reading measure', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'desktop split layout')
  await page.setViewportSize({ width: 1920, height: 1080 })
  await mockReader(page)
  await page.goto('/')
  await page.locator('.subscription-item').filter({ hasText: rows[0].source_name }).click()
  await page.locator('.feed-item').filter({ hasText: title }).click()
  const detail = page.locator('.detail-floating')
  await expect(detail).toBeVisible()
  await expect(page.locator('.feed-item-compact-source')).toHaveCount(0)
  const header = await page.locator('.feed-header').boundingBox()
  expect(header!.height).toBeLessThan(40)
  await expect(page.getByRole('combobox', { name: '文章可见范围' })).toBeHidden()
  const queueRow = await page.locator('.feed-item-compact-row').first().boundingBox()
  const queueTitle = await page.locator('.feed-item-inline-title').first().boundingBox()
  expect(queueTitle!.width / queueRow!.width).toBeGreaterThan(0.7)
  const meta = await page.locator('.feed-item-compact-meta').first().boundingBox()
  expect(meta!.y).toBeGreaterThanOrEqual(queueTitle!.y + queueTitle!.height)
  expect(Math.abs(meta!.x - queueTitle!.x)).toBeLessThan(2)
  expect((await page.locator('.feed-item').first().boundingBox())!.height).toBeLessThan(100)
  await expect(page.locator('.feed-item-inline-summary').first()).toBeHidden()
  const body = detail.locator('.html-block')
  const measure = await body.evaluate((el) => {
    const style = getComputedStyle(el)
    return el.clientWidth / Number.parseFloat(style.fontSize)
  })
  expect(measure).toBeLessThanOrEqual(44)
  expect(measure).toBeGreaterThan(30)
  const gap = await body.locator('p').nth(1).evaluate((el) => Number.parseFloat(getComputedStyle(el).marginTop))
  expect(gap).toBeGreaterThan(12)
  expect(gap).toBeLessThan(18)
  await page.screenshot({ path: '/tmp/quick-reader-layout-desktop.png', fullPage: true })
})

test('split transitions anchor the selected article and switching visible rows keeps the queue still', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'desktop split layout')
  await page.setViewportSize({ width: 1440, height: 740 })
  await mockReader(page)
  await page.route('**/api/v1/feed?**', (route) => route.fulfill({ json: {
    data: Array.from({ length: 40 }, (_, i) => i === 18 ? rows[0] : i === 19 ? rows[1] : {
      ...rows[0], id: 200 + i, title: `${i} ${title}`,
    }),
    meta: { next_cursor: '' },
  } }))
  await page.goto('/')
  const row = page.locator('[data-feed-row="101"]')
  const next = page.locator('[data-feed-row="102"]')
  const list = page.locator('.feed-list')
  await expect(row).toBeVisible()
  await row.evaluate((element) => {
    const list = element.closest('.feed-list')!
    list.scrollTop += element.getBoundingClientRect().top - list.getBoundingClientRect().top - 220
  })
  const top = async (item: typeof row) => (await item.boundingBox())!.y
  const beforeOpen = await top(row)
  await row.click()
  await expect(page.locator('.detail-title')).toHaveText(title)
  await expect.poll(async () => Math.abs(await top(row) - beforeOpen)).toBeLessThanOrEqual(2)

  const readScroll = () => list.evaluate((element) => element.scrollTop)
  const beforeSwitch = await readScroll()
  await next.click()
  await expect(page.locator('.detail-title')).toHaveText(rows[1].title)
  expect(await readScroll()).toBe(beforeSwitch)

  const beforeClose = await top(next)
  await page.keyboard.press('Escape')
  await expect(page.locator('.detail-floating')).toHaveCount(0)
  await expect.poll(async () => Math.abs(await top(next) - beforeClose)).toBeLessThanOrEqual(2)
})

test('task queue stays in the topbar and opens without moving the feed', async ({ page }) => {
  await mockReader(page, true)
  await page.goto('/')
  const trigger = page.getByRole('button', { name: /^AI 任务队列/ })
  await expect(trigger).toBeVisible()
  const initialY = (await page.locator('.feed-list').boundingBox())!.y
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'AI 任务队列' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/暂无任务/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await page.locator('.feed-item').first().click()
  await page.route('**/api/v1/articles/101/summary**', (route) => route.fulfill({
    status: 202, contentType: 'application/json', body: JSON.stringify({ data: { status: 'queued', model: 'test', updated_at: now } }),
  }))
  await page.locator('.detail-floating').getByRole('button', { name: '更多', exact: true }).click()
  await page.getByRole('menuitem', { name: '生成 AI 摘要', exact: true }).click()
  await expect(trigger).toHaveAccessibleName(/1 个进行中/)
  await expect(page.locator('.app-shell > .ai-task-strip')).toHaveCount(0)
  await trigger.click()
  await expect(dialog.locator('.ai-task-title')).toHaveText(title)
  await expect(dialog.locator('.ai-task-status')).toHaveText('排队中')
  await dialog.locator('.ai-task-open').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.detail-floating')).toBeVisible()
  await trigger.click()
  await dialog.getByRole('button', { name: '隐藏', exact: true }).click()
  await expect(dialog.getByText(/暂无任务/)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.locator('.detail-floating').getByRole('button', { name: '关闭', exact: true }).click()
  expect((await page.locator('.feed-list').boundingBox())!.y).toBe(initialY)
})

test('split queue scroll stays below the toolbar and reveals selected rows', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'desktop independent queue scroll')
  await page.setViewportSize({ width: 1440, height: 800 })
  await mockReader(page)
  await page.route(/\/api\/v1\/articles\/\d+(?:\/enrichment)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...rows[0], id: Number(new URL(route.request().url()).pathname.split('/')[4]), content_html: `<p>${paragraph}</p>` }) }))
  await page.route('**/api/v1/feed?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    data: Array.from({ length: 40 }, (_, index) => ({ ...rows[0], id: 101 + index, title: `${title} ${index}` })), meta: { next_cursor: '' },
  }) }))
  await page.goto('/')
  await page.locator('.feed-item').first().click()
  const list = page.locator('.feed-list')
  const header = page.locator('.feed-header')
  const headerBefore = await header.boundingBox()
  await list.evaluate((el) => { el.scrollTop = 157 })
  expect((await header.boundingBox())!.y).toBe(headerBefore!.y)
  const bounds = (await list.boundingBox())!
  expect(bounds.y).toBeGreaterThanOrEqual(headerBefore!.y + headerBefore!.height)
  await expect(list).toHaveCSS('clip-path', 'inset(0px)')
  expect(await header.evaluate((el) => {
    const box = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(box.x + 10, box.bottom - 2))
  })).toBe(true)
  await page.locator('.feed-item').filter({ hasText: `${title} 4` }).click()
  const selected = (await page.locator('.feed-item.active').boundingBox())!
  expect(selected.y).toBeGreaterThanOrEqual(bounds.y - 1)
  expect(selected.y + selected.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1)
  await page.screenshot({ path: '/tmp/quick-reader-queue-scroll.png', fullPage: true })
})

test('wide feed uses one toolbar row and consistent sidebar sources', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'desktop sidebar layout')
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockReader(page)
  await page.goto('/')
  const header = page.locator('.feed-header')
  await expect(header).toBeVisible()
  expect((await header.boundingBox())!.height).toBeLessThan(40)
  const channels = await page.locator('.feed-channel-tabs').boundingBox()
  const filters = await page.locator('.feed-view-controls').boundingBox()
  const actions = await page.locator('.feed-header-tools').boundingBox()
  expect(filters!.x).toBeGreaterThan(channels!.x + channels!.width)
  expect(actions!.x).toBeGreaterThan(filters!.x + filters!.width)
  expect(Math.abs(filters!.y - channels!.y)).toBeLessThan(2)
  expect(Math.abs(actions!.y - channels!.y)).toBeLessThan(2)

  const source = page.locator('.subscription-item').filter({ hasText: rows[0].source_name })
  const group = page.locator('.subscription-group-title')
  const rowStyle = (el: Element) => {
    const style = getComputedStyle(el)
    return { height: style.height, background: style.backgroundColor, weight: style.fontWeight, radius: style.borderRadius, font: style.fontSize }
  }
  expect(await group.evaluate(rowStyle)).toEqual(await source.evaluate(rowStyle))
  const expand = page.getByRole('button', { name: '展开 hnrss.org 的订阅源', exact: true })
  await expand.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '收起 hnrss.org 的订阅源', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.subscription-group-items')).toBeVisible()
  await group.click()
  await expect(group).toHaveAttribute('aria-pressed', 'true')
  const groupActive = await group.evaluate(rowStyle)
  await source.click()
  await expect(source).toHaveAttribute('aria-pressed', 'true')
  expect(await source.evaluate(rowStyle)).toEqual(groupActive)
  await page.getByRole('button', { name: '全部来源 3', exact: true }).click()

  const summary = page.locator('.feed-item-inline-summary').first()
  const sizes = await summary.evaluate((el) => ({ summary: Number.parseFloat(getComputedStyle(el).fontSize), title: Number.parseFloat(getComputedStyle(el.closest('h3')!).fontSize) }))
  expect(sizes.summary).toBeLessThan(sizes.title * 0.9)
  await page.screenshot({ path: '/tmp/quick-reader-wide-toolbar.png', fullPage: true })
})

test('compact toolbar remains usable on narrow screens and keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 })
  await mockReader(page)
  await page.goto('/')
  const header = page.locator('.feed-header')
  await expect(header.getByRole('button', { name: 'AI 速览', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '论坛讨论简报', exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  const select = header.getByRole('combobox', { name: '文章可见范围' })
  await select.selectOption('favorite')
  await expect(page.locator('.feed-item')).toHaveCount(0)
  await select.selectOption('all')
  await expect(page.locator('.feed-item')).toHaveCount(2)
  const search = header.getByRole('button', { name: '打开搜索与筛选', exact: true })
  await search.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByPlaceholder('搜索标题/摘要')).toBeVisible()
  await header.getByRole('button', { name: '收起搜索与筛选', exact: true }).click()
  await header.getByRole('button', { name: '更多', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: '切换到标准模式', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.locator('.feed-catch-up')).toBeHidden()
  await page.screenshot({ path: '/tmp/quick-reader-layout-mobile.png', fullPage: true })
  await header.getByRole('button', { name: '论坛观察', exact: true }).click()
  await expect(header.getByRole('button', { name: '论坛讨论简报', exact: true })).toBeVisible()
  await expect.poll(() => header.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
})

test('reader chrome maximizes list height without hiding navigation or refresh', async ({ page }, testInfo) => {
  await mockReader(page, true)
  await page.setViewportSize({ width: testInfo.project.name.startsWith('mobile-') ? 320 : 1440, height: 800 })
  await page.goto('/')
  const topbar = page.locator('.topbar-unified')
  await expect(topbar).toBeVisible()
  expect((await topbar.boundingBox())!.height).toBeLessThan(48)
  await expect(page.getByRole('tab', { name: '阅读流', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'AI', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: /管理/ })).toBeVisible()
  await expect(page.locator('.feed-catch-up')).toBeHidden()
  const list = await page.locator('.feed-list').boundingBox()
  expect(list!.y).toBeLessThan(testInfo.project.name.startsWith('mobile-') ? 140 : 100)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  if (testInfo.project.name.startsWith('mobile-')) {
    const options = page.getByRole('button', { name: '页面选项', exact: true })
    await options.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText('模型：test', { exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '退出管理', exact: true })).toBeVisible()
    const refresh = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/v1/sources')
    await page.getByRole('menuitem', { name: '刷新当前视图', exact: true }).click()
    await refresh
  } else {
    await expect(topbar.getByRole('button', { name: '刷新', exact: true })).toBeVisible()
    await expect(page.locator('.feed-list')).toHaveCSS('overflow-y', 'auto')
    await topbar.getByRole('button', { name: '刷新', exact: true }).click()
  }
  await expect(page.locator('.notice')).toBeVisible()
  await expect(page.getByRole('button', { name: '关闭通知', exact: true })).toBeVisible()
  expect((await page.locator('.feed-list').boundingBox())!.y).toBe(list!.y)
  await page.screenshot({ path: `/tmp/quick-reader-top-aligned-${testInfo.project.name}.png`, fullPage: true })
  await page.getByRole('tab', { name: 'AI', exact: true }).click()
  await expect(page.locator('.topbar-unified')).toBeVisible()
  await expect(page.getByRole('heading', { name: '每日 AI 简报', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '阅读流', exact: true }).click()
  await expect(page.locator('.topbar-unified')).toBeVisible()
})

test('split forum keeps one operation row and exposes reading states in its menu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile-'), 'desktop split layout')
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockReader(page)
  await page.goto('/')
  await page.getByRole('group', { name: '阅读频道', exact: true }).getByRole('button', { name: '论坛观察', exact: true }).click()
  await page.locator('.feed-item').filter({ hasText: title }).click()
  const detail = page.locator('.detail-floating')
  await expect(detail).toBeVisible()
  await expect(detail.locator('.html-block')).toBeVisible()
  const header = page.locator('.feed-header')
  await expect(page.getByRole('button', { name: '标签: forum ×', exact: true })).toHaveCount(0)
  await expect(page.locator('.filter-chips')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '文章可见范围' })).toBeHidden()
  const headerBounds = await header.boundingBox()
  const listBounds = await page.locator('.feed-list').boundingBox()
  expect(headerBounds!.height).toBeLessThan(40)
  expect(listBounds!.y - headerBounds!.y - headerBounds!.height).toBeLessThan(12)
  await page.screenshot({ path: '/tmp/quick-reader-forum-single-toolbar.png', fullPage: true })

  const more = header.getByRole('button', { name: '更多', exact: true })
  await more.click()
  await expect(page.getByRole('menuitemradio', { name: '全部阅读状态', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: /^未读 / }).click()
  await expect(detail).toBeVisible()
  await expect(page.locator('.feed-active-reading-filter').getByRole('button', { name: '仅未读 ×', exact: true })).toBeVisible()
  await expect(page.locator('.filter-chips')).toHaveCount(0)
  await more.click()
  await expect(page.getByRole('menuitemradio', { name: /^未读 / })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: /^收藏 / }).click()
  await expect(detail).toBeVisible()
  await expect(page.locator('.feed-active-reading-filter').getByRole('button', { name: '仅收藏 ×', exact: true })).toBeVisible()
  await page.locator('.feed-active-reading-filter').getByRole('button', { name: '仅收藏 ×', exact: true }).click()
  await expect(page.locator('.feed-active-reading-filter')).toHaveCount(0)
  await more.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitemradio', { name: '全部阅读状态', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(detail).toBeVisible()

  await header.getByRole('button', { name: '打开搜索与筛选', exact: true }).click()
  await expect(detail).toBeVisible()
  const input = page.getByPlaceholder('搜索标题/摘要')
  await input.fill('芯片')
  await input.press('Enter')
  await expect(page.getByRole('button', { name: '关键词: 芯片 ×', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '标签: forum ×', exact: true })).toHaveCount(0)
})
