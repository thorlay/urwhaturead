export function sortThreadCommentsByUpvotes<T extends { upvotes?: number | null }>(comments: readonly T[]): T[] {
  const score = (comment: T) => typeof comment.upvotes === 'number' && Number.isFinite(comment.upvotes) ? comment.upvotes : -Infinity
  return comments.map((comment, index) => ({ comment, index }))
    .sort((left, right) => {
      const a = score(left.comment)
      const b = score(right.comment)
      return a === b ? left.index - right.index : a > b ? -1 : 1
    })
    .map(({ comment }) => comment)
}
