---
feature: theme-shell-login
status: in-progress
updated: 2026-09-23
branch: master
commits:
---

# Theme Shell Login

## Report

## [S1] Problem

Current Tauri app still uses「夜港灯塔」dark tokens and a 56px icon-only rail. Approved mockup (`design-preview/ui-redesign-4.html`) locked old-client layout with four switchable skins. Need first implementation slice: **AppShell + LoginPage only**, default theme 工位红 (desk).

## [S2] Design

### Decisions

- Workspace: current `fishpi-desktop-refactor-tauri` (user override: no worktree). No git commit unless user asks.
- Slice 1 scope: theme tokens, ThemeId/settings, AppShell chrome/layout, LoginPage. Chatroom/article internals later.
- Default theme: `desk` (工位红). Four skins: `desk` | `cx` | `ding` | `feishu`.
- Theme applied via `html[data-theme]` (existing `applyTheme`).
- Layout follows old client (`home.vue` / `header.vue` / `login.vue`): 40px title bar + 48px icon rail; login is centered form without rail.
- Keep Lucide icons and existing features (IM unread, settings, logout). Do not rewrite chatroom/article hosts.

### Token contract (`src/styles/tokens.css`)

`:root` = desk defaults. All skins override the same names.

| Token | desk | cx | ding | feishu |
|---|---|---|---|---|
| `--color-bg` | `#232425` | `#0f1216` | `#eef2f7` | `#f5f6f7` |
| `--color-bg-raised` | `#191a1b` | `#161c22` | `#ffffff` | `#ffffff` |
| `--color-bg-sidebar` | `#191a1b` | `#0c0f12` | `#e8eef5` | `#ffffff` |
| `--color-bg-input` | `#2c2e30` | `#0a0c0f` | `#ffffff` | `#f2f3f5` |
| `--color-bg-hover` | `#2c2e30` | `#1a2228` | `#e4ebf3` | `#f0f1f3` |
| `--color-text` | `#e7e2da` | `#d5dbd7` | `#1b2330` | `#1f2329` |
| `--color-text-muted` | `#9b958c` | `#7c857f` | `#7a8698` | `#8f959e` |
| `--color-text-faint` | `#6e655c` | `#5c655f` | `#9aa5b1` | `#a0a6ad` |
| `--color-accent` | `#d23f31` | `#4dc490` | `#1e80ff` | `#3370ff` |
| `--color-accent-hover` | `#e24a3a` | `#5fd0a0` | `#3d91ff` | `#4b82ff` |
| `--color-accent-pressed` | `#b83226` | `#3aa87a` | `#0d6eef` | `#2860e1` |
| `--color-accent-text` | `#ffffff` | `#071510` | `#ffffff` | `#ffffff` |
| `--color-border` | `#343739` | `#252b32` | `#d5dde6` | `#e5e6eb` |
| `--color-border-strong` | `#4a4e51` | `#3a434c` | `#b7c4d4` | `#c9cdd4` |
| `--color-brass` | `#c4a574` | `#4dc490` | `#1e80ff` | `#3370ff` |
| `--color-danger` | `#c44b3c` | `#e07a6a` | `#ff5000` | `#f54a45` |
| `--color-ok` | `#6a9a6d` | `#4dc490` | `#1e80ff` | `#3370ff` |
| `--color-focus` | `#e0b070` | `#4dc490` | `#1e80ff` | `#3370ff` |
| `--color-bubble` | `#f6f8fa` | `#e4ebe6` | `#ffffff` | `#f0f1f3` |
| `--color-bubble-ink` | `#232425` | `#141c18` | `#1b2330` | `#1f2329` |
| `--color-bubble-self` | `#515a6e` | `#1c342a` | `#1e80ff` | `#3370ff` |
| `--color-bubble-self-ink` | `#f6f8fa` | `#d5f5e4` | `#ffffff` | `#ffffff` |
| `--color-header-bg` | `#181a1b` | `#0a0c0f` | `#f5f8fb` | `#ffffff` |
| `--font-display` | KaiTi/Serif | IBM Plex Mono | Noto Sans SC | Noto Sans SC |
| `--sidebar-width` | 48px | 48px | 48px | 48px |
| `--header-height` | 40px | 40px | 40px | 40px |
| `--radius-md` | 5px | 6px | 4px | 10px |

Also set shadcn aliases in `themes.css` per theme (`--background` → `--color-bg`, `--primary` → `--color-accent`, etc.) as today.

### ThemeId contract

- `src/features/settings/types.ts`: `THEME_IDS = ["desk","cx","ding","feishu"]`.
- `DEFAULT_SETTINGS.themeId = "desk"`.
- `THEME_OPTIONS`: 工位红 / Codex / 钉钉 / 飞书 with short blurbs from mockup.
- `theme.ts` `applyTheme`: `html.dataset.theme = id`; `dark` class for `desk`|`cx` only.
- Migrate stored `default`|`daybreak`|`contrast` → `desk` in `resolveThemeId`.

### AppShell contract

Structure (old client):

```
.shell
  header.shell__header (40px, drag)
    brand mark + 摸鱼派 - {page title}
    .shell__header-mid  (theme slots: music | cx status | ding search | feishu crumb)
    .shell__win-ctrl (min / opacity / pin / close — wire later; visual only OK)
  .shell__body
    aside.shell__rail (48px)
      avatar, 聊天室, 私聊+badge, 清风明月, 帖子, 活动 | sep | 设置, 账号菜单
    aside.shell__im (existing)
    section.shell__main (existing pages)
```

- Icons stay Lucide. Rail is icon-only with tooltips (current pattern).
- Title: `摸鱼派 - 聊天室|帖子|清风明月|活动|播放列表|设置`.
- Theme chrome: `data-theme="ding"` show search placeholder「搜索或提问 (Ctrl+Shift+F)」; `feishu` show crumb「全部会话」+「新建」pill (visual); `cx` show `model stream · idle`; `desk` show compact music placeholder.
- Keep IM panel, LivenessEdge, broadcast, overlays unchanged in behavior.

### LoginPage contract

- Drop side rail. Centered column: logo mark + 「摸鱼派·登录」+ username/password/MFA fields with leading icons (lucide User/Lock/Shield) + 密码显示切换 + 登录/注册 row.
- Same submit logic and error/notice alerts as today.
- Width `min(340px, 86%)`. No desktop-only chrome required (login is pre-shell).

## [S3] Out of Scope

- Chatroom / article / activity / breezemoon visual redesign.
- Real window min/max/close IPC wiring (visual buttons only if present).
- External theme files, plugin themes.
- Mobile breakpoints.
- Git commit / PR.

## Tasks

- [x] T1: tokens.css four skins + shared metrics — acceptance: `:root` desk; `html[data-theme=cx|ding|feishu]` override table tokens; typecheck unaffected (covers: S2 token contract)
- [x] T2: themes.css shadcn aliases per skin — acceptance: `--primary/--background/--border` map to color tokens for all four themes (covers: S2 token contract; depends: T1)
- [x] T3: ThemeId + settings options + applyTheme migrate — acceptance: default desk; options 4 labels; old ids resolve to desk (covers: S2 ThemeId; depends: T1)
- [x] T4: AppShell header + 48px rail layout — acceptance: 40px header with brand/title/win-ctrl; 48px icon rail; nav still switches pages (covers: S2 AppShell; depends: T1)
- [x] T5: AppShell theme header slots — acceptance: desk/cx/ding/feishu mid chrome matches contract (covers: S2 AppShell; depends: T4)
- [x] T6: LoginPage centered form — acceptance: no rail; logo title; icon fields; login/register behavior unchanged (covers: S2 LoginPage; depends: T1)
- [x] T7: LoginPage skin via tokens only — acceptance: four themes render without broken contrast on inputs/buttons (covers: S2 LoginPage; depends: T6)
- [x] T8: typecheck `npx tsc --noEmit` — acceptance: only PRE-EXISTING tsconfig baseUrl deprecation; no new type errors (covers: S2; depends: T1–T7)

### Slice 2 — content pages (fine grain)

Contract: use `--color-bubble`, `--color-bubble-ink`, `--color-bubble-self`, `--color-bubble-self-ink`, `--radius-md`, `--color-*` from tokens. No hard-coded 夜港灯塔 hex. Old-client density: avatar left + arrow bubble for others; self row-reverse.

- [x] T9: chatroom.css map bubbles/panels to bubble tokens — acceptance: `.chatroom` vars use `--color-bubble*`; no `#1f1c19` defaults (covers: S2 tokens)
- [x] T10: MessageItem + MessageList layout (avatar 35 / username / arrow bubble / self reverse) — acceptance: visual matches mockup chat; behavior unchanged (covers: S2; depends: T9)
- [x] T11: Composer toolbar + send strip to tokens — acceptance: toolbar icons + textarea + send use accent/border tokens on all skins (covers: S2; depends: T9)
- [x] T12: OnlineBar / online panel to tokens — acceptance: collapsible online list readable on ding/feishu light skins (covers: S2; depends: T9)
- [x] T13: article.css list + detail header density — acceptance: list rows + sticky meta use tokens; light skins not washed out (covers: S2; depends: T9)
- [x] T14: article comments + MarkdownBody spacing — acceptance: comment cards + md body use tokens/radius (covers: S2; depends: T13)
- [x] T15: settings.css fix light-skin layout — acceptance: readable on ding/feishu; sections/forms not stuck dark-only (covers: S2; depends: T9)
- [x] T16: settings theme picker swatches + form controls — acceptance: 4 theme cards use preview vars; inputs/switches themed (covers: S2; depends: T15)
- [x] T17: im.css conversation list + thread to tokens — acceptance: IM panel readable on all skins (covers: S2; depends: T9)
- [x] T18: IM MessageBubble + Composer density — acceptance: self/other bubbles use bubble tokens; composer strip themed (covers: S2; depends: T17)
- [x] T19: slice-2 typecheck — acceptance: only PRE-EXISTING TS5101 (covers: S2; depends: T9–T18)
