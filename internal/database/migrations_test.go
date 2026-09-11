package database

import (
	"strings"
	"testing"

	"gorm.io/gorm"
)

func TestRegisteredSchemaMigrationsAreValid(t *testing.T) {
	if err := validateSchemaMigrations(registeredSchemaMigrations()); err != nil {
		t.Fatalf("registered migrations are invalid: %v", err)
	}
}

func TestValidateSchemaMigrationsRejectsInvalidRegistry(t *testing.T) {
	noop := func(*gorm.DB) error { return nil }
	tests := []struct {
		name       string
		migrations []schemaMigration
		want       string
	}{
		{
			name:       "non-positive version",
			migrations: []schemaMigration{{Version: 0, Name: "zero", Up: noop}},
			want:       "must be positive",
		},
		{
			name:       "empty name",
			migrations: []schemaMigration{{Version: 1, Up: noop}},
			want:       "empty name",
		},
		{
			name:       "missing function",
			migrations: []schemaMigration{{Version: 1, Name: "missing"}},
			want:       "no Up function",
		},
		{
			name: "duplicate version",
			migrations: []schemaMigration{
				{Version: 1, Name: "first", Up: noop},
				{Version: 1, Name: "second", Up: noop},
			},
			want: "duplicate schema migration version",
		},
		{
			name: "duplicate name",
			migrations: []schemaMigration{
				{Version: 1, Name: "same", Up: noop},
				{Version: 2, Name: "same", Up: noop},
			},
			want: "duplicate schema migration name",
		},
		{
			name: "out of order",
			migrations: []schemaMigration{
				{Version: 2, Name: "second", Up: noop},
				{Version: 1, Name: "first", Up: noop},
			},
			want: "must be ordered",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateSchemaMigrations(test.migrations)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("validateSchemaMigrations() error=%v, want substring %q", err, test.want)
			}
		})
	}
}
