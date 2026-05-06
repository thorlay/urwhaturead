import type { Dispatch, SetStateAction } from 'react'
import type { ReaderWorkspaceProps } from '@/components/reader-workspace'

type DetailProps = ReaderWorkspaceProps['detailProps']

type UseReaderWorkspaceDetailPropsParams = {
  floatingDetailRef: DetailProps['floatingDetailRef']
  showFloatingReader: DetailProps['showFloatingReader']
  readerView: DetailProps['readerView']
  selectedArticle: DetailProps['selectedArticle']
  selectedFeedBriefing: DetailProps['selectedFeedBriefing']
  loadingArticle: DetailProps['loadingArticle']
  articleError: DetailProps['articleError']
  selectedArticleID: DetailProps['selectedArticleID']
  onOpenArticle: DetailProps['openArticle']
  feedBriefingScopeLabel: DetailProps['feedBriefingScopeLabel']
  feedBriefingFreshnessLabel: DetailProps['feedBriefingFreshnessLabel']
  returnToReaderStream: DetailProps['returnToReaderStream']
  closeFloatingReader: DetailProps['closeFloatingReader']
  openImmersiveReader: DetailProps['openImmersiveReader']
  aiModel: DetailProps['aiModel']
  onGenerateFeedBriefing: DetailProps['onGenerateFeedBriefing']
  loadingFeedBriefing: DetailProps['loadingFeedBriefing']
  feedBriefingMeta: DetailProps['feedBriefingMeta']
  feedBriefingNewArticleCount: DetailProps['feedBriefingNewArticleCount']
  feedBriefingError: DetailProps['feedBriefingError']
  feedBriefing: DetailProps['feedBriefing']
  feedBriefingItems: DetailProps['feedBriefingItems']
  feedBriefingArticleCount: DetailProps['feedBriefingArticleCount']
  formatTimeAgo: DetailProps['formatTimeAgo']
  selectedArticleReplyCountLabel: DetailProps['selectedArticleReplyCountLabel']
  selectedArticleImageURL: DetailProps['selectedArticleImageURL']
  closeDetailMoreMenu: DetailProps['closeDetailMoreMenu']
  onSummarizeArticle: DetailProps['onSummarizeArticle']
  loadingArticleSummary: DetailProps['loadingArticleSummary']
  hasDetailMoreActions: DetailProps['hasDetailMoreActions']
  detailMoreMenuRef: DetailProps['detailMoreMenuRef']
  showDetailMoreMenu: DetailProps['showDetailMoreMenu']
  toggleDetailMoreMenu: DetailProps['toggleDetailMoreMenu']
  canTrackThread: DetailProps['canTrackThread']
  onTrackThread: DetailProps['onTrackThread']
  canForceRecalcSummary: DetailProps['canForceRecalcSummary']
  articleSummaryError: DetailProps['articleSummaryError']
  articleSummary: DetailProps['articleSummary']
  articleSummaryMeta: DetailProps['articleSummaryMeta']
  selectedSummaryTask: DetailProps['selectedSummaryTask']
  isThreadArticle: DetailProps['isThreadArticle']
  threadPrimaryBody: DetailProps['threadPrimaryBody']
  visibleThreadComments: DetailProps['visibleThreadComments']
  threadComments: DetailProps['threadComments']
  threadCommentsNewestFirst: DetailProps['threadCommentsNewestFirst']
  threadPreviewCommentLimit: DetailProps['threadPreviewCommentLimit']
  expandedThreadComments: DetailProps['expandedThreadComments']
  hasHiddenThreadComments: DetailProps['hasHiddenThreadComments']
  setThreadCommentsNewestFirst: Dispatch<SetStateAction<boolean>>
  setExpandedThreadComments: Dispatch<SetStateAction<boolean>>
}

export function useReaderWorkspaceDetailProps(
  params: UseReaderWorkspaceDetailPropsParams,
): DetailProps {
  return {
    floatingDetailRef: params.floatingDetailRef,
    showFloatingReader: params.showFloatingReader,
    readerView: params.readerView,
    selectedArticle: params.selectedArticle,
    selectedFeedBriefing: params.selectedFeedBriefing,
    loadingArticle: params.loadingArticle,
    articleError: params.articleError,
    selectedArticleID: params.selectedArticleID,
    openArticle: params.onOpenArticle,
    feedBriefingScopeLabel: params.feedBriefingScopeLabel,
    feedBriefingFreshnessLabel: params.feedBriefingFreshnessLabel,
    returnToReaderStream: params.returnToReaderStream,
    closeFloatingReader: params.closeFloatingReader,
    openImmersiveReader: params.openImmersiveReader,
    aiModel: params.aiModel,
    onGenerateFeedBriefing: params.onGenerateFeedBriefing,
    loadingFeedBriefing: params.loadingFeedBriefing,
    feedBriefingMeta: params.feedBriefingMeta,
    feedBriefingNewArticleCount: params.feedBriefingNewArticleCount,
    feedBriefingError: params.feedBriefingError,
    feedBriefing: params.feedBriefing,
    feedBriefingItems: params.feedBriefingItems,
    feedBriefingArticleCount: params.feedBriefingArticleCount,
    formatTimeAgo: params.formatTimeAgo,
    selectedArticleReplyCountLabel: params.selectedArticleReplyCountLabel,
    selectedArticleImageURL: params.selectedArticleImageURL,
    closeDetailMoreMenu: params.closeDetailMoreMenu,
    onSummarizeArticle: params.onSummarizeArticle,
    loadingArticleSummary: params.loadingArticleSummary,
    hasDetailMoreActions: params.hasDetailMoreActions,
    detailMoreMenuRef: params.detailMoreMenuRef,
    showDetailMoreMenu: params.showDetailMoreMenu,
    toggleDetailMoreMenu: params.toggleDetailMoreMenu,
    canTrackThread: params.canTrackThread,
    onTrackThread: params.onTrackThread,
    canForceRecalcSummary: params.canForceRecalcSummary,
    articleSummaryError: params.articleSummaryError,
    articleSummary: params.articleSummary,
    articleSummaryMeta: params.articleSummaryMeta,
    selectedSummaryTask: params.selectedSummaryTask,
    isThreadArticle: params.isThreadArticle,
    threadPrimaryBody: params.threadPrimaryBody,
    visibleThreadComments: params.visibleThreadComments,
    threadComments: params.threadComments,
    threadCommentsNewestFirst: params.threadCommentsNewestFirst,
    onToggleThreadCommentsNewestFirst: () => params.setThreadCommentsNewestFirst((value) => !value),
    threadPreviewCommentLimit: params.threadPreviewCommentLimit,
    expandedThreadComments: params.expandedThreadComments,
    onToggleExpandedThreadComments: () => params.setExpandedThreadComments((value) => !value),
    hasHiddenThreadComments: params.hasHiddenThreadComments,
  }
}
