import { expect, test } from '@playwright/test'
import { createFeedQuery, type FeedScope } from '../../src/lib/feed-query'
import type { FeedItem, FeedResponse } from '../../src/types'

const scope: FeedScope = { mode: 'all', sourceID: '', tag: '', keyword: '', includeHidden: false }
function item(id: number, sourceID = 1): FeedItem {
  return { id, source_id: sourceID, title: `Article ${id}`, source_name: `Source ${sourceID}`,
    source_tag: 'tech', link: `https://example.com/${id}`, created_at: '2026-11-12T12:00:00Z' }
}
function page(items: FeedItem[], cursor = ''): FeedResponse {
  return { data: items, meta: { limit: 20, count: items.length, next_cursor: cursor } }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('feed query: fast filter changes discard old success, error and loading state', async () => {
  const older = deferred<FeedResponse>()
  const middle = deferred<FeedResponse>()
  const latest = deferred<FeedResponse>()
  const query = createFeedQuery(({ keyword }) => keyword === 'older' ? older.promise : keyword === 'middle' ? middle.promise : latest.promise)
  const first = query.replace({ ...scope, keyword: 'older' })
  const second = query.replace({ ...scope, keyword: 'middle' })
  const third = query.replace({ ...scope, keyword: 'latest' })
  older.resolve(page([item(1)], 'old-cursor'))
  middle.reject(new Error('obsolete failure'))
  await Promise.all([first, second])
  expect(query.getSnapshot()).toMatchObject({ loading: true, error: null, cursor: '', scope: { keyword: 'latest' } })
  latest.resolve(page([item(3)], 'latest-cursor'))
  await third
  expect(query.getSnapshot().items.map((row) => row.id)).toEqual([3])
  expect(query.getSnapshot()).toMatchObject({ loading: false, error: null, cursor: 'latest-cursor' })
})

test('feed query: source switching rejects a late page and binds new pagination to its own cursor', async () => {
  const oldPage = deferred<FeedResponse>()
  const requests: Array<{ sourceID: string; cursor?: string }> = []
  const query = createFeedQuery(async (request) => {
    requests.push(request)
    if (request.sourceID === '1') return request.cursor ? oldPage.promise : page([item(1)], 'source-1-next')
    return request.cursor ? page([item(3, 2)]) : page([item(2, 2)], 'source-2-next')
  })
  await query.replace({ ...scope, sourceID: '1' })
  const pending = query.loadMore()
  await Promise.resolve()
  await query.replace({ ...scope, sourceID: '2' })
  oldPage.resolve(page([item(99)], 'obsolete-next'))
  await pending
  await query.loadMore()
  expect(query.getSnapshot().items.map((row) => row.id)).toEqual([2, 3])
  expect(requests.at(-1)).toMatchObject({ sourceID: '2', cursor: 'source-2-next' })
})

test('feed query: duplicate loads in the same turn share one request and overlapping pages deduplicate IDs', async () => {
  const firstPage = deferred<FeedResponse>()
  const nextPage = deferred<FeedResponse>()
  let requests = 0
  const query = createFeedQuery(() => ++requests === 1 ? firstPage.promise : nextPage.promise)
  const first = query.replace({ ...scope, sourceID: '2,1,2', keyword: ' test ' })
  const duplicate = query.replace({ ...scope, sourceID: '1,2', keyword: 'test' })
  expect(first).toBe(duplicate)
  firstPage.resolve(page([item(1), item(1)], 'next'))
  await Promise.all([first, duplicate])
  const more = query.loadMore()
  const duplicateMore = query.loadMore()
  nextPage.resolve(page([item(1), item(2), item(2)]))
  await Promise.all([more, duplicateMore])
  expect(requests).toBe(2)
  expect(query.getSnapshot().items.map((row) => row.id)).toEqual([1, 2])
})

test('feed query: first-page and pagination failures retry the same applied query and cursor', async () => {
  const requests: Array<{ keyword: string; cursor?: string }> = []
  const query = createFeedQuery(async (request) => {
    requests.push(request)
    if (requests.length === 1 || requests.length === 3) throw new Error('temporary failure')
    return request.cursor ? page([item(2)]) : page([item(1)], 'retry-next')
  })
  expect(await query.replace({ ...scope, keyword: 'applied' })).toBe('temporary failure')
  await query.retry()
  expect(query.getSnapshot().cursor).toBe('retry-next')
  await query.loadMore()
  expect(query.getSnapshot()).toMatchObject({ loading: false, cursor: 'retry-next', error: 'temporary failure' })
  expect(query.getSnapshot().items.map((row) => row.id)).toEqual([1])
  await query.retry()
  expect(requests.map(({ keyword, cursor }) => [keyword, cursor])).toEqual([
    ['applied', ''], ['applied', ''], ['applied', 'retry-next'], ['applied', 'retry-next'],
  ])
  expect(query.getSnapshot().items.map((row) => row.id)).toEqual([1, 2])
  expect(query.getSnapshot()).toMatchObject({ error: null, cursor: '' })
})

test('feed query: background updates only set a count until explicitly applied', async () => {
  let calls = 0
  const query = createFeedQuery(async () => ++calls === 1 ? page([item(1)], 'next') : page([item(2), item(2), item(1)], 'new-next'))
  await query.replace(scope)
  const before = query.getSnapshot().items
  await query.checkUpdates()
  expect(query.getSnapshot().items).toBe(before)
  expect(query.getSnapshot()).toMatchObject({ pendingCount: 1, cursor: 'next' })
  await query.refresh()
  expect(query.getSnapshot().items.map((row) => row.id)).toEqual([2, 1])
  expect(query.getSnapshot()).toMatchObject({ pendingCount: 0, cursor: 'new-next' })
})

test('feed query: old background checks cannot set the new query count or spinner', async () => {
  const probe = deferred<FeedResponse>()
  let calls = 0
  const query = createFeedQuery(async () => ++calls === 2 ? probe.promise : page([item(calls)]))
  await query.replace(scope)
  const checking = query.checkUpdates()
  await Promise.resolve()
  await query.replace({ ...scope, keyword: 'new scope' })
  probe.resolve(page([item(100)]))
  await checking
  expect(query.getSnapshot()).toMatchObject({ pendingCount: 0, checkingUpdates: false, scope: { keyword: 'new scope' } })
  expect(query.getSnapshot().items.map((row) => row.id)).toEqual([3])
})

test('feed query: an unchanged pagination cursor terminates automatic loading', async () => {
  const query = createFeedQuery(async () => page([item(1)], 'same-cursor'))
  await query.replace(scope)
  await query.loadMore()
  expect(query.getSnapshot().cursor).toBe('')
})

test('forum query: reply changes and expired topics prompt an update without replacing reading rows', async () => {
  let calls = 0
  const original = [{...item(1),reply_count:30},{...item(2),reply_count:40}]
  const updated = [{...item(1),reply_count:35}]
  const query = createFeedQuery(async () => ++calls === 1 ? page(original) : page(updated))
  await query.replace({...scope,channel:'forum',tag:'forum'})
  const before = query.getSnapshot().items
  await query.checkUpdates()
  expect(query.getSnapshot().items).toBe(before)
  expect(query.getSnapshot().pendingCount).toBe(2)
  await query.refresh()
  expect(query.getSnapshot().items).toEqual(updated)
  expect(query.getSnapshot().pendingCount).toBe(0)
})

test('forum query: an empty discussion list still checks for newly eligible topics', async () => {
  let calls = 0
  const query = createFeedQuery(async () => ++calls === 1 ? page([]) : page([{...item(1),reply_count:20}]))
  await query.replace({...scope,channel:'forum',tag:'forum'})
  await query.checkUpdates()
  expect(query.getSnapshot().pendingCount).toBe(1)
})
