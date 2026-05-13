package feedextract

import "strings"

func SanitizeXML10(input []byte) []byte {
	if len(input) == 0 {
		return input
	}

	value := string(input)
	needsClean := false
	for _, r := range value {
		if !isValidXML10Rune(r) {
			needsClean = true
			break
		}
	}
	if !needsClean {
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

func isValidXML10Rune(r rune) bool {
	return r == 0x9 ||
		r == 0xA ||
		r == 0xD ||
		(r >= 0x20 && r <= 0xD7FF) ||
		(r >= 0xE000 && r <= 0xFFFD) ||
		(r >= 0x10000 && r <= 0x10FFFF)
}
