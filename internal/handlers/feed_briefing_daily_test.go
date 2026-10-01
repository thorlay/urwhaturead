package handlers

import (
	"quick/internal/models"
	"testing"
	"time"
)

func TestDailyBriefingDue(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	now := time.Date(2026, 10, 1, 22, 0, 0, 0, loc)
	yesterday := now.AddDate(0, 0, -1)
	recent := now.Add(-9 * time.Minute)
	tests := []struct {
		name   string
		source models.Source
		at     time.Time
		want   bool
	}{
		{"before schedule", models.Source{}, now.Add(-time.Minute), false},
		{"first run", models.Source{}, now, true},
		{"already generated", models.Source{AIBriefingLastGeneratedAt: &now}, now.Add(time.Hour), false},
		{"next local day", models.Source{AIBriefingLastGeneratedAt: &yesterday}, now, true},
		{"retry cooldown", models.Source{AIBriefingLastRunAt: &recent}, now, false},
		{"failed retry", models.Source{AIBriefingLastRunAt: &recent}, now.Add(time.Minute), true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := dailyBriefingDue(tt.source, tt.at.UTC(), loc, 22*60); got != tt.want {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestDailyDigestUsesLocalDateAndSource(t *testing.T) {
	loc, windows := parseBriefingSchedule("Asia/Shanghai", "")
	if len(windows) != 0 || loc.String() != "Asia/Shanghai" {
		t.Fatal("timezone must apply without blocked windows")
	}
	now := time.Date(2026, 10, 1, 23, 59, 0, 0, loc)
	key := dailyBriefingDigest(1, now, loc)
	if key != dailyBriefingDigest(1, now.Add(-time.Hour).UTC(), loc) {
		t.Fatal("same local day must reuse report")
	}
	if key == dailyBriefingDigest(1, now.Add(time.Minute), loc) {
		t.Fatal("midnight must start new report")
	}
	if key == dailyBriefingDigest(2, now, loc) {
		t.Fatal("sources must not share reports")
	}
	if len(key) != 40 {
		t.Fatal("digest must work with existing result API")
	}
}
