package router

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
)

type timingResponseWriter struct {
	gin.ResponseWriter
	startedAt   time.Time
	wroteTiming bool
}

func (w *timingResponseWriter) WriteHeader(code int) {
	w.writeTimingHeader()
	w.ResponseWriter.WriteHeader(code)
}

func (w *timingResponseWriter) WriteHeaderNow() {
	w.writeTimingHeader()
	w.ResponseWriter.WriteHeaderNow()
}

func (w *timingResponseWriter) Write(data []byte) (int, error) {
	w.writeTimingHeader()
	return w.ResponseWriter.Write(data)
}

func (w *timingResponseWriter) WriteString(value string) (int, error) {
	w.writeTimingHeader()
	return w.ResponseWriter.WriteString(value)
}

func (w *timingResponseWriter) writeTimingHeader() {
	if w.wroteTiming {
		return
	}
	w.wroteTiming = true
	durationMS := float64(time.Since(w.startedAt).Microseconds()) / 1000
	w.Header().Set("Server-Timing", fmt.Sprintf("app;dur=%.1f", durationMS))
}

func RequestTiming() gin.HandlerFunc {
	return func(c *gin.Context) {
		writer := &timingResponseWriter{
			ResponseWriter: c.Writer,
			startedAt:      time.Now(),
		}
		c.Writer = writer
		c.Header("Timing-Allow-Origin", "*")
		c.Next()
	}
}
