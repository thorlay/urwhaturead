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

func TestStringArrayScan(t *testing.T) {
	tests := []struct {
		name    string
		input   any
		expect  StringArray
		wantErr bool
	}{
		{
			name:   "nil",
			input:  nil,
			expect: nil,
		},
		{
			name:   "empty",
			input:  "{}",
			expect: StringArray{},
		},
		{
			name:   "quoted values",
			input:  "{\"理财\",\"信用卡\"}",
			expect: StringArray{"理财", "信用卡"},
		},
		{
			name:   "escaped values",
			input:  "{\"a\\\"b\",\"c\\\\d\"}",
			expect: StringArray{`a"b`, `c\d`},
		},
		{
			name:   "bytes input",
			input:  []byte("{\"x\",\"y\"}"),
			expect: StringArray{"x", "y"},
		},
		{
			name:    "invalid",
			input:   "not-array",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			var out StringArray
			err := (&out).Scan(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("Scan() expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("Scan() returned error: %v", err)
			}
			if len(out) != len(tc.expect) {
				t.Fatalf("Scan() len = %d, expect %d", len(out), len(tc.expect))
			}
			for i := range out {
				if out[i] != tc.expect[i] {
					t.Fatalf("Scan()[%d] = %q, expect %q", i, out[i], tc.expect[i])
				}
			}
		})
	}
}
