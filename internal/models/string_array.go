package models

import (
	"database/sql/driver"
	"strings"
)

// StringArray stores string slices as PostgreSQL text[] literals.
type StringArray []string

func (a StringArray) Value() (driver.Value, error) {
	if a == nil {
		return nil, nil
	}
	if len(a) == 0 {
		return "{}", nil
	}

	parts := make([]string, 0, len(a))
	for _, value := range a {
		escaped := strings.ReplaceAll(value, `\`, `\\`)
		escaped = strings.ReplaceAll(escaped, `"`, `\"`)
		parts = append(parts, `"`+escaped+`"`)
	}

	return "{" + strings.Join(parts, ",") + "}", nil
}
