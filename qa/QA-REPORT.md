# KPlayer 1.1.8 — QA Report (Tizen TV app)

**Date:** 2026-10-26
**Method:** Automated end-to-end drive of the real app in a Chromium environment with a simulated
Tizen `webapis.avplay` engine (`qa/mock-avplay.js`), driven over CDP (Edge headless, 1920x1080),
using the tester's real M3U playlist (1883 channels, 6 groups).
**Result:** **70 checks, 0 failures** across 21 test steps. **62 screenshots** in `qa/shots/`.
**8 findings** were raised in the first pass — **all 8 have been fixed and re-verified** (see §1).
Two post-report regressions found on-device/simulator were also fixed and covered by new checks (§2).

> **Deploy warning:** `dist/KPlayer-1.1.8.wgt` is stale (pre-fixes). **Rebuild and re-sign before
> sideloading to the TV.**

> **Rebuild status (2026-10-26):** Resolved — current build is `dist/KPlayer-1.1.10.wgt`
> (author cert identical to 1.1.8, About shows Version 1.1.10). It adds the VOD resume fallback
> (§2.1) and the polished Playlists UI (§2.2). `dist/KPlayer-1.1.9.wgt` remains as the previous
> incremental build.

---

## 2. Post-report fixes (found in the TV Web Simulator on this PC)

### F9 — Functional (High): VOD could never be resumed after OK-pause — **FIXED**
Pressing OK on a paused VOD did nothing (no toast, playback stayed frozen) in the Samsung TV
Web Simulator — and would on a real TV too.

- Root cause: `KP.Player.resume()` required `avplay.resume()`, but the real Tizen avplay API has
  **no `resume` method** (unpause is `avplay.play()`); it silently returned `false`.
- Fix: `player.js resume()` now calls `av.resume()` when available and falls back to `av.play()`.
- Evidence: simulator probe — `avplay` method list `resume: undefined`; after fix, engine log shows
  `webapis.avplay.play called` on resume; OK → paused → OK → playing verified on a real VOD.
- New QA check: step `resume-fallback` deletes `webapis.avplay.resume` and asserts `avplay.play()`
  is called and state returns to `playing` (`qa/shots/15-16-*.png`).

### F10 — UX (Medium): Playlists add flow felt cramped/unpolished — **FIXED**
User report: inputs not spacious, the submit button floated at the far bottom of the screen and the
top-right **Back** control was plain text instead of a real icon chip.

- Fix (`css/app.css`, playlists scope): input height 64→76u with roomier padding and field spacing;
  `.pl-form-actions` no longer uses `margin-top:auto`, so **Add playlist** now sits right beneath
  the fields; `.pl-flow-back` restyled as a pill button (border + tinted background + larger 24u
  arrow icon).
- Re-verified by the QA add-flow steps (`02–04`, `54` screenshots).

---

## 1. Findings — all fixed and re-verified

### F1 — SECURITY (High): Digit entry bypassed the group PIN lock — **FIXED**
Typing a channel number switched straight into a locked group (or played its channel) with no PIN prompt.

- Evidence (before): `qa/shots/47-pin-gate-bypass.png` (first pass) — channels view inside locked **India**, no PIN overlay.
- Root cause: `ui-channels.js` `_commitDigits()` set `app.groupIdx` directly; `ui-playback.js` `_commitDigits()` called `playChannel()` with no lock check.
- Fix: both paths now route through `KP.Views.pin.guardGroup(group.name, apply)` when the target
  channel's group is locked and different from the current one. Re-verified: digit jump into a locked
  group opens the pad (`qa/shots/47-pin-gate-digit.png`), correct PIN opens the group
  (`48-pin-gate-digit-open.png`); group-list gate, wrong-PIN message and unlock all still pass
  (`49–51`).

### F2 — UX (Medium): Pausing live TV gave no on-screen feedback — **FIXED**
PAUSED badge + "Paused" toast were VOD-only.

- Evidence (before): `qa/shots/13-player-paused-live.png` (first pass) showed no change.
- Root cause: `_markPaused` / `_toggleVodPause` gated on `isVod`.
- Fix: `_markPaused` now reflects engine pause state for live and VOD; `_toggleVodPause` renamed to
  `_togglePause` and shows the "Paused"/"Resumed" toast + info bar for both. Re-verified:
  `qa/shots/13-player-paused-live.png` now shows the centered "Paused" toast and the blue **PAUSED**
  badge in the info bar; badge hidden again after resume.

### F3 — UX (Medium): Guide opened on an empty group with dead arrow keys — **FIXED**
The guide opened on Favorites (0 channels) in grid focus; arrows did nothing until LEFT.

- Evidence (before): `qa/shots/26-guide-favorites-empty.png` (first pass).
- Fix: `ui-guide.js open()` switches focus to the group list (panel zone) when the current group has
  no channels. Re-verified: "guide focuses group list when group is empty" check passes.

### F4 — Cosmetic (Low): Guide time header clipped the first slot label — **FIXED**
`.g-time` labels are centered (`translateX(-50%)`), so the minute-0 label's left half overflowed the
timeline and was clipped, leaving a stray "00".

- Evidence (before): first-pass `qa/shots/27-guide.png` / `57-back-nav.png` ("Mon, Oct 26, 10:57 | 00 | 10:30").
- Fix: first label is left-aligned (`transform:none`) and the trailing window-end label is no longer
  rendered. Re-verified: header reads "Mon, Oct 26, 11:19 | 10:30 | 11:00" — no clipped fragment
  (current `qa/shots/27-guide.png`).

### F5 — Cosmetic (Low): Group navigation didn't wrap — **FIXED**
RIGHT/LEFT at the ends of the channel (and guide) group lists did nothing.

- Fix: both `_changeGroup` implementations wrap with modulo
  (`ui-channels.js`, `ui-guide.js`), matching zap/menu behavior. Covered by the pin-gate step which
  now walks LEFT from India all the way around when clamping.

### F6 — UX (Medium, found while fixing): Guide BACK armed app exit — **FIXED**
BACK in any guide zone called `armExit()` instead of navigating back.

- Fix: BACK in the guide now returns to the player (`KP.Shell.show("player")`), consistent with
  player-BACK → guide. Re-verified: "guide BACK returns to player" check + `qa/shots/59-back-nav-guide.png`.

### F7 — Note: RIGHT on the live player was swallowed — **FIXED**
RIGHT (39) during live playback did nothing. It now toggles the info bar (LEFT still opens the menu,
VOD seek unchanged).

### F8 — Cosmetic (Low): PIN pad empty bottom-left cell — **FIXED**
The dead slot is now a **C (clear)** key: focusable, clickable, resets the entered digits
(`ui-pin.js` `_press("C")`).

---

## 2. Verified working (all passing)

| Area | Verified behavior | Shots |
|---|---|---|
| Boot | Empty state opens Playlists automatically; "Add playlist" row present | 01 |
| Add M3U | Source chooser → URL form (URL typed intact, incl. dots) → busy → **1883 channels** parsed → success toast → player placeholder "Ready to watch" | 02–06 |
| Channel list | 21 rows rendered; digit buffer UI; `12` → focus jumps to channel 12; scroll follows focus | 07–10 |
| Live playback | Playback starts; info bar appears with channel title; auto-hides after ~4.5 s | 11–12 |
| Pause/resume (live) | Engine PAUSED→PLAYING; "Paused"/"Resumed" toasts; PAUSED badge appears and clears (F2 fix) | 13–14 |
| Jump-to-live | OK while paused re-opens the stream; paused badge cleared | 15 |
| AV panel | Opens via TOOLS; audio track row present; speed row correctly hidden for live; audio switch calls `setSelectTrack`; video fit change applies (`_displayMode`); closes with TOOLS | 16–18 |
| Zapping | ChannelUp/Down change channel; digit entry in player → "No channel 9999" toast | 19–20 |
| Error handling | Bad URL → error overlay with title, retryable; retry re-fires; BACK leaves overlay cleanly | 21–22 |
| Stream end | `onstreamcompleted` → ended state handled, UI recovers | 23 |
| Stall recovery | Freeze mid-stream → buffering overlay → resumes playing | 24–25 |
| TV Guide | Group rail with counts; rows render; "No guide data for this group" chip; now-line positioned via `transform`; clean time labels (F4 fix); OK on a row plays the channel; accent propagates to now-line | 26–29 |
| Schedule | Empty state without EPG; preview shows no-programme title; BACK sane | 30 |
| Search | "star" → 50 result cards; play works; BACK returns to search; Movies scope explains M3U limitation | 31–34 |
| VOD | Movies/Shows and My list both explain the Xtream-Codes requirement for M3U playlists | 35–36 |
| Settings | 6 sections; Zap-in-group + Last-channel-on-start toggles persist; Accent color live-updates app-wide; PIN set flow; group lock list (India locked); Backup export renders JSON + download link; About shows KPlayer / Version 1.1.8 | 37–46 |
| PIN gate | Digit jump into locked group → pad (F1 fix); group-list approach → pad; wrong PIN → "Wrong PIN"; correct PIN → group opens; unlock via settings persists | 47–51 |
| Playlist management | Row context menu (MENUBTN) = Reload/Rename/Remove; rename persists ("QA India Renamed"); failing URL → inline "Could not add" error + auto-removed | 52–55 |
| Zap-in-group | ChannelUp/Down stays within the current group | 56 |
| Boot restore | Restart with `lastChannelOnStart` → autoplays last channel | 57 |
| Back navigation | Player BACK → guide; guide BACK → player (F6 fix) | 58–59 |

---

## 3. Console / network errors observed (all benign)

| Error | Cause |
|---|---|
| `net::ERR_UNSAFE_PORT http://127.0.0.1:9/x.m3u` (x2) | Intentional failing-URL test in the playlists step (port 9 is blocked by Chromium) |
| `404 (Not Found)` (x1) | Missing favicon on the static test server — not an app request failure |

No unexpected JS exceptions or app errors during the full run.

---

## 4. How to re-run

```
cd D:\Projects\tizen\tvapp\qa
node drive.js
```

- Spawns the static+proxy server on `127.0.0.1:8093`, wipes `qa/profile` and `qa/shots`, drives the app
  headlessly, writes `qa/results.json` (per-check pass/fail), `qa/console.json` (errors), `qa/shots/NN-*.png`.
- `qa/mock-avplay.js` simulates the Tizen avplay engine (prepare/buffering/progress ticks, audio+video
  tracks, `freeze` for stalls, URL-based `fail`/`complete` triggers).
- Each run starts from a wiped profile (fresh install state), except the final step boots twice in one
  profile to verify last-channel restore.

## 5. Rig notes (not app bugs)

- CDP key-code mapping can't produce the TOOLS key → the rig dispatches a synthetic
  `KeyboardEvent('Tools')`; works because the app keys off `key`, not `keyCode`.
- CDP `Input.insertText`-style typing maps "." to VK 46 (Delete) — the rig types via
  `page.keyboard.type`, which is why URLs are typed intact.
- The `<object type="application/avplayer">` surface renders as a white "plug-in isn't supported" box
  in desktop Chromium; the rig hides it with CSS so the UI behind it is visible in screenshots.
- Digit-jump gate test note: the probe channel must live ONLY in the locked group. Channel numbers
  that also exist in "Recent channels" resolve within the current group and correctly never open the
  pad (that's how the in-group digit jump is supposed to work).

