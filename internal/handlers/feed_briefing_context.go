package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"

	"quick/internal/models"
	"quick/internal/textclean"
)

const (
	maxBriefingDeepReads    = 6
	maxBriefingContextRunes = 1200
)

const briefingSelectionSystemPrompt = `你是个人阅读器的选稿助手。只从给定候选中选择最值得深入阅读的文章，兼顾重要性、新信息、论证质量、经验密度和来源差异。相同事件只有在不同来源提供实质新增信息时才同时保留。严格只输出 JSON，例如 {"ids":["A03","A07"]}，不要输出解释或 Markdown。`

type briefingSelection struct {
	IDs []string `json:"ids"`
}

func (h *FeedHandler) prepareBriefingRows(ctx context.Context, rows []feedItem, model string) ([]feedItem, error) {
	selected := rows
	if len(rows) > maxBriefingDeepReads {
		result, err := h.summarizer.CompleteWithModel(ctx, briefingSelectionSystemPrompt, buildBriefingSelectionPrompt(rows), model)
		if err != nil {
			log.Printf("ai briefing candidate selection failed; using newest candidates: %v", err)
			selected = selectBriefingRows(rows, nil, maxBriefingDeepReads)
		} else {
			selected = selectBriefingRows(rows, parseBriefingSelection(result.Summary), maxBriefingDeepReads)
		}
	}
	if err := h.enrichBriefingRowsFromCache(ctx, selected); err != nil {
		return nil, fmt.Errorf("load briefing reading context: %w", err)
	}
	return selected, nil
}

func buildBriefingSelectionPrompt(rows []feedItem) string {
	var builder strings.Builder
	builder.WriteString("从候选中选择 6 篇用于最终速览。不要只按时间排序，也不要选择纯重复转载。候选如下：\n")
	for index, row := range rows {
		builder.WriteString(fmt.Sprintf(
			"[A%02d] [%s/%s] %s\n摘要: %s\n",
			index+1,
			textclean.NormalizeInline(row.SourceName),
			textclean.NormalizeInline(row.SourceTag),
			textclean.NormalizeInline(row.Title),
			briefingSnippet(row),
		))
	}
	return builder.String()
}

func parseBriefingSelection(raw string) []int {
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return nil
	}
	var selection briefingSelection
	if err := json.Unmarshal([]byte(raw[start:end+1]), &selection); err != nil {
		return nil
	}
	indices := make([]int, 0, len(selection.IDs))
	seen := make(map[int]struct{}, len(selection.IDs))
	for _, id := range selection.IDs {
		normalized := strings.TrimSpace(strings.TrimPrefix(strings.ToUpper(id), "A"))
		value, err := strconv.Atoi(normalized)
		index := value - 1
		if err != nil || index < 0 {
			continue
		}
		if _, exists := seen[index]; exists {
			continue
		}
		seen[index] = struct{}{}
		indices = append(indices, index)
	}
	return indices
}

func selectBriefingRows(rows []feedItem, indices []int, limit int) []feedItem {
	if limit <= 0 || limit > len(rows) {
		limit = len(rows)
	}
	selected := make([]feedItem, 0, limit)
	selectedIndices := make(map[int]struct{}, limit)
	for _, index := range indices {
		if index < 0 || index >= len(rows) {
			continue
		}
		if _, exists := selectedIndices[index]; exists {
			continue
		}
		selectedIndices[index] = struct{}{}
		selected = append(selected, rows[index])
		if len(selected) == limit {
			return selected
		}
	}
	for index := range rows {
		if _, exists := selectedIndices[index]; exists {
			continue
		}
		selected = append(selected, rows[index])
		if len(selected) == limit {
			break
		}
	}
	return selected
}

func (h *FeedHandler) enrichBriefingRowsFromCache(ctx context.Context, rows []feedItem) error {
	articleIDs := feedItemIDs(rows)
	if len(articleIDs) == 0 {
		return nil
	}
	var enrichments []models.ArticleEnrichment
	if err := h.db.WithContext(ctx).Where("article_id IN ?", articleIDs).Find(&enrichments).Error; err != nil {
		return err
	}
	byArticleID := make(map[uint64]models.ArticleEnrichment, len(enrichments))
	for _, enrichment := range enrichments {
		byArticleID[enrichment.ArticleID] = enrichment
	}
	for index := range rows {
		chunks := make([]string, 0, 3)
		if rows[index].Content != nil {
			chunks = appendUniqueBriefingChunk(chunks, *rows[index].Content)
		}
		enrichment, exists := byArticleID[rows[index].ID]
		if exists && len(enrichment.External) > 0 {
			var external articleExternalContent
			if json.Unmarshal(enrichment.External, &external) == nil {
				chunks = appendUniqueBriefingChunk(chunks, external.Content)
			}
		}
		if exists && len(enrichment.Thread) > 0 {
			var thread articleThread
			if json.Unmarshal(enrichment.Thread, &thread) == nil {
				chunks = appendUniqueBriefingChunk(chunks, thread.FullContent)
			}
		}
		if len(chunks) > 0 {
			content := strings.Join(chunks, "\n\n")
			rows[index].Content = &content
		}
	}
	return nil
}

func appendUniqueBriefingChunk(chunks []string, raw string) []string {
	text := textclean.NormalizeFromHTML(raw)
	if text == "" {
		return chunks
	}
	for _, existing := range chunks {
		if existing == text {
			return chunks
		}
	}
	return append(chunks, text)
}

func briefingThinkingContext(item feedItem) string {
	if item.Content != nil {
		if content := textclean.NormalizeFromHTML(*item.Content); content != "" {
			return truncateFeedText(content, maxBriefingContextRunes)
		}
	}
	return briefingSnippet(item)
}

func feedItemIDs(rows []feedItem) []uint64 {
	ids := make([]uint64, 0, len(rows))
	for _, row := range rows {
		if row.ID != 0 {
			ids = append(ids, row.ID)
		}
	}
	return ids
}
