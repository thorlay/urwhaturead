import { useMemo } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PlainTextBlock } from '@/components/rich-content-blocks'
import { sortThreadCommentsByUpvotes } from '../lib/thread-comment-sort'
import type { ArticleDetail } from '../types'

type Thread = NonNullable<ArticleDetail['thread']>

export type ReaderArticleCommentsProps = {
  visibleThreadComments: Thread['comments']
  threadComments: Thread['comments']
  threadCommentsNewestFirst: boolean
  onToggleThreadCommentsNewestFirst: () => void
  threadPreviewCommentLimit: number
  expandedThreadComments: boolean
  onToggleExpandedThreadComments: () => void
  formatTimeAgo: (input: string) => string
  thread: ArticleDetail['thread']
  sortByVotes: boolean
  onResetVoteSort: () => void
  onSortByVotes: () => void
}

export function ReaderArticleComments({
  thread,
  visibleThreadComments,
  threadComments,
  threadCommentsNewestFirst,
  onToggleThreadCommentsNewestFirst,
  threadPreviewCommentLimit,
  expandedThreadComments,
  onToggleExpandedThreadComments,
  formatTimeAgo,
  sortByVotes,
  onResetVoteSort,
  onSortByVotes,
}: ReaderArticleCommentsProps) {
  const hasCommentVotes = threadComments.some((comment) => typeof comment.upvotes === 'number')
  const rankedThreadComments = useMemo(() => sortThreadCommentsByUpvotes(threadComments), [threadComments])
  const displayedThreadComments = sortByVotes
    ? expandedThreadComments ? rankedThreadComments : rankedThreadComments.slice(0, threadPreviewCommentLimit)
    : visibleThreadComments

  if (!thread || threadComments.length === 0) return null

  return (
    <section className="thread-section detail-section">
      <div className="thread-header">
        <h4>讨论 · {threadComments.length} 条回复</h4>
        <div className="thread-header-tools">
          {threadComments.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="thread-order-toggle"
              aria-pressed={!sortByVotes}
              onClick={() => {
                onResetVoteSort()
                if (!sortByVotes) onToggleThreadCommentsNewestFirst()
              }}
            >
              {threadCommentsNewestFirst ? '最新在前' : '最早在前'}
            </Button>
          )}
          {hasCommentVotes && threadComments.length > 1 && (
            <Button type="button" variant="outline" size="sm" className="thread-order-toggle" aria-pressed={sortByVotes} onClick={onSortByVotes}>
              按赞数排序
            </Button>
          )}
        </div>
      </div>
      {thread.feed_url?.includes('/nga/post/') && <p className="hint">这里展示已获取的部分回复，完整讨论可打开原帖查看。</p>}

      {threadComments.length > 0 && (
        <>
          <div className="thread-comments">
            {displayedThreadComments.map((comment) => (
              <article key={`${comment.link}-${threadComments.indexOf(comment)}`} className="thread-comment">
                <p className="thread-comment-meta">
                  #{comment.post_number || threadComments.indexOf(comment) + 2} · {comment.author || 'unknown'} ·{' '}
                  {comment.published_at ? formatTimeAgo(comment.published_at) : '-'}
                  {typeof comment.upvotes === 'number' && <span aria-label={`赞数 ${comment.upvotes}`}> · 赞 {comment.upvotes}</span>}
                </p>
                <PlainTextBlock content={comment.content} className="reading-block" />
              </article>
            ))}
          </div>
          {threadComments.length > threadPreviewCommentLimit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="comment-toggle"
              onClick={onToggleExpandedThreadComments}
            >
              {expandedThreadComments ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              {expandedThreadComments ? '收起评论' : `查看全部评论（${threadComments.length}）`}
            </Button>
          )}
        </>
      )}

      {thread.truncated && <p className="hint">评论过多，仅展示前 120 条。</p>}
    </section>
  )
}
