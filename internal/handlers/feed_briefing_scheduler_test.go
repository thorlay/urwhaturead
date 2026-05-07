package handlers

import "testing"

func TestSelectSourceBriefingRows_FirstRunUsesAllRows(t *testing.T) {
	rows := []feedItem{
		{ID: 11, Title: "A"},
		{ID: 12, Title: "B"},
	}

	selected, newCount, ok := selectSourceBriefingRows(rows, nil, 3)
	if !ok {
		t.Fatalf("expected first run to generate")
	}
	if newCount != 2 {
		t.Fatalf("newCount=%d, want 2", newCount)
	}
	if len(selected) != 2 || selected[0].ID != 11 || selected[1].ID != 12 {
		t.Fatalf("selected=%v, want all rows", selected)
	}
}

func TestSelectSourceBriefingRows_SkipsWhenTooFewNewRows(t *testing.T) {
	rows := []feedItem{
		{ID: 21, Title: "A"},
		{ID: 22, Title: "B"},
		{ID: 23, Title: "C"},
	}

	selected, newCount, ok := selectSourceBriefingRows(rows, []uint64{22, 23}, 2)
	if ok {
		t.Fatalf("expected run to skip when new rows are below threshold")
	}
	if newCount != 1 {
		t.Fatalf("newCount=%d, want 1", newCount)
	}
	if selected != nil {
		t.Fatalf("selected=%v, want nil", selected)
	}
}

func TestSelectSourceBriefingRows_UsesOnlyNewRowsWhenThresholdMet(t *testing.T) {
	rows := []feedItem{
		{ID: 31, Title: "A"},
		{ID: 32, Title: "B"},
		{ID: 33, Title: "C"},
		{ID: 34, Title: "D"},
	}

	selected, newCount, ok := selectSourceBriefingRows(rows, []uint64{31, 32}, 2)
	if !ok {
		t.Fatalf("expected run to generate")
	}
	if newCount != 2 {
		t.Fatalf("newCount=%d, want 2", newCount)
	}
	if len(selected) != 2 || selected[0].ID != 33 || selected[1].ID != 34 {
		t.Fatalf("selected IDs=(%d,%d), want (33,34)", selected[0].ID, selected[1].ID)
	}
}
