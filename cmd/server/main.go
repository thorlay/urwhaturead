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
	"quick/internal/config"
	"quick/internal/database"
	"quick/internal/models"
	"quick/internal/router"
	"quick/internal/worker"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg := config.Load()

	db, err := database.New(cfg)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}

	if err := db.AutoMigrate(
		&models.Source{},
		&models.Article{},
		&models.ArticleSummary{},
		&models.SourceFetchLog{},
	); err != nil {
		log.Fatalf("auto-migrate models: %v", err)
	}

	rssWorker := worker.NewRSSWorker(db, worker.RSSWorkerOptions{
		TickSec:          cfg.WorkerTickSec,
		RequestRetries:   cfg.WorkerRequestRetries,
		RetryBaseSec:     cfg.WorkerRetryBaseSec,
		BackoffMaxFactor: cfg.WorkerBackoffMaxFactor,
	})
	go rssWorker.Start(ctx)

	var summaryClient *aisummary.Client
	if cfg.AISummaryEnabled {
		summaryClient = aisummary.NewClient(aisummary.Options{
			BaseURL:       cfg.AISummaryBaseURL,
			APIKey:        cfg.AISummaryAPIKey,
			Model:         cfg.AISummaryModel,
			Timeout:       time.Duration(cfg.AISummaryTimeoutSec) * time.Second,
			MaxInputChars: cfg.AISummaryMaxInputChars,
		})
		if summaryClient == nil {
			log.Println("ai summary is enabled but not fully configured; endpoint will return 503")
		}
	}

	engine := router.New(db, rssWorker, cfg.WorkerBackoffMaxFactor, summaryClient)
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
