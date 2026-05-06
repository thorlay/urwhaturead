package handlers

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func parseListWindow(c *gin.Context, defaultLimit int, maxLimit int) (int, int, error) {
	limit := defaultLimit
	if limitRaw := strings.TrimSpace(c.Query("limit")); limitRaw != "" {
		value, err := strconv.Atoi(limitRaw)
		if err != nil || value <= 0 || value > maxLimit {
			return 0, 0, fmt.Errorf("limit must be an integer between 1 and %d", maxLimit)
		}
		limit = value
	}

	offset := 0
	if offsetRaw := strings.TrimSpace(c.Query("offset")); offsetRaw != "" {
		value, err := strconv.Atoi(offsetRaw)
		if err != nil || value < 0 {
			return 0, 0, fmt.Errorf("offset must be an integer >= 0")
		}
		offset = value
	}

	return limit, offset, nil
}
