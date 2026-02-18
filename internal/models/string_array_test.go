package models

import "testing"

func TestStringArrayValue(t *testing.T) {
	tests := []struct {
		name   string
		input  StringArray
		expect any
	}{
		{
			name:   "nil",
			input:  nil,
			expect: nil,
		},
		{
			name:   "empty",
			input:  StringArray{},
			expect: "{}",
		},
		{
			name:   "single chinese tag",
			input:  StringArray{"理财"},
			expect: "{\"理财\"}",
		},
		{
			name:   "escape quote and slash",
			input:  StringArray{`a"b`, `c\d`},
			expect: "{\"a\\\"b\",\"c\\\\d\"}",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			value, err := tc.input.Value()
			if err != nil {
				t.Fatalf("Value() returned error: %v", err)
			}
			if value != tc.expect {
				t.Fatalf("Value() = %#v, expect %#v", value, tc.expect)
			}
		})
	}
}
