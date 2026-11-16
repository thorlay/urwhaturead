package main

import (
	"context"
	"log"
	"time"

	"quick/internal/config"
	"quick/internal/database"
	"quick/internal/handlers"
	"quick/internal/worker"
)

func main() {
	cfg := config.Load()
	db, err := database.New(cfg)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := database.Migrate(db); err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	h := handlers.NewSourceHandlerWithOptions(db, nil, handlers.SourceHandlerOptions{RSSHubBaseURL: cfg.RSSHubBaseURL})
	install := h.EnsurePaperSources
	sources, err := install(ctx)
	if err != nil {
		log.Fatal(err)
	}
	w := worker.NewRSSWorker(db, worker.RSSWorkerOptions{RequestRetries: 1, NGAPassportUID: cfg.NGAPassportUID, NGAPassportCID: cfg.NGAPassportCID})
	failed := false
	for _, source := range sources {
		log.Printf("Subscribed: %s (id=%d)", source.Name, source.ID)
		if err := w.RefreshSource(ctx, source.ID); err != nil {
			log.Printf("Initial fetch failed for %s: %v", source.Name, err)
			failed = true
		}
	}
	if failed {
		log.Fatal("Subscriptions saved, but initial fetch failed; check RSSHub version and source status before generating a briefing")
	}
}
