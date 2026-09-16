# Cookie Editor & Storage Manager

A Chrome side panel for viewing and editing cookies, localStorage and
sessionStorage for the active tab.

Autonomy: **propose** — every change goes through a PR a human reviews.

> This extension holds `<all_urls>` and the `cookies` permission, so it can read
> every session cookie on the web. Treat anything touching cookie reads, writes,
> export or import as security-sensitive, and say so explicitly in your summary.

## Architecture

ES modules throughout: the service worker is `"type": "module"` and the side
panel loads as `<script type="module">`.

```
service-worker.js     message router; the only code that calls chrome.cookies
  storage/cookies.js      getCookies / setCookie / deleteCookie
  storage/webStorage.js   functions injected into the page via chrome.scripting
sidepanel.js          UI wiring, live sync, import/export  (DOM-bound)
  lib/cookie-model.js     pure helpers: identity, URLs, normalisation, parsing
  ui/grid.js              StorageGrid: rendering, selection, expanded rows
  ui/contextMenu.js       right-click menu
```

The side panel never touches `chrome.cookies` directly. It sends a message
(`COOKIES_LIST`, `COOKIE_SET`, `COOKIE_DELETE`, `WEB_STORAGE_*`) and the service
worker's `handleMessage` does the work. Keep that boundary.

## Invariants

- **Cookie prefix rules.** `__Host-` cookies must have no domain, `path: "/"`,
  and `secure: true`. `__Secure-` cookies must have `secure: true`. Chrome
  rejects the write otherwise, silently from the user's perspective.
- **Absent is not the same as undefined.** `chrome.cookies.set` rejects a key
  present with an `undefined` value, so `cookies.js` strips them. Keep that.
- **Cookie identity spans five fields**: name, domain (leading dot stripped),
  path, storeId, partition. A cookie edit that changes any of them creates a new
  cookie, which is why `cleanupReplacedCookie` exists.
- **Live sync must not eat the user's typing.** `shouldPauseLiveSync` blocks a
  refresh while focus is inside the grid, and `StorageGrid` snapshots expanded
  rows across a redraw.

## Testing

`lib/cookie-model.js` holds the pure functions precisely so they can be imported
without a DOM — `sidepanel.js` reads `document.getElementById` at module top
level and cannot be imported in a test. Put new pure logic there, not in
`sidepanel.js`.

E2E opens `sidepanel.html` as a tab and pins `chrome.tabs.query`, because a side
panel opened as a tab would otherwise resolve itself as the active tab. That one
seam is stubbed; the service worker, `chrome.cookies` and `chrome.scripting` are
all real. Verify deletions against the browser or the page, never against the
grid — the UI must not be able to pass by lying.

## Autonomous agent contract

You are running unattended in GitHub Actions against an approved issue. Nobody
is watching this run. Everything below is enforced by CI as well as stated here,
so working around a rule fails the build rather than shipping.

### Prime directive

Preserve existing behaviour. Change only what the approved issue asks for.

If the issue is ambiguous, or you find that doing it properly requires a
decision that is not yours to make, stop and say so in `.ai/result.json` with
`"status": "blocked"`. A blocked run that explains itself is a good outcome. A
run that guesses and ships is not.

### Hard boundaries

Each of these fails CI, so there is no version of the task that goes better by
crossing one:

- **Never edit `.github/**` or `project.yml`.** Workflows carry the deployment
  credentials' blast radius; `project.yml` holds the permission baseline. The CI
  guard rejects any `ai/*` branch that touches them.
- **Never add a permission or host permission** to `manifest.json`, or an OAuth
  scope to `appsscript.json`, unless the issue body contains the exact line
  `PERMISSION CHANGE APPROVED`. The permission gate diffs every PR against
  `project.yml` and fails on growth.
- **Never edit `.eslint-baseline.json` or `.manifest-baseline.json`.** Those
  record known problems so they cannot grow. Widening one hides a real defect
  instead of fixing it.
- **Never delete or weaken a test to make a build pass.** If a test is genuinely
  wrong, fix the test and explain why in your summary. If you cannot tell
  whether the test or the code is wrong, you are blocked.
- **Never rewrite a file wholesale** when a targeted edit would do.
- **Never commit a credential**, and never write one into a test fixture.

### How to work

1. Read `CLAUDE.md`, `project.yml`, and the issue. Read the files you intend to
   change before changing them.
2. Make the smallest change that fully does what the issue asks.
3. Add or update tests that would have caught the bug, or that pin the new
   behaviour. A fix with no test is not finished.
4. Run `npm run check` (lint, manifest, permission gate, unit tests). Then run
   `npm run e2e` if the change touches anything a browser exercises.
5. When something fails, read the actual error before changing anything. Fix the
   cause. Re-run. Repeat until green or until you are genuinely stuck.
6. Write `.ai/result.json` as the last thing you do.

### Definition of done

`npm run check` passes, and `npm run e2e` passes if you ran it. Not "should
pass" — you have seen it pass.

### Output contract

Write `.ai/result.json` before you finish. The workflow reads this file, not
your prose, so it must be valid JSON and it must be honest. Claiming success
that CI then contradicts is the worst outcome available to you; `blocked` is
always better.

```json
{
  "status": "success",
  "summary": "one or two sentences, in plain past tense",
  "files_changed": ["path/one.js"],
  "tests_added": 3,
  "version_bump": "patch",
  "bump_rationale": "why patch rather than minor or major",
  "permission_changes": [],
  "blocked_reason": null,
  "checks_run": ["npm run check", "npm run e2e"]
}
```

- `status`: `"success"` or `"blocked"`
- `version_bump`: `"patch"` bug fix · `"minor"` backward-compatible feature ·
  `"major"` breaking change · `"none"` no user-visible change.

  **Report the bump; do not apply it.** Leave the `version` in `manifest.json`
  alone. Release automation owns version numbers, so that they are assigned once
  at release time rather than by each branch independently — two branches in
  flight would otherwise both claim the same next version. Chrome versions are
  1–4 dotted integers, so `1.2.3-beta` is never a legal value anyway.
- `permission_changes`: every permission or scope added, `[]` if none
- `blocked_reason`: required when blocked — what you needed and could not decide

### Repository conventions

- Node 22+, ES modules in test code.
- Test helpers under `tests/helpers/` are **synced from `ext-automation/tools/`**.
  Do not edit them here; a change would be overwritten on the next sync. If one
  is wrong, say so in your summary.
- Unit tests are Vitest under `tests/unit/`. E2E is Playwright under `tests/e2e/`
  and loads the packed extension into real Chromium.
- Extension source is plain, unbundled MV3. There is no build step and adding
  one is out of scope unless the issue says otherwise.
