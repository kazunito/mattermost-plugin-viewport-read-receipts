package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

const pluginID = "com.nito.viewport-read-receipts"
const maxBatch = 50

// receipt contains no view timestamps, client identifiers, or message contents.
type receipt struct {
	UserIDs       []string `json:"user_ids"`
	RetentionDays int      `json:"retention_days"`
}
type configuration struct {
	TrackingEnabled   bool
	DwellMilliseconds int
	RetentionDays     int
	ChannelIDs        string
}
type Plugin struct {
	plugin.MattermostPlugin
	mu     sync.RWMutex
	config configuration
}

func (p *Plugin) OnActivate() error { return p.OnConfigurationChange() }
func (p *Plugin) OnConfigurationChange() error {
	c := configuration{DwellMilliseconds: 1000, RetentionDays: 30}
	if err := p.API.LoadPluginConfiguration(&c); err != nil {
		return err
	}
	if c.DwellMilliseconds < 250 || c.DwellMilliseconds > 10000 {
		return errors.New("連続表示時間は250〜10000ミリ秒で指定してください")
	}
	if c.RetentionDays < 1 || c.RetentionDays > 365 {
		return errors.New("保存対象期間は1〜365日で指定してください")
	}
	for _, id := range strings.Split(c.ChannelIDs, ",") {
		if s := strings.TrimSpace(id); s != "" && !model.IsValidId(s) {
			return errors.New("対象チャネルIDが正しくありません")
		}
	}
	p.mu.Lock()
	p.config = c
	p.mu.Unlock()
	return nil
}
func (p *Plugin) configuration() configuration { p.mu.RLock(); defer p.mu.RUnlock(); return p.config }
func (c configuration) allows(id string) bool {
	if strings.TrimSpace(c.ChannelIDs) == "" {
		return true
	}
	for _, v := range strings.Split(c.ChannelIDs, ",") {
		if strings.TrimSpace(v) == id {
			return true
		}
	}
	return false
}
func expiry(post *model.Post, c configuration) int64 {
	return post.CreateAt + int64(c.RetentionDays)*24*60*60*1000
}
func (p *Plugin) accessiblePost(userID, postID string, c configuration) (*model.Post, int) {
	if !model.IsValidId(postID) {
		return nil, http.StatusBadRequest
	}
	post, err := p.API.GetPost(postID)
	if err != nil || post == nil || post.DeleteAt != 0 {
		return nil, http.StatusNotFound
	}
	if _, err = p.API.GetChannelMember(post.ChannelId, userID); err != nil {
		return nil, http.StatusForbidden
	}
	if !p.API.HasPermissionToChannel(userID, post.ChannelId, model.PermissionReadChannel) {
		return nil, http.StatusForbidden
	}
	if !c.allows(post.ChannelId) || post.Type != "" || post.CreateAt <= 0 || expiry(post, c) <= time.Now().UnixMilli() {
		return nil, http.StatusNotFound
	}
	return post, http.StatusOK
}
func (p *Plugin) ServeHTTP(ctx *plugin.Context, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	userID := r.Header.Get("Mattermost-User-Id")
	if !model.IsValidId(userID) || ctx == nil || ctx.SessionId == "" {
		writeError(w, 401, "認証が必要です")
		return
	}
	// Bind identity to Mattermost's verified session, never a supplied body/user ID.
	session, err := p.API.GetSession(ctx.SessionId)
	if err != nil || session == nil || session.UserId != userID || session.IsExpired() {
		writeError(w, 401, "認証が必要です")
		return
	}
	c := p.configuration()
	if r.URL.Path == "/api/v1/config" && r.Method == http.MethodGet {
		writeJSON(w, 200, map[string]any{"enabled": c.TrackingEnabled, "dwell_ms": c.DwellMilliseconds, "retention_days": c.RetentionDays, "channel_ids": channelIDs(c.ChannelIDs)})
		return
	}
	if !c.TrackingEnabled {
		writeError(w, 503, "表示確認は無効です")
		return
	}
	if r.Method == http.MethodPost && r.Header.Get("X-Requested-With") != "ViewportReadReceipts" {
		writeError(w, 403, "要求ヘッダーが必要です")
		return
	}
	switch {
	case r.URL.Path == "/api/v1/seen" && r.Method == http.MethodPost:
		if session.IsMobileApp() {
			writeError(w, 403, "スマートフォンアプリは対象外です")
			return
		}
		p.handleBatch(w, r, userID, c, true)
	case r.URL.Path == "/api/v1/counts" && r.Method == http.MethodPost:
		p.handleBatch(w, r, userID, c, false)
	case strings.HasPrefix(r.URL.Path, "/api/v1/readers/") && r.Method == http.MethodGet:
		postID := strings.TrimPrefix(r.URL.Path, "/api/v1/readers/")
		post, status := p.accessiblePost(userID, postID, c)
		if status != 200 {
			writeError(w, status, "対象の投稿を取得できません")
			return
		}
		if post.UserId != userID {
			writeError(w, 403, "既読者一覧は投稿者のみ閲覧できます")
			return
		}
		row, e := p.load(postID)
		if e != nil {
			writeError(w, 500, "記録を取得できません")
			return
		}
		readers := make([]reader, 0, len(row.UserIDs))
		for _, id := range row.UserIDs {
			if id == post.UserId {
				continue
			}
			// Former channel members and deactivated users are not disclosed.
			if _, e := p.API.GetChannelMember(post.ChannelId, id); e != nil {
				continue
			}
			u, e := p.API.GetUser(id)
			if e != nil || u == nil || u.DeleteAt != 0 {
				continue
			}
			name := strings.TrimSpace(u.FirstName + " " + u.LastName)
			if name == "" {
				name = u.Username
			}
			readers = append(readers, reader{UserID: id, Username: u.Username, DisplayName: name})
		}
		sort.Slice(readers, func(i, j int) bool { return readers[i].Username < readers[j].Username })
		writeJSON(w, 200, map[string]any{"readers": readers})
	default:
		writeError(w, 404, "見つかりません")
	}
}

type reader struct {
	UserID      string `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

func channelIDs(s string) []string {
	out := []string{}
	for _, id := range strings.Split(s, ",") {
		if id = strings.TrimSpace(id); id != "" {
			out = append(out, id)
		}
	}
	return out
}

type batchRequest struct {
	PostIDs []string `json:"post_ids"`
}

func decodeBatch(w http.ResponseWriter, r *http.Request) ([]string, error) {
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var b batchRequest
	if err := dec.Decode(&b); err != nil {
		return nil, err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return nil, errors.New("余分なデータがあります")
	}
	if len(b.PostIDs) == 0 || len(b.PostIDs) > maxBatch {
		return nil, errors.New("投稿は1〜50件で指定してください")
	}
	seen := map[string]bool{}
	ids := []string{}
	for _, id := range b.PostIDs {
		if !model.IsValidId(id) {
			return nil, errors.New("投稿IDが正しくありません")
		}
		if !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	return ids, nil
}

type batchItem struct {
	Count   int  `json:"count"`
	CanList bool `json:"can_list"`
}

func (p *Plugin) handleBatch(w http.ResponseWriter, r *http.Request, userID string, c configuration, record bool) {
	ids, e := decodeBatch(w, r)
	if e != nil {
		writeError(w, 400, "要求の形式が正しくありません")
		return
	}
	result := map[string]batchItem{}
	memberCache := map[string]bool{}
	isActiveMember := func(channelID, userID string) bool {
		key := channelID + userID
		if active, ok := memberCache[key]; ok {
			return active
		}
		active := false
		if _, e := p.API.GetChannelMember(channelID, userID); e == nil {
			if u, e := p.API.GetUser(userID); e == nil && u != nil && u.DeleteAt == 0 {
				active = true
			}
		}
		memberCache[key] = active
		return active
	}
	rejected := map[string]int{}
	for _, id := range ids {
		post, status := p.accessiblePost(userID, id, c)
		if status != 200 {
			rejected[id] = status
			continue
		}
		if record && userID != post.UserId {
			if e = p.record(post, userID, c); e != nil {
				rejected[id] = 500
				continue
			}
		}
		row, e := p.load(id)
		if e != nil {
			rejected[id] = 500
			continue
		}
		count := 0
		for _, uid := range row.UserIDs {
			if uid != post.UserId {
				if isActiveMember(post.ChannelId, uid) {
					count++
				}
			}
		}
		result[id] = batchItem{Count: count, CanList: post.UserId == userID}
	}
	writeJSON(w, 200, map[string]any{"posts": result, "rejected": rejected})
}
func (p *Plugin) load(id string) (receipt, error) {
	raw, e := p.API.KVGet("receipt_" + id)
	if e != nil {
		return receipt{}, e
	}
	var row receipt
	if len(raw) > 0 {
		if e := json.Unmarshal(raw, &row); e != nil {
			return row, e
		}
	}
	return row, nil
}
func (p *Plugin) record(post *model.Post, userID string, c configuration) error {
	key := "receipt_" + post.Id
	for attempt := 0; attempt < 8; attempt++ {
		raw, e := p.API.KVGet(key)
		if e != nil {
			return e
		}
		var row receipt
		if len(raw) > 0 {
			if e := json.Unmarshal(raw, &row); e != nil {
				return e
			}
		}
		for _, id := range row.UserIDs {
			if id == userID {
				return nil
			}
		}
		if row.RetentionDays == 0 || c.RetentionDays < row.RetentionDays {
			row.RetentionDays = c.RetentionDays
		}
		row.UserIDs = append(row.UserIDs, userID)
		sort.Strings(row.UserIDs)
		next, e2 := json.Marshal(row)
		if e2 != nil {
			return e2
		}
		storedConfig := c
		storedConfig.RetentionDays = row.RetentionDays
		ttl := (expiry(post, storedConfig) - time.Now().UnixMilli()) / 1000
		if ttl <= 0 {
			return errors.New("保存期間外です")
		}
		ok, e := p.API.KVSetWithOptions(key, next, model.PluginKVSetOptions{Atomic: true, OldValue: raw, ExpireInSeconds: ttl})
		if e != nil {
			return e
		}
		if ok {
			return nil
		}
	}
	return fmt.Errorf("concurrent receipt update; retry later")
}
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// Remove receipts when the underlying post is deleted, before the normal TTL.
func (p *Plugin) MessageHasBeenDeleted(_ *plugin.Context, post *model.Post) {
	if post != nil {
		if err := p.API.KVDelete("receipt_" + post.Id); err != nil {
			p.API.LogError("receipt deletion failed")
		}
	}
}
