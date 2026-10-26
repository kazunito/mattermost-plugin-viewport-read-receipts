package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

// The fake exercises real route/auth/CAS/TTL logic without a running Mattermost.
type fakeAPI struct {
	plugin.API
	mu             sync.Mutex
	posts          map[string]*model.Post
	users          map[string]*model.User
	members        map[string]bool
	sessions       map[string]*model.Session
	values         map[string][]byte
	ttls           map[string]int64
	conflict       int
	denyPermission bool
}

func (f *fakeAPI) GetSession(id string) (*model.Session, *model.AppError) {
	s := f.sessions[id]
	if s == nil {
		return nil, appError()
	}
	return s, nil
}
func (f *fakeAPI) GetPost(id string) (*model.Post, *model.AppError) {
	p := f.posts[id]
	if p == nil {
		return nil, appError()
	}
	return p, nil
}
func (f *fakeAPI) GetChannelMember(channel, user string) (*model.ChannelMember, *model.AppError) {
	if !f.members[channel+user] {
		return nil, appError()
	}
	return &model.ChannelMember{ChannelId: channel, UserId: user}, nil
}
func (f *fakeAPI) HasPermissionToChannel(_, _ string, _ *model.Permission) bool {
	return !f.denyPermission
}
func (f *fakeAPI) GetUser(id string) (*model.User, *model.AppError) {
	u := f.users[id]
	if u == nil {
		return nil, appError()
	}
	return u, nil
}
func (f *fakeAPI) KVGet(key string) ([]byte, *model.AppError) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]byte(nil), f.values[key]...), nil
}
func (f *fakeAPI) KVSetWithOptions(key string, value []byte, opt model.PluginKVSetOptions) (bool, *model.AppError) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.conflict > 0 {
		f.conflict--
		return false, nil
	}
	if !bytes.Equal(f.values[key], opt.OldValue) {
		return false, nil
	}
	f.values[key] = append([]byte(nil), value...)
	f.ttls[key] = opt.ExpireInSeconds
	return true, nil
}
func (f *fakeAPI) KVDelete(key string) *model.AppError {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.values, key)
	return nil
}
func appError() *model.AppError { return model.NewAppError("test", "test", nil, "", 404) }
func fixture() (*Plugin, *fakeAPI, string, string, string) {
	author, viewer, postID, channel := model.NewId(), model.NewId(), model.NewId(), model.NewId()
	f := &fakeAPI{posts: map[string]*model.Post{postID: {Id: postID, UserId: author, ChannelId: channel, CreateAt: time.Now().UnixMilli() - 1000}}, users: map[string]*model.User{viewer: {Id: viewer, Username: "viewer", FirstName: "表示", LastName: "確認"}}, members: map[string]bool{channel + author: true, channel + viewer: true}, sessions: map[string]*model.Session{}, values: map[string][]byte{}, ttls: map[string]int64{}}
	f.sessions[author] = &model.Session{UserId: author}
	f.sessions[viewer] = &model.Session{UserId: viewer}
	p := &Plugin{config: configuration{TrackingEnabled: true, DwellMilliseconds: 1000, RetentionDays: 30}}
	p.SetAPI(f)
	return p, f, author, viewer, postID
}
func call(p *Plugin, user, method, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Mattermost-User-Id", user)
	r.Header.Set("X-Requested-With", "ViewportReadReceipts")
	w := httptest.NewRecorder()
	p.ServeHTTP(&plugin.Context{SessionId: user}, w, r)
	return w
}
func batchBody(id string) string { return `{"post_ids":["` + id + `"]}` }
func TestRecordAndAuthorOnlyList(t *testing.T) {
	p, f, author, viewer, id := fixture()
	if w := call(p, viewer, "POST", "/api/v1/seen", batchBody(id)); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := call(p, viewer, "GET", "/api/v1/readers/"+id, ""); w.Code != 403 {
		t.Fatal("viewer must not see names", w.Code)
	}
	w := call(p, author, "GET", "/api/v1/readers/"+id, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "viewer") {
		t.Fatal(w.Code, w.Body.String())
	}
	var row map[string]json.RawMessage
	if e := json.Unmarshal(f.values["receipt_"+id], &row); e != nil {
		t.Fatal(e)
	}
	if len(row) != 2 || row["user_ids"] == nil || row["retention_days"] == nil {
		t.Fatal("unexpected stored data", row)
	}
	for _, bad := range []string{"read_at", "viewed_at", "email", "10:00"} {
		if strings.Contains(w.Body.String(), bad) {
			t.Fatal("unexpected disclosure", bad)
		}
	}
}
func TestDuplicateAndConcurrentReaders(t *testing.T) {
	p, f, _, viewer, id := fixture()
	post := f.posts[id]
	// Add memberships before starting concurrent work.
	ids := []string{viewer}
	for i := 0; i < 12; i++ {
		uid := model.NewId()
		ids = append(ids, uid)
		f.members[post.ChannelId+uid] = true
	}
	var wg sync.WaitGroup
	for _, uid := range ids {
		wg.Add(1)
		go func(uid string) {
			defer wg.Done()
			for attempt := 0; attempt < 20; attempt++ {
				if p.record(post, uid, p.config) == nil {
					return
				}
			}
			t.Error("CAS did not converge")
		}(uid)
	}
	wg.Wait()
	if e := p.record(post, viewer, p.config); e != nil {
		t.Fatal(e)
	}
	row, e := p.load(id)
	if e != nil || len(row.UserIDs) != len(ids) {
		t.Fatal("lost or duplicated reader", row, e)
	}
}
func TestRetentionAnchoredToPost(t *testing.T) {
	p, f, _, viewer, id := fixture()
	f.posts[id].CreateAt = time.Now().Add(-10 * 24 * time.Hour).UnixMilli()
	if e := p.record(f.posts[id], viewer, p.config); e != nil {
		t.Fatal(e)
	}
	ttl := f.ttls["receipt_"+id]
	if ttl > 20*86400 || ttl < 20*86400-5 {
		t.Fatal("TTL must end at post creation + retention", ttl)
	}
	if e := p.record(f.posts[id], viewer, p.config); e != nil {
		t.Fatal(e)
	}
	if ttl != f.ttls["receipt_"+id] {
		t.Fatal("duplicate extended TTL")
	}
	p.config.RetentionDays = 5
	w := call(p, viewer, "POST", "/api/v1/counts", batchBody(id))
	if strings.Contains(w.Body.String(), `"count"`) {
		t.Fatal("shortened retention must hide old data", w.Body.String())
	}
}
func TestNoUnauthorizedAccessOrWrites(t *testing.T) {
	tests := []struct {
		name         string
		change       func(*Plugin, *fakeAPI, string, string)
		method, path string
		code         int
	}{
		{"disabled", func(p *Plugin, _ *fakeAPI, _, _ string) { p.config.TrackingEnabled = false }, "POST", "/api/v1/seen", 503},
		{"identity mismatch", func(_ *Plugin, f *fakeAPI, viewer, _ string) { f.sessions[viewer].UserId = model.NewId() }, "POST", "/api/v1/seen", 401},
		{"expired session", func(_ *Plugin, f *fakeAPI, viewer, _ string) {
			f.sessions[viewer].ExpiresAt = time.Now().Add(-time.Hour).UnixMilli()
		}, "POST", "/api/v1/seen", 401},
		{"mobile session", func(_ *Plugin, f *fakeAPI, viewer, _ string) { f.sessions[viewer].DeviceId = "mobile" }, "POST", "/api/v1/seen", 403},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, viewer, id := fixture()
			tc.change(p, f, viewer, id)
			w := call(p, viewer, tc.method, tc.path, batchBody(id))
			if w.Code != tc.code {
				t.Fatal(w.Code, w.Body.String())
			}
			if len(f.values) > 0 {
				t.Fatal("unauthorized write")
			}
		})
	}
}
func TestPostAuthorizationAndFiltering(t *testing.T) {
	tests := []struct {
		name   string
		change func(*Plugin, *fakeAPI, string, string)
		status string
	}{
		{"non member", func(_ *Plugin, f *fakeAPI, v, id string) { delete(f.members, f.posts[id].ChannelId+v) }, "403"},
		{"permission denied", func(_ *Plugin, f *fakeAPI, _, _ string) { f.denyPermission = true }, "403"},
		{"deleted", func(_ *Plugin, f *fakeAPI, _, id string) { f.posts[id].DeleteAt = 1 }, "404"},
		{"system post", func(_ *Plugin, f *fakeAPI, _, id string) { f.posts[id].Type = "system_join_channel" }, "404"},
		{"channel outside scope", func(p *Plugin, _ *fakeAPI, _, _ string) { p.config.ChannelIDs = model.NewId() }, "404"},
		{"expired post", func(_ *Plugin, f *fakeAPI, _, id string) {
			f.posts[id].CreateAt = time.Now().Add(-31 * 24 * time.Hour).UnixMilli()
		}, "404"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p, f, _, v, id := fixture()
			tc.change(p, f, v, id)
			w := call(p, v, "POST", "/api/v1/seen", batchBody(id))
			if !strings.Contains(w.Body.String(), `"`+id+`":`+tc.status) {
				t.Fatal(w.Code, w.Body.String())
			}
			if len(f.values) != 0 {
				t.Fatal("filtered write")
			}
		})
	}
}
func TestOwnPostAndRemovedMember(t *testing.T) {
	p, f, author, viewer, id := fixture()
	call(p, author, "POST", "/api/v1/seen", batchBody(id))
	if len(f.values) != 0 {
		t.Fatal("author counted")
	}
	call(p, viewer, "POST", "/api/v1/seen", batchBody(id))
	delete(f.members, f.posts[id].ChannelId+viewer)
	w := call(p, author, "GET", "/api/v1/readers/"+id, "")
	if strings.Contains(w.Body.String(), viewer) {
		t.Fatal("former member disclosed")
	}
	p.MessageHasBeenDeleted(nil, f.posts[id])
	if len(f.values) != 0 {
		t.Fatal("deleted post still stored")
	}
}
func TestStrictRequests(t *testing.T) {
	for _, body := range []string{`{}`, `{"post_ids":[]}`, `{"post_ids":["bad"]}`, `{"post_ids":[],"user_id":"fake"}`, `{} {}`, strings.Repeat("x", 9000)} {
		p, _, _, viewer, _ := fixture()
		if w := call(p, viewer, "POST", "/api/v1/seen", body); w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	p, _, _, viewer, id := fixture()
	r := httptest.NewRequest("POST", "/api/v1/seen", strings.NewReader(batchBody(id)))
	r.Header.Set("Mattermost-User-Id", viewer)
	w := httptest.NewRecorder()
	p.ServeHTTP(&plugin.Context{SessionId: viewer}, w, r)
	if w.Code != 403 {
		t.Fatal("missing CSRF header accepted")
	}
}
func TestExtendingRetentionDoesNotExtendExistingReceipt(t *testing.T) {
	p, f, _, viewer, id := fixture()
	if e := p.record(f.posts[id], viewer, p.config); e != nil {
		t.Fatal(e)
	}
	first := f.ttls["receipt_"+id]
	p.config.RetentionDays = 60
	if e := p.record(f.posts[id], model.NewId(), p.config); e != nil {
		t.Fatal(e)
	}
	if f.ttls["receipt_"+id] > first {
		t.Fatal("existing receipt TTL was extended")
	}
}
func TestDeactivateReaderDoesNotDiscloseOrCount(t *testing.T) {
	p, f, author, viewer, id := fixture()
	call(p, viewer, "POST", "/api/v1/seen", batchBody(id))
	f.users[viewer].DeleteAt = 1
	w := call(p, author, "GET", "/api/v1/readers/"+id, "")
	if strings.Contains(w.Body.String(), viewer) {
		t.Fatal("deactivated reader disclosed")
	}
	w = call(p, author, "POST", "/api/v1/counts", batchBody(id))
	if !strings.Contains(w.Body.String(), `"count":0`) {
		t.Fatal("deactivated reader counted", w.Body.String())
	}
}
