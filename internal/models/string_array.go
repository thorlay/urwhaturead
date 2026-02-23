package models

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
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

func (a *StringArray) Scan(src any) error {
	if a == nil {
		return fmt.Errorf("StringArray.Scan: nil receiver")
	}

	switch v := src.(type) {
	case nil:
		*a = nil
		return nil
	case []string:
		out := make([]string, len(v))
		copy(out, v)
		*a = out
		return nil
	case string:
		parsed, err := parseTextArray(v)
		if err != nil {
			return err
		}
		*a = parsed
		return nil
	case []byte:
		parsed, err := parseTextArray(string(v))
		if err != nil {
			return err
		}
		*a = parsed
		return nil
	default:
		return fmt.Errorf("StringArray.Scan: unsupported type %T", src)
	}
}

func parseTextArray(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if strings.EqualFold(raw, "null") {
		return nil, nil
	}
	if len(raw) < 2 || raw[0] != '{' || raw[len(raw)-1] != '}' {
		return nil, fmt.Errorf("invalid text[] literal: %q", raw)
	}
	body := raw[1 : len(raw)-1]
	if body == "" {
		return []string{}, nil
	}

	result := make([]string, 0, 8)
	var token strings.Builder
	inQuotes := false
	escaped := false
	quotedToken := false

	pushToken := func() {
		value := token.String()
		if !quotedToken {
			value = strings.TrimSpace(value)
			if strings.EqualFold(value, "null") {
				result = append(result, "")
				token.Reset()
				quotedToken = false
				return
			}
		}
		result = append(result, value)
		token.Reset()
		quotedToken = false
	}

	for i := 0; i < len(body); i++ {
		ch := body[i]
		if escaped {
			token.WriteByte(ch)
			escaped = false
			continue
		}
		if inQuotes {
			switch ch {
			case '\\':
				escaped = true
			case '"':
				inQuotes = false
			default:
				token.WriteByte(ch)
			}
			continue
		}

		switch ch {
		case '"':
			inQuotes = true
			quotedToken = true
		case ',':
			pushToken()
		case '\\':
			escaped = true
		default:
			token.WriteByte(ch)
		}
	}
	if inQuotes || escaped {
		return nil, fmt.Errorf("invalid text[] literal: %q", raw)
	}
	pushToken()

	return result, nil
}

var _ sql.Scanner = (*StringArray)(nil)
