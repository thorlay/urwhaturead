export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\n{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function previewText(input: string, max = 180): string {
  const plain = stripMarkdown(input)
  if (plain.length <= max) return plain
  return `${plain.slice(0, max).trimEnd()}…`
}

export function extractBriefingLead(summary: string): string {
  const lines = summary
    .split('\n')
    .map((line) => stripMarkdown(line).trim())
    .filter(Boolean)
    .filter((line) => !/^(?:\d+[).、]\s*)?(?:今日判断|今日概览|今日聚合速览|每日简报|优先阅读|先看这个|内容类型|重点主题|主要线索|观点与讨论|风险|争议|不确定性)$/.test(line))
  return previewText((lines[0] ?? summary).replace(/\s*\[A\d{1,3}\]/g, ''), 180)
}
