# Viewport Read Receipts for Mattermost

English | [日本語](README.ja.md)

A community plugin for **Mattermost Team Edition 12.0.1** that records when a post is displayed in the foreground of the web or desktop client. Opening a channel alone does not mark every post as read, and no mention is required.

**Status:** Installation, reader counts, and the reader list have been reported working on a real Mattermost server. End-to-end acceptance testing with separate accounts, off-screen posts, background tabs, and every thread view is still in progress. Automated tests use a standalone browser fixture and mock APIs; they are not a substitute for server acceptance testing.

The current plugin interface and administrative settings are in Japanese. This repository provides both English and Japanese documentation. This is an independent project, not an official Mattermost product.

## What users see

- An eye icon and a reader count, such as `既読 3`, below each post.
- Only the **post author** can click the badge to see reader names and usernames. Being a system administrator does not grant access to another author's reader list through this plugin's API.
- Other current channel members can see the count, but not the reader list.
- The author is excluded from the count. Viewing the same post in another tab or another supported view does not count the same user twice.
- A thread's parent post and each reply are tracked independently. The same post ID shares one receipt across channel and thread views.

The following screenshots use fictional content in a development fixture. They are not screenshots of production conversations.

![Reader counts below individual posts](assets/preview-channel.png)

![Reader list available only to the post author](assets/preview-readers.png)

## What “read” means

The default requires **one continuous second** with all of the following conditions:

1. The document is visible and has focus.
2. At least 50% of the post's width is visible. The required visible height is 50% of the smaller of the content height and the scroll viewport height.
3. Clipping by scroll containers and collapsed content is taken into account.
4. At least three of five sampled points are exposed, rather than covered by another element such as a dialog.

Leaving the visible area, losing focus, or hiding the document resets the timer. Sampling gaps longer than 250 ms also reset it. Visibility is sampled every 100 ms and on relevant events. Counts refresh approximately every five seconds, subject to network and processing delays.

For file-only posts, the attachment area is checked. For posts containing text and attachments, displaying the text does not prove that an attachment was opened. Part of a long post may satisfy the display condition; it does not prove the entire post was read. A small collapsed area may require expansion before it qualifies.

**A receipt means the display condition was met. It does not prove attention, reading, understanding, or availability to respond.** A missing receipt is not proof that a user has not seen the message.

## Privacy and access control

- Receipt values contain user IDs and the retention-day setting, not precise viewing timestamps, message text, IP addresses, or device details.
- Names are retrieved from Mattermost when the author requests the list.
- Requests require an authenticated session, current channel membership, and channel-read permission. Former members and deactivated users are excluded from counts and reader lists.
- There is no named “unread users” list.
- Normal Mattermost, database, reverse-proxy, and backup records are outside the scope of this plugin's receipt schema.
- Clients report their own display events. These receipts are not tamper-proof audit evidence.

Explain the purpose, scope, visibility, and retention policy to users before enabling tracking. Do not use these display receipts as proof of work performance or an obligation to reply immediately.

## Supported scope and limitations

| Area | Scope |
|---|---|
| Public/private channels, DMs, and group DMs | Designed to work without paid-license-specific APIs |
| Main channel view, right-hand thread, and Threads view | Standard post containers are targeted; individual server acceptance tests remain necessary |
| Web and desktop | Share the web plugin; the actual desktop application still requires acceptance testing |
| Native mobile apps | Not supported; receipt writes from mobile-app sessions are rejected |
| Mobile web browsers | May participate if they load the same web plugin |
| System messages and custom post types | Not tracked; only standard posts with an empty type are tracked |
| Search results and special saved-post views | Not tracked as display events |
| Edited posts | Existing receipt remains associated with the post ID; it does not prove the edit was read |
| Offline use | Only successfully saved receipts count; unsent history is not persisted |
| OS-level visibility and attention | Cannot be fully established by browser APIs |

This plugin uses DOM selectors verified against the Mattermost 12.0.1 source. A Mattermost upgrade or another plugin may require adapter changes. Load, restart recovery, and database expiry behavior have not all been validated on a real server.

## Installation

Download **`com.nito.viewport-read-receipts-0.1.2.tar.gz`** and **`SHA256SUMS`** from [Releases](https://github.com/kazunito/mattermost-plugin-viewport-read-receipts/releases). GitHub's automatically generated source archives are not the installation bundle.

1. Verify the archive checksum against `SHA256SUMS`.
2. In the Mattermost System Console, open plugin management and upload the installation archive. Your server must permit installation of custom plugins under its own policy.
3. Enable the plugin. **Tracking is disabled by default** through the separate `TrackingEnabled` setting.
4. Set `ChannelIDs` to a limited test channel initially, explain the policy to participants, and then enable tracking.
5. Reload the web or desktop client and complete acceptance tests with separate author and reader accounts.

The detailed [installation and acceptance guide](docs/導入と受入確認.md) is currently in Japanese.

| Setting key | Default | Meaning |
|---|---|---|
| `TrackingEnabled` | `false` | Enables receipt writes, counts, and lists |
| `DwellMilliseconds` | `1000` | Continuous display duration, 250–10000 ms |
| `RetentionDays` | `30` | Eligible period after post creation, 1–365 days |
| `ChannelIDs` | Empty | Comma-separated allowed channel IDs; empty means all supported conversation types |

Retention is anchored to **post creation**, not first viewing. Repeated views and additional readers do not extend existing receipt expiry. Increasing the retention setting does not extend an existing record's deadline. Shortening it immediately restricts API eligibility, but an existing KV entry can retain its previous physical expiry until updated. Strict immediate erasure requires a separate data-removal procedure. Post deletion also requests deletion of its receipt.

Client configuration refreshes about every 30 seconds; reload to fetch it immediately. Server restrictions apply to the next request. Disabling the plugin's tracking setting stops the APIs but does not immediately erase stored receipts or backups.

## Development

Requirements: Go 1.24.6 or later, Node.js 22 or later (the development version is in `.nvmrc`), npm, Python 3, and make.

Run from the repository root:

```sh
make deps
npm --prefix webapp exec -- playwright install chromium
make check-style
make test
make dist
```

On Linux, [Playwright's CI instructions](https://playwright.dev/docs/ci-intro) cover system dependencies, including `playwright install --with-deps chromium` where required. Tests use the downloaded Chromium with `channel: chromium` (new headless mode). Optionally set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing browser; no personal browser path is hard-coded.

```text
.github/workflows/  GitHub Actions checks
assets/            Screenshots with fictional data
build/             Installation bundle creation
server/            Go server code and tests
webapp/src/        Receipt UI and display detection
webapp/tests/      Browser tests and standalone fixture
docs/              Detailed Japanese documentation
plugin.json        Plugin identity and settings
Makefile           Dependency, check, test, and distribution commands
dist/              Generated installation archives (not tracked)
```

`make dist` builds server executables for Linux amd64/arm64 and macOS arm64, the web bundle, and an archive with `LICENSE` and `NOTICE` under `dist/`. The plugin ID remains `com.nito.viewport-read-receipts` for compatibility with existing installations.

## Validation

The local suite has 21 browser tests, server tests with the race detector, static checks, type checks, and bundle verification. See [verification details](docs/検証結果.md), [design notes](docs/設計と検証.md), and the [changelog](CHANGELOG.md) in Japanese for the exact scope and remaining acceptance items. GitHub Actions results should be checked separately from local results.

## License

The project source is licensed under [Apache License 2.0](LICENSE). Dependencies remain under their respective licenses; see [NOTICE](NOTICE), `go.mod`, and `webapp/package-lock.json`.
