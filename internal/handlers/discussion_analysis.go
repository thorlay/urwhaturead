package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"quick/internal/aisummary"
	"quick/internal/aitask"
	"quick/internal/models"
)

type discussionAnalysisPayload struct {
	ArticleID   uint64                `json:"article_id"`
	Summary     string                `json:"summary"`
	Model       string                `json:"model"`
	GeneratedAt time.Time             `json:"generated_at"`
	Sample      discussionSample      `json:"sample"`
	References  []discussionReference `json:"references"`
	CacheHit    bool                  `json:"cache_hit"`
}
type discussionAnalysisService struct {
	db      *gorm.DB
	client  *aisummary.Client
	tasks   *aitask.Service
	limiter *briefingRateLimiter
}

func newDiscussionAnalysisService(db *gorm.DB, client *aisummary.Client) *discussionAnalysisService {
	s := &discussionAnalysisService{db: db, client: client, limiter: newBriefingRateLimiter(10, time.Hour)}
	if db != nil && client != nil {
		s.tasks = aitask.NewService(db, aitask.Options{Kind: "discussion_analysis", Concurrency: 2, Timeout: 3 * time.Minute, RecoveryAge: 24 * time.Hour, RecoveryLimit: 50, Runner: s.run})
	}
	return s
}
func (s *discussionAnalysisService) run(ctx context.Context, task aitask.Task) error {
	var input discussionInput
	if json.Unmarshal([]byte(task.Payload), &input) != nil || input.ArticleID != task.ResourceID || len(input.References) < 2 {
		return fmt.Errorf("invalid discussion analysis input")
	}
	prompt := buildDiscussionPrompt(input, s.client.InputByteLimit())
	if len(prompt) > s.client.InputByteLimit() {
		return fmt.Errorf("回复引用超出输入预算，未生成分析")
	}
	result, err := s.client.CompleteWithModel(ctx, discussionSystemPrompt, prompt, input.Model)
	if err != nil {
		return err
	}
	if result.Truncated {
		return fmt.Errorf("分析未完整生成，请重试")
	}
	summary, err := renderDiscussionJudgment(result.Summary, input)
	if err != nil {
		return err
	}
	output := discussionAnalysisPayload{ArticleID: input.ArticleID, Summary: summary, Model: result.Model, GeneratedAt: time.Now().UTC(), Sample: input.Sample, References: input.References}
	raw, _ := json.Marshal(output)
	hash := strings.TrimPrefix(task.Key, discussionTaskPrefix(input.ArticleID))
	row := models.DiscussionAnalysis{ArticleID: input.ArticleID, BaseRevision: input.Revision, InputHash: hash, Model: input.Model, Payload: datatypes.JSON(raw), GeneratedAt: output.GeneratedAt}
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "article_id"}, {Name: "input_hash"}}, DoUpdates: clause.AssignmentColumns([]string{"base_revision", "input_hash", "model", "payload", "generated_at"})}).Create(&row).Error
}
func discussionTaskPrefix(id uint64) string { return fmt.Sprintf("discussion-analysis|%d|", id) }
func discussionInputHash(input discussionInput) string {
	input.Sample.ReadAt = time.Time{}
	raw, _ := json.Marshal(input)
	return fmt.Sprintf("%x", sha256.Sum256(raw))
}
func (s *discussionAnalysisService) cached(ctx context.Context, id uint64, revision string) (discussionAnalysisPayload, bool, error) {
	var row models.DiscussionAnalysis
	result := s.db.WithContext(ctx).Where("article_id=? AND base_revision=? AND generated_at>?", id, revision, time.Now().Add(-15*time.Minute)).Order("generated_at DESC").Limit(1).Find(&row)
	if result.Error != nil {
		return discussionAnalysisPayload{}, false, result.Error
	}
	if result.RowsAffected == 0 {
		return discussionAnalysisPayload{}, false, nil
	}
	var p discussionAnalysisPayload
	if err := json.Unmarshal(row.Payload, &p); err != nil {
		return p, false, err
	}
	p.CacheHit = true
	return p, true, nil
}

func (h *ArticleHandler) AnalyzeDiscussion(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	s := h.discussion
	if s == nil || s.tasks == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 分析暂不可用"})
		return
	}
	article, err := h.loadArticleDetailMode(c.Request.Context(), id, false)
	if err != nil {
		h.handleLoadArticleError(c, err)
		return
	}
	if !eligibleDiscussion(article) {
		badRequest(c, "该文章不是可分析的论坛帖子")
		return
	}
	model := s.client.DefaultModel()
	revision := discussionRevision(article, model)
	if !parseBoolQuery(c.Query("refresh")) {
		payload, found, err := s.cached(c.Request.Context(), id, revision)
		if err != nil {
			internalServerError(c, "load discussion analysis cache failed", err)
			return
		}
		if found {
			c.JSON(http.StatusOK, gin.H{"data": gin.H{"status": "succeeded", "analysis": payload}})
			return
		}
	}
	if retry, ok := s.limiter.Allow(c.ClientIP(), time.Now()); !ok {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "分析请求较频繁，请稍后再试", "retry_after_sec": int(retry.Seconds())})
		return
	}
	bounded, cancel := context.WithTimeout(c.Request.Context(), 25*time.Second)
	defer cancel()
	input, err := h.loadDiscussionInput(bounded, article, model)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	hash := discussionInputHash(input)
	key := discussionTaskPrefix(id) + hash
	raw, _ := json.Marshal(input)
	state, err := s.tasks.Enqueue(aitask.Task{Key: key, ResourceID: id, Model: model, Refresh: true, Payload: string(raw)})
	if err != nil {
		internalServerError(c, "enqueue discussion analysis failed", err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusAccepted, gin.H{"data": gin.H{"status": state.Status, "task_key": key}})
}
func (h *ArticleHandler) GetDiscussionAnalysis(c *gin.Context) {
	id, err := parseUintParam(c, "id")
	if err != nil {
		badRequest(c, err.Error())
		return
	}
	key := c.Query("task_key")
	prefix := discussionTaskPrefix(id)
	if !strings.HasPrefix(key, prefix) || len(strings.TrimPrefix(key, prefix)) != 64 {
		badRequest(c, "invalid discussion task key")
		return
	}
	s := h.discussion
	if s == nil || s.tasks == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 分析暂不可用"})
		return
	}
	state, err := s.tasks.GetState(c.Request.Context(), key)
	if err != nil {
		internalServerError(c, "load discussion task failed", err)
		return
	}
	data := gin.H{"status": state.Status, "task_key": key, "error": state.Error}
	if state.Status == aitask.StatusSucceeded {
		var row models.DiscussionAnalysis
		if err := s.db.WithContext(c.Request.Context()).Where("article_id=? AND input_hash=?", id, strings.TrimPrefix(key, prefix)).Take(&row).Error; err != nil {
			notFound(c, "分析结果已更新，请重新打开当前帖子的分析")
			return
		}
		var payload discussionAnalysisPayload
		if json.Unmarshal(row.Payload, &payload) != nil {
			internalServerError(c, "invalid discussion analysis cache", nil)
			return
		}
		data["analysis"] = payload
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"data": data})
}
