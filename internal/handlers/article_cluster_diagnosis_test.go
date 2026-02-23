package handlers

import "testing"

func TestInferClusterMatchBasis(t *testing.T) {
	tests := []struct {
		name              string
		canonicalLink     string
		normalizedTitle   string
		peers             []diagnosisPeerRow
		vectorMatchID     uint64
		vectorDistance    *float64
		vectorMaxDistance float64
		wantBasis         string
		wantMatchID       uint64
		wantHasDistance   bool
	}{
		{
			name:            "match by canonical link first",
			canonicalLink:   "https://example.com/a",
			normalizedTitle: "same title",
			peers: []diagnosisPeerRow{
				{ID: 10, CanonicalLink: "https://example.com/a", NormalizedTitle: "other"},
				{ID: 11, CanonicalLink: "https://example.com/b", NormalizedTitle: "same title"},
			},
			vectorMaxDistance: 0.2,
			wantBasis:         "canonical_link",
			wantMatchID:       10,
		},
		{
			name:            "match by normalized title",
			canonicalLink:   "https://example.com/a",
			normalizedTitle: "same title",
			peers: []diagnosisPeerRow{
				{ID: 12, CanonicalLink: "https://example.com/b", NormalizedTitle: "same title"},
			},
			vectorMaxDistance: 0.2,
			wantBasis:         "normalized_title",
			wantMatchID:       12,
		},
		{
			name:            "match by vector",
			canonicalLink:   "https://example.com/a",
			normalizedTitle: "a",
			peers: []diagnosisPeerRow{
				{ID: 13, CanonicalLink: "https://example.com/b", NormalizedTitle: "b"},
			},
			vectorMatchID:     13,
			vectorDistance:    ptrFloat64(0.12),
			vectorMaxDistance: 0.2,
			wantBasis:         "vector",
			wantMatchID:       13,
			wantHasDistance:   true,
		},
		{
			name:              "single when no peers",
			canonicalLink:     "https://example.com/a",
			normalizedTitle:   "a",
			vectorMaxDistance: 0.2,
			wantBasis:         "single",
		},
		{
			name:            "unknown when clustered but no signal",
			canonicalLink:   "https://example.com/a",
			normalizedTitle: "a",
			peers: []diagnosisPeerRow{
				{ID: 14, CanonicalLink: "https://example.com/b", NormalizedTitle: "b"},
			},
			vectorMatchID:     14,
			vectorDistance:    ptrFloat64(0.6),
			vectorMaxDistance: 0.2,
			wantBasis:         "unknown",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			basis, matchID, distance := inferClusterMatchBasis(
				tc.canonicalLink,
				tc.normalizedTitle,
				tc.peers,
				tc.vectorMatchID,
				tc.vectorDistance,
				tc.vectorMaxDistance,
			)
			if basis != tc.wantBasis {
				t.Fatalf("basis=%s want=%s", basis, tc.wantBasis)
			}
			if tc.wantMatchID == 0 {
				if matchID != nil {
					t.Fatalf("matchID=%v want=nil", *matchID)
				}
			} else {
				if matchID == nil || *matchID != tc.wantMatchID {
					t.Fatalf("matchID=%v want=%d", matchID, tc.wantMatchID)
				}
			}
			if tc.wantHasDistance {
				if distance == nil {
					t.Fatalf("distance=nil want value")
				}
			} else if distance != nil {
				t.Fatalf("distance=%v want nil", *distance)
			}
		})
	}
}

func ptrFloat64(v float64) *float64 {
	return &v
}
