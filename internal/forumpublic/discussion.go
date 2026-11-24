// Package forumpublic decodes the public discussion material used by the forum feed.
package forumpublic

import (
	"encoding/json"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"time"
)

const (
	LobstersFeed     = "https://lobste.rs/rss"
	BogleheadsFeed   = "https://www.bogleheads.org/forum/feed/forum/10"
	bogleheadsOrigin = "https://www.bogleheads.org"
	Lobsters         = "lobsters"
	Bogleheads       = "bogleheads"
	Window           = 24 * time.Hour
)

type Reply struct {
	Link    string    `json:"link"`
	Author  string    `json:"author"`
	Content string    `json:"content"`
	At      time.Time `json:"at"`
	Upvotes *int      `json:"upvotes,omitempty"`
}

type Snapshot struct {
	Kind    string  `json:"kind"`
	Replies []Reply `json:"replies"`
	// Bogleheads uses post permalinks and subject lines in its public Atom.
	// An observed opening post pins the label and permalink for this subject.
	OpeningLink  string `json:"opening_link,omitempty"`
	Ambiguous    bool   `json:"ambiguous,omitempty"`
	ExternalLink string `json:"external_link,omitempty"`
}

type Raw struct {
	Discussion *Snapshot `json:"public_discussion"`
}

func FromRaw(raw []byte) *Snapshot {
	var data Raw
	if json.Unmarshal(raw, &data) != nil || data.Discussion == nil {
		return nil
	}
	if data.Discussion.Kind != Lobsters && data.Discussion.Kind != Bogleheads {
		return nil
	}
	return data.Discussion
}

func RecentReplies(replies []Reply, now time.Time) []Reply {
	out := make([]Reply, 0, len(replies))
	seen := make(map[string]bool, len(replies))
	for _, reply := range replies {
		if seen[reply.Link] || reply.At.Before(now.Add(-Window)) || reply.At.After(now) {
			continue
		}
		seen[reply.Link] = true
		out = append(out, reply)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].At.Equal(out[j].At) {
			return out[i].Link < out[j].Link
		}
		return out[i].At.Before(out[j].At)
	})
	return out
}

var lobstersPath = regexp.MustCompile(`^/s/([a-z0-9]{6})(/[^/]+)?/?$`)
var lobstersComment = regexp.MustCompile(`^c_[a-z0-9]{6}$`)

func LobstersTopic(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "lobste.rs" || u.User != nil {
		return "", false
	}
	parts := lobstersPath.FindStringSubmatch(u.Path)
	if len(parts) == 0 {
		return "", false
	}
	return "https://lobste.rs/s/" + parts[1], true
}

func LobstersReplyLink(topic, id string) (string, bool) {
	if !lobstersComment.MatchString(id) {
		return "", false
	}
	return topic + "#" + id, true
}

func BogleheadsPost(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "www.bogleheads.org" || u.User != nil || u.Path != "/forum/viewtopic.php" {
		return "", false
	}
	id := u.Query().Get("p")
	n, err := strconv.ParseUint(id, 10, 64)
	if err != nil || n == 0 || u.Fragment != "p"+id {
		return "", false
	}
	return bogleheadsOrigin + "/forum/viewtopic.php?p=" + id + "#p" + id, true
}
