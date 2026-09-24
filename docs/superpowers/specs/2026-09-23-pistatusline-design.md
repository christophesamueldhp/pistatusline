# pistatusline — design

Date: 2026-09-23. Status: approved.

## Goal

A statusline footer for the pi coding agent with fidelity to
[ccstatusline](https://github.com/sirmalloc/ccstatusline) 2.2.30: the same
settings schema (v4), the same widget type ids and metadata keys, the same
renderer semantics (separators, flex, merge, padding, powerline, themes,
compact threshold), and the same Ink TUI editor.

Success criterion: the user's `~/.config/ccstatusline/settings.json`, loaded
unmodified, renders the same lines in pi as in Claude Code.

## Architecture

- `src/` (except `src/pi/`) is ccstatusline's `src/` copied file-for-file
  (MIT, see `LICENSE.ccstatusline`). Edits there are minimal and marked with
  `// pistatusline:` so upstream diffs stay reviewable.
- `src/pi/` holds everything pi-specific.
- esbuild bundles `src/pi/extension.ts` → `dist/extension.js` (self-contained, no Ink:
  pi loads it through jiti) and, with code splitting, `src/pi/render-worker.ts` →
  `dist/render-worker.js` and `src/pi/tui-entry.ts` → `dist/tui.js` (native ESM; yoga-layout
  uses top-level await). ink/react/zod/chalk are bundled; `@earendil-works/*` stay external. ccstatusline's ink backspace
  patch is applied at bundle time.

## Rendering

Claude Code runs the statusline command out of process; the vendored widgets
call `execFileSync` (git, jj, custom commands, usage fetch). pistatusline runs
the vendored render pipeline in a `worker_threads` worker so those calls never
block pi's input loop.

1. The extension builds a snapshot from pi (see Adapter) on events
   (`session_start`, `message_end`, `model_select`, thinking changes,
   `tool_result`, compaction, `agent_end`) and every `refreshInterval` seconds (default 10), debounced 300 ms.
2. The worker receives `{ status, piMetrics, usage, width, settingsPath }`,
   runs the same steps as ccstatusline's `renderMultipleLines`, and returns
   the lines (no nbsp substitution — pi is not VS Code).
3. The footer component's `render(width)` returns the cached lines,
   truncated to `width`; a width change schedules a new render.

## Adapter (pi → ccstatusline RenderContext)

- `StatusJSON`: `session_id`, `cwd`, `workspace.current_dir`, `model {id,
  display_name}`, `version` (pi version), `effort.level` (pi thinking level),
  `cost.total_cost_usd` and `total_duration_ms`, `context_window`
  (`ctx.getContextUsage()` + model window).
- `tokenMetrics`, `speedMetrics`, `sessionDuration`, `compactionData`,
  `transcriptSessionName` are computed from pi session entries instead of a
  Claude transcript JSONL.

## Plan usage (provider-neutral)

`RenderUsageData` is produced by pluggable sources: Anthropic OAuth usage
(pi's stored `anthropic` OAuth credential) and OpenCode Go (dashboard scrape
via `OPENCODE_GO_WORKSPACE_ID` + `OPENCODE_GO_AUTH_COOKIE`). The source that
matches the active model's provider wins; otherwise the first with data.
Widgets render ccstatusline's existing error/empty states when no source has
data.

## Widget catalog

All ccstatusline widgets except those with no data in pi, which are removed
from the manifest: `claude-account-email`, `claude-status`, `output-style`,
`vim-mode`, `voice-status`, `remote-control-status`, `skills`,
`sandbox-status`, `block-timer`, `cache-timer`, `worktree-*`. `claude-session-id` shows pi's
session id; `version` shows pi's version.

## Config

`~/.pi/agent/pistatusline/settings.json`, ccstatusline v4 schema and
migrations unchanged. On first run, if absent, it is seeded from
`~/.config/ccstatusline/settings.json` (or ccstatusline defaults). A separate
`enabled` flag and `refreshInterval` live in `~/.pi/agent/pistatusline/state.json`.

## Editor

`/pistatusline` suspends pi's TUI (`ctx.ui.custom` → `tui.stop()`), renders
ccstatusline's Ink `App` in-process, and on exit restarts pi's TUI and
re-renders the footer. Main menu changes: "Install to Claude Code", "Manage
Installation" and "Check for Updates" are replaced by one "Enable/Disable in pi"
item; "Configure Status Line → Refresh Interval" sets pi's refresh interval
(state.json); everything else is unchanged.

## Verification

- Vendored tests run with `bun test` (upstream's runner); baseline 2357/2358.
- New tests for the adapter, usage sources, worker protocol, and a smoke test
  rendering the user's settings file.
- Live check in tmux: footer lines, editor round-trip, resize.
