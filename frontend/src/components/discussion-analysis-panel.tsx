import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MarkdownBlock } from '@/components/rich-content-blocks'
import { analyzeDiscussion, getDiscussionAnalysis } from '../api'
import type { ArticleDetail, DiscussionAnalysis } from '../types'

function isDiscussion(article: ArticleDetail) {
  if (article.source_tag === 'forum' || article.thread) return true
  return [article.link, article.raw_guid].some(link => {
    if (!link) return false
    try {
      const u = new URL(link)
      return ['v2ex.com','www.v2ex.com','news.ycombinator.com','nga.178.com','bbs.nga.cn','ngabbs.com','bbs.ngacn.cc','www.uscardforum.com','uscardforum.com','reddit.com','www.reddit.com','old.reddit.com'].includes(u.hostname)
    } catch { return false }
  })
}
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve,reject) => {
    const abort = () => {window.clearTimeout(timer);reject(new DOMException('Aborted','AbortError'))}
    const timer = window.setTimeout(() => {signal.removeEventListener('abort',abort);resolve()},1500)
    signal.addEventListener('abort',abort,{once:true})
    if (signal.aborted) abort()
  })
}
function localTime(value?: string) {
  if (!value) return '时间未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})
}

export function DiscussionAnalysisPanel({article}: {article: ArticleDetail}) {
  if (!isDiscussion(article) || article.id <= 0) return null
  return <DiscussionAnalysisBody key={article.id} articleID={article.id} />
}
function DiscussionAnalysisBody({articleID}: {articleID: number}) {
  const [analysis,setAnalysis] = useState<DiscussionAnalysis | null>(null)
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')
  const request = useRef(0)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => {request.current++;active.current?.abort()},[])
  async function run(refresh = false) {
    const requestID = ++request.current
    active.current?.abort()
    const controller = new AbortController(); active.current = controller
    setLoading(true);setError('')
    try {
      let response = await analyzeDiscussion(articleID,refresh,controller.signal)
      for (let attempt=0;attempt<120;attempt++) {
        if (requestID !== request.current) return
        const data = response.data
        if (data.status === 'failed') throw new Error(data.error || '分析未完成，请重试。')
        if (data.status === 'succeeded' && data.analysis) {
          if (data.analysis.article_id !== articleID) throw new Error('分析结果与当前帖子不一致，请重试。')
          setAnalysis(data.analysis);return
        }
        if (!data.task_key) throw new Error('分析任务未就绪，请重试。')
        await pause(controller.signal)
        response = await getDiscussionAnalysis(articleID,data.task_key,controller.signal)
      }
      throw new Error('分析仍在后台进行，稍后可再次点击查看。')
    } catch (e) {
      if (requestID === request.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (requestID === request.current) setLoading(false)
    }
  }
  return <section className="ai-summary-card detail-section" aria-label="讨论分析">
    <div className="ai-summary-card-head">
      <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void run()}><Sparkles aria-hidden="true" />{loading ? '正在分析讨论…' : '为什么讨论激烈'}</Button>
      {analysis && <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => void run(true)}>更新分析</Button>}
    </div>
    {!analysis && !loading && !error && <p className="hint">按需分析争论焦点、各方观点与冲突原因；仅依据实际读取的回复。</p>}
    {loading && <p className="hint" role="status">正在读取回复样本并分析，请稍候。</p>}
    {error && <p className="hint" role="alert">{error}</p>}
    {analysis && <>
      <h4>为什么讨论激烈</h4>
      <p className="hint">接口返回 {analysis.sample.available_replies} 条有效回复 · 本次分析 {analysis.sample.analyzed_replies} 条{analysis.sample.reported_total_replies != null ? ` · 来源记录总回复 ${analysis.sample.reported_total_replies} 条（可能滞后）` : ' · 源站总回复数未知'}</p>
      <p className="hint">样本读取：{localTime(analysis.sample.read_at)} · 分析生成：{localTime(analysis.generated_at)} · {analysis.model}{analysis.cache_hit ? ' · 已复用缓存' : ''}</p>
      <p className="hint">{analysis.sample.method} 仅为部分回复样本，不代表完整讨论或社区立场。</p>
      {analysis.sample.first_reply_at && <p className="hint">所选回复时间范围：{localTime(analysis.sample.first_reply_at)}—{localTime(analysis.sample.last_reply_at)}{analysis.sample.dated_replies < analysis.sample.analyzed_replies ? '（部分回复时间缺失）' : ''}</p>}
      <MarkdownBlock content={analysis.summary} />
      <details><summary>查看本次分析的 {analysis.references.length} 条回复依据</summary>
        <ol>{analysis.references.map(ref => <li key={ref.id}>
          <a href={ref.link} target="_blank" rel="noreferrer">回复 {ref.id} · {ref.author || '未知作者'}</a>
          {ref.upvotes != null && <span> · 赞 {ref.upvotes}</span>}
          <p>{ref.excerpt}</p>
        </li>)}</ol>
      </details>
    </>}
  </section>
}
