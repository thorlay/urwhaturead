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
	summaryClient *aisummary.Client,
) *gin.Engine {
	engine := gin.New()
	engine.Use(gin.Logger(), gin.Recovery())

	engine.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := engine.Group("/api/v1")
	adminStatusHandler := handlers.NewAdminStatusHandler(db, backoffMaxFactor)
	adminStatusHandler.RegisterRoutes(api.Group("/admin"))

	feedHandler := handlers.NewFeedHandler(db)
	feedHandler.RegisterRoutes(api.Group("/feed"))

	articleHandler := handlers.NewArticleHandler(db, summaryClient)
	articleHandler.RegisterRoutes(api.Group("/articles"))

	sourceHandler := handlers.NewSourceHandler(db, refresher)
	sourceHandler.RegisterRoutes(api.Group("/sources"))

	return engine
}
