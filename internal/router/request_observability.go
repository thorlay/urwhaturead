package router

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	requestIDHeader = "X-Request-ID"
	requestIDKey    = "request_id"
)

var requestIDFallbackCounter atomic.Uint64

type accessLogRecord struct {
	Timestamp string  `json:"timestamp"`
	RequestID string  `json:"request_id"`
	Method    string  `json:"method"`
	Path      string  `json:"path"`
	Route     string  `json:"route,omitempty"`
	Status    int     `json:"status"`
	LatencyMS float64 `json:"latency_ms"`
	Bytes     int     `json:"bytes"`
	ClientIP  string  `json:"client_ip"`
}

func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := strings.TrimSpace(c.GetHeader(requestIDHeader))
		if !validRequestID(requestID) {
			requestID = newRequestID()
		}
		c.Set(requestIDKey, requestID)
		c.Header(requestIDHeader, requestID)
		c.Next()
	}
}

func RequestLogger(output io.Writer) gin.HandlerFunc {
	if output == nil {
		output = io.Discard
	}
	logger := log.New(output, "", 0)
	return func(c *gin.Context) {
		startedAt := time.Now()
		c.Next()

		route := c.FullPath()
		requestID, _ := c.Get(requestIDKey)
		record := accessLogRecord{
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
			RequestID: stringValue(requestID),
			Method:    c.Request.Method,
			Path:      c.Request.URL.Path,
			Route:     route,
			Status:    c.Writer.Status(),
			LatencyMS: float64(time.Since(startedAt).Microseconds()) / 1000,
			Bytes:     c.Writer.Size(),
			ClientIP:  c.ClientIP(),
		}
		encoded, err := json.Marshal(record)
		if err != nil {
			logger.Printf(`{"request_id":%q,"log_error":%q}`, record.RequestID, err.Error())
			return
		}
		logger.Print(string(encoded))
	}
}

func validRequestID(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '-' || char == '_' || char == '.' {
			continue
		}
		return false
	}
	return true
}

func newRequestID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err == nil {
		return hex.EncodeToString(bytes[:])
	}
	counter := requestIDFallbackCounter.Add(1)
	return fmt.Sprintf("%s-%016x", time.Now().UTC().Format("20060102T150405.000000000"), counter)
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}
