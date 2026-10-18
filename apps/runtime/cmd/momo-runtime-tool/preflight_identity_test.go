package main

import "testing"

func TestMemberSeedQueryPreservesLegacyRoster(t *testing.T) {
	for _, test := range []struct {
		name    string
		columns []string
		query   string
	}{
		{"legacy", []string{"id:text:NO"}, "SELECT id FROM members"},
		{"canonical", []string{"legacy_id:text:NO", "id:uuid:NO"}, "SELECT legacy_id FROM members"},
		{"uuid without alias", []string{"id:uuid:NO"}, ""},
		{"nullable alias", []string{"id:uuid:NO", "legacy_id:text:YES"}, ""},
		{"old PK with alias", []string{"id:text:NO", "legacy_id:text:NO"}, ""},
		{"wrong alias type", []string{"id:uuid:NO", "legacy_id:uuid:NO"}, ""},
		{"nullable PK", []string{"id:uuid:YES", "legacy_id:text:NO"}, ""},
		{"missing table", nil, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			query, err := memberSeedQuery(test.columns)
			if (err != nil) != (test.query == "") || query != test.query {
				t.Fatalf("query %q, error %v", query, err)
			}
		})
	}
}
