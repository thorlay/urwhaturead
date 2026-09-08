package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ServerPort                      string
	RSSHubBaseURL                   string
	AdminAuthEnabled                bool
	AdminToken                      string
	AdminUsername                   string
	AdminPassword                   string
	WorkerTickSec                   int
	WorkerFetchConcurrency          int
	WorkerRequestRetries            int
	WorkerRetryBaseSec              int
	WorkerBackoffMaxFactor          int
	WorkerUserAgent                 string
	WorkerDebugHTTP                 bool
	WorkerDebugHosts                []string
	ClusterVectorEnabled            bool
	ClusterVectorMaxDistance        float64
	ClusterVectorMinTokens          int
	ClusterVectorIVFFlatList        int
	AISummaryEnabled                bool
	AISummaryBaseURL                string
	AISummaryAPIKey                 string
	AISummaryModel                  string
	AISummaryTimeoutSec             int
	AISummaryMaxInputChars          int
	AISummaryMaxOutputTokens        int
	AISummaryAPIStyle               string
	AISummaryAPIKeyHeader           string
	AISummaryAPIKeyPrefix           string
	AISummaryThinkingMode           string
	AutoAIBriefingTickSec           int
	AutoAIBriefingLimit             int
	AutoAIBriefingMaxSourcesPerTick int
	AutoAIBriefingMinNewArticles    int
	AutoAIBriefingDedupWindowHours  int
	AutoAIBriefingMinReplyDelta     int
	AutoAIBriefingTimezone          string
	AutoAIBriefingBlockedWindows    string
	FeedBriefingRateLimitPerHour    int
	FeedBriefingCooldownSec         int
	ExternalFetchEnabled            bool
	ExternalFetchAllowedHosts       []string
	ExternalFetchDailyRequestLimit  int
	ExternalFetchDailyByteLimitMB   int
	ExternalFetchCacheTTLMin        int
	ExternalFetchFailureTTLMin      int
	ExternalFetchMaxBodyKB          int
	DBHost                          string
	DBPort                          string
	DBUser                          string
	DBPassword                      string
	DBName                          string
	DBSSLMode                       string
	DBTimezone                      string
}

func Load() Config {
	adminToken := envOrDefault("ADMIN_TOKEN", envOrDefault("ADMIN_API_KEY", ""))

	return Config{
		ServerPort:                      envOrDefault("SERVER_PORT", "8080"),
		RSSHubBaseURL:                   envOrDefault("RSSHUB_BASE_URL", "http://127.0.0.1:1200"),
		AdminAuthEnabled:                envOrDefaultBool("ADMIN_AUTH_ENABLED", strings.TrimSpace(adminToken) != ""),
		AdminToken:                      adminToken,
		AdminUsername:                   envOrDefault("ADMIN_USERNAME", "admin"),
		AdminPassword:                   envOrDefault("ADMIN_PASSWORD", ""),
		WorkerTickSec:                   envOrDefaultInt("WORKER_TICK_SEC", 30),
		WorkerFetchConcurrency:          envOrDefaultInt("WORKER_FETCH_CONCURRENCY", 6),
		WorkerRequestRetries:            envOrDefaultInt("WORKER_REQUEST_RETRIES", 2),
		WorkerRetryBaseSec:              envOrDefaultInt("WORKER_RETRY_BASE_SEC", 2),
		WorkerBackoffMaxFactor:          envOrDefaultInt("WORKER_BACKOFF_MAX_FACTOR", 16),
		WorkerUserAgent:                 envOrDefault("WORKER_USER_AGENT", "Mozilla/5.0 (compatible; QuickRSS/0.1; +https://urwhaturead.com/contact)"),
		WorkerDebugHTTP:                 envOrDefaultBool("WORKER_DEBUG_HTTP", false),
		WorkerDebugHosts:                envOrDefaultCSV("WORKER_DEBUG_HOSTS", ""),
		ClusterVectorEnabled:            envOrDefaultBool("CLUSTER_VECTOR_ENABLED", true),
		ClusterVectorMaxDistance:        envOrDefaultFloat("CLUSTER_VECTOR_MAX_DISTANCE", 0.20),
		ClusterVectorMinTokens:          envOrDefaultInt("CLUSTER_VECTOR_MIN_TOKENS", 3),
		ClusterVectorIVFFlatList:        envOrDefaultInt("CLUSTER_VECTOR_IVFFLAT_LISTS", 100),
		AISummaryEnabled:                envOrDefaultBool("AI_SUMMARY_ENABLED", true),
		AISummaryBaseURL:                envOrDefault("AI_SUMMARY_BASE_URL", "http://127.0.0.1:8888/v1"),
		AISummaryAPIKey:                 envOrDefault("AI_SUMMARY_API_KEY", envOrDefault("GEMINI_AUTH_PASSWORD", "")),
		AISummaryModel:                  envOrDefault("AI_SUMMARY_MODEL", "gemini-2.5-flash"),
		AISummaryTimeoutSec:             envOrDefaultInt("AI_SUMMARY_TIMEOUT_SEC", 60),
		AISummaryMaxInputChars:          envOrDefaultInt("AI_SUMMARY_MAX_INPUT_CHARS", 12000),
		AISummaryMaxOutputTokens:        envOrDefaultInt("AI_SUMMARY_MAX_OUTPUT_TOKENS", 1000),
		AISummaryAPIStyle:               envOrDefault("AI_SUMMARY_API_STYLE", "auto"),
		AISummaryAPIKeyHeader:           envOrDefault("AI_SUMMARY_API_KEY_HEADER", ""),
		AISummaryAPIKeyPrefix:           envOrDefault("AI_SUMMARY_API_KEY_PREFIX", ""),
		AISummaryThinkingMode:           envOrDefault("AI_SUMMARY_THINKING_MODE", "auto"),
		AutoAIBriefingTickSec:           envOrDefaultInt("AUTO_AI_BRIEFING_TICK_SEC", 120),
		AutoAIBriefingLimit:             envOrDefaultInt("AUTO_AI_BRIEFING_LIMIT", 20),
		AutoAIBriefingMaxSourcesPerTick: envOrDefaultInt("AUTO_AI_BRIEFING_MAX_SOURCES_PER_TICK", 4),
		AutoAIBriefingMinNewArticles:    envOrDefaultInt("AUTO_AI_BRIEFING_MIN_NEW_ARTICLES", 3),
		AutoAIBriefingDedupWindowHours:  envOrDefaultInt("AUTO_AI_BRIEFING_DEDUP_WINDOW_HOURS", 336),
		AutoAIBriefingMinReplyDelta:     envOrDefaultInt("AUTO_AI_BRIEFING_MIN_REPLY_DELTA", 5),
		AutoAIBriefingTimezone:          envOrDefault("AUTO_AI_BRIEFING_TIMEZONE", "Asia/Shanghai"),
		AutoAIBriefingBlockedWindows:    envOrDefault("AUTO_AI_BRIEFING_BLOCKED_WINDOWS", ""),
		FeedBriefingRateLimitPerHour:    envOrDefaultInt("FEED_BRIEFING_RATE_LIMIT_PER_HOUR", 10),
		FeedBriefingCooldownSec:         envOrDefaultInt("FEED_BRIEFING_COOLDOWN_SEC", 600),
		ExternalFetchEnabled:            envOrDefaultBool("EXTERNAL_FETCH_ENABLED", true),
		ExternalFetchAllowedHosts:       envOrDefaultCSV("EXTERNAL_FETCH_ALLOWED_HOSTS", ""),
		ExternalFetchDailyRequestLimit:  envOrDefaultInt("EXTERNAL_FETCH_DAILY_REQUEST_LIMIT", 500),
		ExternalFetchDailyByteLimitMB:   envOrDefaultInt("EXTERNAL_FETCH_DAILY_BYTE_LIMIT_MB", 512),
		ExternalFetchCacheTTLMin:        envOrDefaultInt("EXTERNAL_FETCH_CACHE_TTL_MIN", 1440),
		ExternalFetchFailureTTLMin:      envOrDefaultInt("EXTERNAL_FETCH_FAILURE_TTL_MIN", 60),
		ExternalFetchMaxBodyKB:          envOrDefaultInt("EXTERNAL_FETCH_MAX_BODY_KB", 3072),
		DBHost:                          envOrDefault("DB_HOST", "localhost"),
		DBPort:                          envOrDefault("POSTGRES_PORT", "5432"),
		DBUser:                          envOrDefault("POSTGRES_USER", "quick"),
		DBPassword:                      envOrDefault("POSTGRES_PASSWORD", "quickpass"),
		DBName:                          envOrDefault("POSTGRES_DB", "news_dev"),
		DBSSLMode:                       envOrDefault("DB_SSL_MODE", "disable"),
		DBTimezone:                      envOrDefault("DB_TIMEZONE", "Asia/Shanghai"),
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

func envOrDefaultFloat(key string, fallback float64) float64 {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}

	value, err := strconv.ParseFloat(raw, 64)
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

func envOrDefaultCSV(key string, fallback string) []string {
	raw := envOrDefault(key, fallback)
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		value := strings.ToLower(strings.TrimSpace(part))
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
