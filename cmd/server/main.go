package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"quick/internal/aisummary"
	"quick/internal/clustering"
	"quick/internal/config"
	"quick/internal/database"
	"quick/internal/handlers"
	"quick/internal/models"
	"quick/internal/router"
	"quick/internal/worker"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg := config.Load()
	clustering.ConfigureVector(clustering.VectorOptions{
		Enabled:     cfg.ClusterVectorEnabled,
		MaxDistance: cfg.ClusterVectorMaxDistance,
		MinTokens:   cfg.ClusterVectorMinTokens,
		IVFFlatList: cfg.ClusterVectorIVFFlatList,
	})

	db, err := database.New(cfg)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}

	if err := db.AutoMigrate(
		&models.Source{},
		&models.EventCluster{},
		&models.Article{},
		&models.ArticleSummary{},
		&models.FeedBriefing{},
		&models.SourceFetchLog{},
	); err != nil {
		log.Fatalf("auto-migrate models: %v", err)
	}
	if err := database.EnsureRuntimeCompatibilitySchema(db); err != nil {
		log.Printf("ensure runtime compatibility schema warning: %v", err)
	}
	if cfg.ClusterVectorEnabled {
		if err := clustering.EnsureVectorSchema(db); err != nil {
			log.Printf("pgvector unavailable, fallback to rule-based clustering: %v", err)
		}
	} else {
		log.Printf("vector clustering is disabled by CLUSTER_VECTOR_ENABLED")
	}

	rssWorker := worker.NewRSSWorker(db, worker.RSSWorkerOptions{
		TickSec:          cfg.WorkerTickSec,
		RequestRetries:   cfg.WorkerRequestRetries,
		RetryBaseSec:     cfg.WorkerRetryBaseSec,
		BackoffMaxFactor: cfg.WorkerBackoffMaxFactor,
		UserAgent:        cfg.WorkerUserAgent,
		DebugHTTP:        cfg.WorkerDebugHTTP,
		DebugHosts:       cfg.WorkerDebugHosts,
	})
	go rssWorker.Start(ctx)

	var summaryClient *aisummary.Client
	if cfg.AISummaryEnabled {
		summaryClient = aisummary.NewClient(aisummary.Options{
			BaseURL:         cfg.AISummaryBaseURL,
			APIKey:          cfg.AISummaryAPIKey,
			Model:           cfg.AISummaryModel,
			Timeout:         time.Duration(cfg.AISummaryTimeoutSec) * time.Second,
			MaxInputChars:   cfg.AISummaryMaxInputChars,
			MaxOutputTokens: cfg.AISummaryMaxOutputTokens,
			APIStyle:        cfg.AISummaryAPIStyle,
			APIKeyHeader:    cfg.AISummaryAPIKeyHeader,
			APIKeyPrefix:    cfg.AISummaryAPIKeyPrefix,
		})
		if summaryClient == nil {
			log.Println("ai summary is enabled but not fully configured; endpoint will return 503")
		}
	}

	briefingScheduler := handlers.NewFeedBriefingScheduler(db, summaryClient, handlers.FeedBriefingSchedulerOptions{
		TickSec:           cfg.AutoAIBriefingTickSec,
		Limit:             cfg.AutoAIBriefingLimit,
		MaxSourcesPerTick: cfg.AutoAIBriefingMaxSourcesPerTick,
		MinNewArticles:    cfg.AutoAIBriefingMinNewArticles,
	})
	go briefingScheduler.Start(ctx)

	articleOptions := handlers.ArticleHandlerOptions{
		ExternalFetchEnabled:      cfg.ExternalFetchEnabled,
		ExternalFetchEnabledSet:   true,
		ExternalFetchAllowedHosts: cfg.ExternalFetchAllowedHosts,
		ExternalFetchCacheTTL:     time.Duration(cfg.ExternalFetchCacheTTLMin) * time.Minute,
		ExternalFetchFailureTTL:   time.Duration(cfg.ExternalFetchFailureTTLMin) * time.Minute,
		ExternalFetchMaxBodyBytes: int64(cfg.ExternalFetchMaxBodyKB) * 1024,
		ExternalFetchDailyReqMax:  cfg.ExternalFetchDailyRequestLimit,
		ExternalFetchDailyByteMax: int64(cfg.ExternalFetchDailyByteLimitMB) * 1024 * 1024,
	}

	engine := router.New(
		db,
		rssWorker,
		cfg.WorkerBackoffMaxFactor,
		cfg.RSSHubBaseURL,
		summaryClient,
		articleOptions,
		cfg.AdminAuthEnabled,
		cfg.AdminToken,
		cfg.AdminUsername,
		cfg.AdminPassword,
		cfg.FeedBriefingRateLimitPerHour,
		cfg.FeedBriefingCooldownSec,
	)
	server := &http.Server{
		Addr:              ":" + cfg.ServerPort,
		Handler:           engine,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("http shutdown error: %v", err)
		}
	}()

	log.Printf("server listening on http://localhost:%s", cfg.ServerPort)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server exited: %v", err)
	}
}
