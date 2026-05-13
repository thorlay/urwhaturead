package feedextract

import (
	"regexp"
	"strconv"
	"strings"
)

var xmlCharRefPattern = regexp.MustCompile(`&#([xX][0-9a-fA-F]+|[0-9]+);`)

func SanitizeXML10(input []byte) []byte {
	if len(input) == 0 {
		return input
	}

	original := string(input)
	value := sanitizeXML10CharacterReferences(original)
	needsClean := false
	for _, r := range value {
		if !isValidXML10Rune(r) {
			needsClean = true
			break
		}
	}
	if !needsClean {
		if value != original {
			return []byte(value)
		}
		return input
	}

	cleaned := strings.Map(func(r rune) rune {
		if !isValidXML10Rune(r) {
			return -1
		}
		return r
	}, value)
	return []byte(cleaned)
}

func sanitizeXML10CharacterReferences(input string) string {
	return xmlCharRefPattern.ReplaceAllStringFunc(input, func(match string) string {
		value := strings.TrimSuffix(strings.TrimPrefix(match, "&#"), ";")
		base := 10
		if strings.HasPrefix(value, "x") || strings.HasPrefix(value, "X") {
			base = 16
			value = value[1:]
		}
		codepoint, err := strconv.ParseInt(value, base, 32)
		if err != nil || !isValidXML10Rune(rune(codepoint)) {
			return ""
		}
		return match
	})
}

func isValidXML10Rune(r rune) bool {
	return r == 0x9 ||
		r == 0xA ||
		r == 0xD ||
		(r >= 0x20 && r <= 0xD7FF) ||
		(r >= 0xE000 && r <= 0xFFFD) ||
		(r >= 0x10000 && r <= 0x10FFFF)
}
