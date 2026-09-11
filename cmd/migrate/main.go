package main

import (
	"log"

	"quick/internal/config"
	"quick/internal/database"
)

func main() {
	db, err := database.New(config.Load())
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	applied, err := database.Migrate(db)
	if err != nil {
		log.Fatalf("migrate database: %v", err)
	}
	if len(applied) == 0 {
		log.Println("database schema is up to date")
		return
	}
	log.Printf("database migrations applied: %v", applied)
}
