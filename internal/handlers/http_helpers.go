package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

func parseUintParam(c *gin.Context, key string) (uint64, error) {
	raw := c.Param(key)
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be an unsigned integer", key)
	}
	return value, nil
}

func badRequest(c *gin.Context, message string) {
	c.JSON(http.StatusBadRequest, gin.H{"error": message})
}

func notFound(c *gin.Context, message string) {
	c.JSON(http.StatusNotFound, gin.H{"error": message})
}

func badGateway(c *gin.Context, message string) {
	c.JSON(http.StatusBadGateway, gin.H{"error": message})
}

func internalServerError(c *gin.Context, message string, err error) {
	requestID, _ := c.Get("request_id")
	log.Printf("request failed request_id=%q message=%q err=%v", requestID, message, err)
	payload := gin.H{"error": message}
	if value, ok := requestID.(string); ok && value != "" {
		payload["request_id"] = value
	}
	c.JSON(http.StatusInternalServerError, payload)
}
