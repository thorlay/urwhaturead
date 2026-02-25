package router

import (
	"net/http"

	"quick/internal/aisummary"
	"quick/internal/handlers"
	"quick/internal/worker"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func New(
	db *gorm.DB,
	refresher worker.Refresher,
	backoffMaxFactor int,
	rsshubBaseURL string,
	summaryClient *aisummary.Client,
	articleOptions handlers.ArticleHandlerOptions,
	adminAuthEnabled bool,
	adminToken string,
	adminUsername string,
	adminPassword string,
	feedBriefingRateLimitPerHour int,
	feedBriefingCooldownSec int,
) *gin.Engine {
	engine := gin.New()
	engine.Use(gin.Logger(), gin.Recovery())

	engine.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := engine.Group("/api/v1")
	feedHandler := handlers.NewFeedHandler(db, summaryClient, handlers.FeedHandlerOptions{
		AdminAuthEnabled: adminAuthEnabled,
		AdminToken:       adminToken,
		RateLimitPerHour: feedBriefingRateLimitPerHour,
		CooldownSec:      feedBriefingCooldownSec,
	})
	feedHandler.RegisterReadRoutes(api.Group("/feed"))

	articleHandler := handlers.NewArticleHandlerWithOptions(db, summaryClient, articleOptions)
	articleHandler.RegisterReadRoutes(api.Group("/articles"))

	sourceHandler := handlers.NewSourceHandlerWithOptions(db, refresher, handlers.SourceHandlerOptions{
		RSSHubBaseURL: rsshubBaseURL,
	})
	sourceHandler.RegisterReadRoutes(api.Group("/sources"))

	adminAuthHandler := handlers.NewAdminAuthHandler(handlers.AdminAuthOptions{
		Enabled:  adminAuthEnabled,
		Token:    adminToken,
		Username: adminUsername,
		Password: adminPassword,
	})
	adminAuthHandler.RegisterPublicRoutes(api.Group("/admin"))

	adminAPI := engine.Group("/api/v1")
	if adminAuthEnabled {
		adminAPI.Use(RequireAdminToken(adminToken))
	}

	adminStatusHandler := handlers.NewAdminStatusHandler(db, backoffMaxFactor)
	adminStatusHandler.RegisterRoutes(adminAPI.Group("/admin"))
	feedHandler.RegisterWriteRoutes(adminAPI.Group("/feed"))
	articleHandler.RegisterWriteRoutes(adminAPI.Group("/articles"))
	sourceHandler.RegisterWriteRoutes(adminAPI.Group("/sources"))

	return engine
}
