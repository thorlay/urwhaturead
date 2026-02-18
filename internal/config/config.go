package config

import (
	"os"
	"strconv"
)

type Config struct {
	ServerPort             string
	WorkerTickSec          int
	WorkerRequestRetries   int
	WorkerRetryBaseSec     int
	WorkerBackoffMaxFactor int
	AISummaryEnabled       bool
	AISummaryBaseURL       string
	AISummaryAPIKey        string
	AISummaryModel         string
	AISummaryTimeoutSec    int
	AISummaryMaxInputChars int
	DBHost                 string
	DBPort                 string
	DBUser                 string
	DBPassword             string
	DBName                 string
	DBSSLMode              string
	DBTimezone             string
}

func Load() Config {
	return Config{
		ServerPort:             envOrDefault("SERVER_PORT", "8080"),
		WorkerTickSec:          envOrDefaultInt("WORKER_TICK_SEC", 30),
		WorkerRequestRetries:   envOrDefaultInt("WORKER_REQUEST_RETRIES", 2),
		WorkerRetryBaseSec:     envOrDefaultInt("WORKER_RETRY_BASE_SEC", 2),
		WorkerBackoffMaxFactor: envOrDefaultInt("WORKER_BACKOFF_MAX_FACTOR", 16),
		AISummaryEnabled:       envOrDefaultBool("AI_SUMMARY_ENABLED", true),
		AISummaryBaseURL:       envOrDefault("AI_SUMMARY_BASE_URL", "http://127.0.0.1:8888/v1"),
		AISummaryAPIKey:        envOrDefault("AI_SUMMARY_API_KEY", envOrDefault("GEMINI_AUTH_PASSWORD", "")),
		AISummaryModel:         envOrDefault("AI_SUMMARY_MODEL", "gemini-2.5-flash"),
		AISummaryTimeoutSec:    envOrDefaultInt("AI_SUMMARY_TIMEOUT_SEC", 60),
		AISummaryMaxInputChars: envOrDefaultInt("AI_SUMMARY_MAX_INPUT_CHARS", 12000),
		DBHost:                 envOrDefault("DB_HOST", "localhost"),
		DBPort:                 envOrDefault("POSTGRES_PORT", "5432"),
		DBUser:                 envOrDefault("POSTGRES_USER", "quick"),
		DBPassword:             envOrDefault("POSTGRES_PASSWORD", "quickpass"),
		DBName:                 envOrDefault("POSTGRES_DB", "news_dev"),
		DBSSLMode:              envOrDefault("DB_SSL_MODE", "disable"),
		DBTimezone:             envOrDefault("DB_TIMEZONE", "Asia/Shanghai"),
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envOrDefaultInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func envOrDefaultBool(key string, fallback bool) bool {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}

	switch raw {
	case "1", "true", "TRUE", "True", "yes", "YES", "Yes", "on", "ON", "On":
		return true
	case "0", "false", "FALSE", "False", "no", "NO", "No", "off", "OFF", "Off":
		return false
	default:
		return fallback
	}
}
