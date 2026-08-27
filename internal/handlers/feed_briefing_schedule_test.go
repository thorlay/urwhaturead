package handlers

import (
	"testing"
	"time"
)

func TestBriefingScheduleBlockedForDeepSeekPeakWindows(t *testing.T) {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatalf("load timezone: %v", err)
	}
	windows, err := parseWeeklyScheduleWindows("Mon-Fri@09:00-12:00,Mon-Fri@14:00-18:00")
	if err != nil {
		t.Fatalf("parse windows: %v", err)
	}

	tests := []struct {
		name    string
		at      time.Time
		blocked bool
	}{
		{name: "weekday morning peak", at: time.Date(2026, 8, 24, 10, 30, 0, 0, location), blocked: true},
		{name: "weekday lunch off peak", at: time.Date(2026, 8, 24, 13, 0, 0, 0, location), blocked: false},
		{name: "weekday afternoon peak", at: time.Date(2026, 8, 24, 15, 0, 0, 0, location), blocked: true},
		{name: "weekday evening off peak", at: time.Date(2026, 8, 24, 20, 0, 0, 0, location), blocked: false},
		{name: "weekend daytime off peak", at: time.Date(2026, 8, 23, 10, 0, 0, 0, location), blocked: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := briefingScheduleBlocked(test.at.UTC(), location, windows); got != test.blocked {
				t.Fatalf("briefingScheduleBlocked() = %v, want %v", got, test.blocked)
			}
		})
	}
}

func TestParseWeeklyScheduleWindowsRejectsInvalidConfig(t *testing.T) {
	tests := []string{
		"",
		"Mon-Fri",
		"Mon-Fri@18:00-09:00",
		"Mon-Fri@09:00-24:01",
		"Monday-Friday@09:00-12:00",
	}
	for _, raw := range tests {
		t.Run(raw, func(t *testing.T) {
			if _, err := parseWeeklyScheduleWindows(raw); err == nil {
				t.Fatalf("parseWeeklyScheduleWindows(%q) expected error", raw)
			}
		})
	}
}

func TestParseBriefingScheduleFailsClosed(t *testing.T) {
	location, windows := parseBriefingSchedule("Not/A-Timezone", "Mon-Fri@09:00-12:00")
	if !briefingScheduleBlocked(time.Now(), location, windows) {
		t.Fatal("invalid schedule configuration should block scheduled briefings")
	}
}
