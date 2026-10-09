# User Card MBTI Migration

Reviewed on 2026-10-09. Scope: `src-tauri/src/commands/user_profile.rs`,
`src-tauri/src/dto/user.rs`, their module tests, and this document. Shared checkout;
no commits, dependencies, Cargo/lock, auth/state, shell, or user-card UI changes.
This is separate from the legacy cloud emoji bridge.

## Source Evidence

- Legacy `D:/project-workspace/fishp-refactor/fishpi-desktop/src/renderer/view/card.vue`
  requests `this.$fishpi.user(user)` and renders `info.mbti` only when present.
  The personality link uses the base type before the optional `-A` / `-T` suffix.
- Installed release source:
  `C:/Users/Admin/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/fishpi-sdk-1.1.1/src`.
  `client/user.rs::UserApi::profile` reads `user/{username}` with `apiKey` query,
  then decodes the root JSON object, not a `data` envelope.
- `domain/user.rs::UserInfo` has no `Deserialize` implementation and no MBTI
  member. This is not an implementation blocker: `wire::user::WireUserInfo` is
  public, supports `Deserialize`, and has a public conversion into `UserInfo`.
  The command uses that existing conversion and takes only the exact root
  `mbti` field from the same response. It does not guess aliases or duplicate
  the SDK model.
- Current `src/features/overlay/api.ts::UserProfile` already has `mbti?: string`.
  `src/features/usercard/UserCardPage.tsx` already renders `profile.mbti`.
  No central TypeScript type or command registration changes are required.

## Implemented Contract

- One GET to fixed `https://fishpi.cn/user/{username}`; structured
  `path_segments_mut().push(...)` keeps the username inside one encoded segment.
  Empty / dot / overlong names and path separators, controls, or whitespace are
  rejected. Query / fragment characters and literal percent signs are encoded,
  never interpolated into the URL.
- The API key comes only from the current Rust SDK session snapshot and is
  appended with structured query serialization. There is no keyring reload,
  token return value, credential write, request/body logging, or URL forwarding
  through errors. Unexpected response fields are not copied into the DTO.
- Uses SDK `current_http_proxy_config()` with the same local three-way policy
  as `commands/emoji_cloud.rs`: `NoProxy` disables automatic proxies, `System`
  preserves reqwest system-proxy selection, and `Custom` disables automatic
  proxies and installs the configured proxy. Empty/invalid custom configuration
  fails with a fixed network error, without exposing its URL or credentials.
  No cross-module networking abstraction was introduced.
- Connection timeout: 8 seconds; total request/body timeout: 15 seconds.
  Redirects are rejected. The command has no retry loop, fallback endpoint,
  second profile fetch, or write request.
- Accepts HTTP 200 only; handles unauthorized, rate-limit, not-found, redirect,
  and server failures without forwarding locations, bodies, or server messages.
  Integer `Retry-After` seconds use checked millisecond conversion.
- Checks declared response length and every accumulated body chunk against
  256 KiB. Empty/invalid UTF-8, malformed/trailing JSON, incorrect known-field
  types, duplicate known fields, and wrong-user/root-envelope responses fail
  explicitly. SDK-confirmed visitor verification HTML is classified, not returned.
- Preserves SDK `WireUserInfo -> UserInfo -> UserProfileDto` mappings, including
  existing medal conversion and enabled-medal filtering.
- MBTI permits exactly the 16 uppercase `[EI][NS][FT][JP]` types, optionally
  followed by `-A` or `-T`. Missing/null/empty/private/invalid strings produce
  no MBTI field, not a default or inferred personality. A non-string non-null
  MBTI fails strict response parsing.
- `UserProfileDto.mbti: Option<String>` is omitted from serialized JSON when
  absent. Both `result.profile.mbti` and compatibility `result.user.mbti` carry
  the same validated value. Existing top-level compatibility fields are unchanged.
- The command rechecks session generation before returning either success or
  failure. A late unauthorized response must not invalidate a newer account.
  It neither updates the current account nor changes auth/state.

## Tests

Six persistent unit tests in `commands/user_profile.rs` cover:

1. Fixed origin and one encoded username segment, query/fragment injection,
   literal percent encoding, Unicode, and invalid names.
2. All 16 types with all three allowed suffix choices, invalid inputs, and absence.
3. Existing SDK fields/medals, both DTO envelopes, session generation, and exclusion
   of synthetic token/apiKey/email response fields.
4. Missing/null/private/invalid MBTI and unconfirmed aliases remain absent;
   incorrect MBTI type is rejected.
5. Wrong accounts/envelopes/types, duplicates/trailing JSON, UTF-8/HTML and
   verification pages, body limits, and static business/auth errors.
6. HTTP status/redirect handling, location redaction, and numeric `Retry-After`.

All fixtures use synthetic data. No user credentials or live FishPi endpoint
have been read for these tests.

## Verification And Remaining Boundaries

- 2026-10-09: all six profile tests compiled and passed using `rustc --test`
  against existing compatible SDK 1.1.1 / reqwest / serde / Tauri build artifacts.
  This compiled the actual command (including its Tauri macro), DTO, and error
  sources; only auth/session helpers were replaced by panic-only stubs to prevent
  credential access. Temporary harness/scripts/output were removed afterward.
  This is an isolated module check, not a full-application Cargo result.
- `rustfmt --check` and scoped `git diff --check` passed for the two Rust files.
- Final Cargo tests/build remain owned by the parent thread. A focused command
  after integration is `cargo test --locked --offline --lib commands::user_profile::tests`.
- Live/private/missing-MBTI profiles, system/custom proxy routing, visitor
  verification, and account switching still need real Tauri acceptance.
  Static/unit checks do not prove those live behaviors.
- This migration restores read/display of the legacy field. It does not add
  MBTI editing, profile writes, check-in writes, new APIs, or cloud emoji behavior.
- Older broad migration notes describing MBTI as unavailable are superseded for
  this read path by this module record; no claim is made about unrelated SDK gaps.
