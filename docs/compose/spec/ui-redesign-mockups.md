---
feature: ui-redesign-mockups
status: delivered
updated: 2026-09-23
branch: master
commits: n/a  # workspace decision: no git commit
---

# UI Redesign High-Fidelity Mockups

## Report

**What was built** — Four strongly differentiated desktop-only visual directions (A macOS native, B Discord/Slack dark IM, C Codex disguise, D Terminal work) as a single openable multi-switch HTML mockup covering chatroom, login, article list+detail, and activity/check-in. A companion Canvas board compares layout skeletons, palettes, and screen coverage. Production `src/` was not modified; existing `design-preview/ui-directions.html` left untouched.

**Verification** —
- HTML nesting parser: PASS (0 structural errors)
- Content checks: PASS (4 direction buttons, 4 screen buttons, 4 chat panes mac/dc/cx/tm, login/article/activity present, article+activity inside shell, login outside shell)
- Independent review: Spec compliance PASS · Correctness PASS · Codebase consistency PASS; no critical findings
- Canvas: only `cursor/canvas` imports; forbidden-pattern grep (gradient/box-shadow/emoji) → 0 matches

**Journey log** —
1. Grill settled: mockups only; repo HTML primary + Canvas comparison; current directory workspace (no worktree, no commit).
2. Four style keywords locked: macOS native / Discord IM / Codex disguise / Terminal work.
3. Early HTML nesting broke while inlining login into shell; fixed by keeping login as shell sibling and article/activity inside `.main`.
4. Direction/screen visibility moved to pure CSS on `body[data-dir]` / `body[data-screen]` to avoid inline-style races.
5. Review passed first pass with zero criticals.

## [S1] Problem

User rejected a previous mockup that redesigned the layout. They want **4 theme-only skins on the old client layout** (`fishpi-desktop` Vue/Electron), no Canvas, high-fidelity HTML only. Pain: dull palette, rough finish — but layout must follow old home/chatroom/login/articles structure.

## [S2] Design

### Decisions

- Scope: mockups only; do not modify `src/`, styles, or business components.
- Workspace: current directory `fishpi-desktop-refactor-tauri`; no worktree, no git commit (user override of compose-next default commit step).
- Platform: desktop only; no mobile breakpoints required beyond a usable preview frame.
- Primary deliverable: one multi-direction HTML under `design-preview/`.
- Secondary deliverable: one `.canvas.tsx` comparison of the four directions.
- Cover screens per direction: chatroom shell, login, article list+detail, activity/check-in.

### Layout contract (locked to old client)

From `fishpi-desktop` (`home.vue`, `index.vue`/`header.vue`, `chatroom.vue`, `chatroom-item.vue`, `messagebox.vue`, `login.vue`, `articles.vue`):

- Header 40px: logo + `摸鱼派 - title` + music player + min/opacity/pin/close.
- Left icon rail `3em` (48px): avatar, 聊天室, 私聊, 清风明月, 帖子, extension slots; bottom 扩展/设置.
- Chatroom: message list (avatar 35px + username line + left-arrow bubble + optional +1 / 也这么说), topic line `#…#`, MessageBox (toolbar + resize hr + textarea + send plane), right online sidebar `~10em` with collapse toggle (`当前在线(N)` + search + list).
- Self messages: row-reverse, darker bubble (`--main-chatroom-user-message-*`).
- Login: centered logo `摸鱼派·登录` + user/pass/mfa fields with prepend icons + 登录/注册.
- Articles: row list avatar + title + views pill; detail = sticky header (back, title, meta, heat bar) + body + comments.

### Four themes (same layout, different skin)

1. **A · 工位红** — legacy desk: carbon `#232425`, active `#d23f31`, white bubbles `#f6f8fa`, self `#515a6e`.
2. **B · Codex 伪装** — graphite + restrained soft green; AI-assistant camouflage (refined).
3. **C · 钉钉** — cool blue-gray IM (`#EEF2F7` canvas, `#1E80FF`), dense list, square-ish radius 4px, header search「搜索或提问」, status pill「奋斗中」. DingTalk camouflage.
4. **D · 飞书** — white collaborative shell, gradient brand mark (`#615FFF→#3370FF`), radius 10px, crumb +「新建」pill, airy spacing. Feishu/Lark camouflage.

All four are one-click switchable theme presets. Layout does not change.

### HTML contract

- Single entry: `design-preview/ui-redesign-4.html` (new file; leave `ui-directions.html` untouched).
- Switchers: direction (A–D) × screen (chatroom / login / article / activity).
- Desktop window frame ~1200×780 preview; realistic Chinese copy from FishPi — no empty placeholders.
- Inline CSS/JS only; no build step; openable via `file://`.
- Follow frontend-design quality bar; avoid generic AI-default tells.

### Canvas

**Dropped** at user request this revision. HTML only.

## [S3] Out of Scope

- Applying any direction to production `src/` styles or components.
- Mobile/tablet layouts.
- Committing, branching, or opening PRs (explicitly waived this session).
- Functional interactivity beyond mockup screen/direction switching.
- Modifying existing `design-preview/ui-directions.html`.

## Tasks

- [ ] T1: Rebuild HTML with locked old layout × 4 themes × 4 screens — acceptance: `design-preview/ui-redesign-4.html` matches old home/chatroom/login/articles structure; theme switch changes skin only (covers: S2)
- [ ] T2: Self-review quality — acceptance: dense but polished, no empty states, FA icons not emoji, realistic copy (covers: S2; depends: T1)
