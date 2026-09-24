# pistatusline

[ccstatusline](https://github.com/sirmalloc/ccstatusline) for the [pi coding agent](https://pi.dev):
a customizable, multi-line status line that replaces pi's footer, configured with ccstatusline's own
TUI editor.

It is ccstatusline 2.2.30 running inside pi, not a lookalike. The widgets, the renderer (separators,
flex separators, merge, padding, Powerline, themes, gradients) and the editor are ccstatusline's code,
and the settings file uses ccstatusline's schema v4 unchanged. An existing
`~/.config/ccstatusline/settings.json` renders the same lines in pi as in Claude Code.

## Install

The repo ships the prebuilt bundles in `dist/`, so installing needs no build step.

From GitHub (needs git access to the repo):

```bash
pi install git:github.com/christophesamueldhp/pistatusline
```

From a local checkout:

```bash
git clone git@github.com:christophesamueldhp/pistatusline.git ~/Desktop/Project/pistatusline
pi install ~/Desktop/Project/pistatusline
```

Then start `pi`. The footer is replaced right away. pi has one footer slot, so another package that
calls `setFooter` (for example bluclawd's `statusline` extension) competes with this one, and the one
loaded last wins. Keep only one enabled.

## Configure

```text
/pistatusline
```

This opens ccstatusline's editor (Edit Lines, Edit Colors, Powerline Setup, Terminal Options, Global
Overrides, Configure Status Line, Export/Import) with its live preview. pi hands the terminal to the
editor and takes it back when you exit, the same way it runs an external editor. Save with `Ctrl+S`
or "Save & Exit". The footer picks up the change as soon as the editor closes.

| File | Contents |
| --- | --- |
| `~/.pi/agent/pistatusline/settings.json` | ccstatusline settings (schema v4). Seeded from `~/.config/ccstatusline/settings.json` on first run. |
| `~/.pi/agent/pistatusline/state.json` | `enabled` and `refreshInterval`, which ccstatusline keeps in Claude Code's `settings.json`. |

`PI_CODING_AGENT_DIR` moves both files, as it does for the rest of pi.

## Differences from ccstatusline

These exist because pi is not Claude Code. Everything else behaves the same.

- **Data source.** Claude Code pipes a status JSON and a transcript file to ccstatusline. pistatusline
  builds the same inputs from pi:
  - `model`, thinking level, and context usage come from `ctx.getContextUsage()`.
  - Session cost and duration come from the session entries.
  - Token, speed and compaction metrics come from the session entries, converted in memory to the
    transcript records ccstatusline analyses.
- **Rendering.** Claude Code runs ccstatusline as a separate process. pistatusline runs the render
  pipeline in a worker thread, so git, jj and custom-command widgets never block typing. Renders are
  triggered by pi events (debounced 300 ms, as in Claude Code) and every `refreshInterval` seconds
  (default 10).
- **Width.** `flexMode: full` uses the footer's full width. ccstatusline reserves 6 columns for Claude
  Code's own UI, and pi has no equivalent.
- **Plan usage** (`session-usage`, `weekly-usage`, `reset-timer`, `weekly-reset-timer`, and the
  per-model and extra-usage widgets) is provider-neutral. The source matching the active model's
  provider wins; otherwise the first source with data is used.
  - **Anthropic:** your pi Anthropic OAuth login (`/login`), read from the same usage endpoint
    ccstatusline uses, refreshed every 180 s.
  - **OpenCode Go:** `GET https://opencode.ai/zen/go/v1/usage` with the API key pi already uses for
    the `opencode-go` provider (`/login` or `OPENCODE_API_KEY`), refreshed every 60 s. The rolling
    5-hour window maps to the session widgets and the weekly window to the weekly ones. There is no
    widget for the monthly window.

  Without a source the widgets show ccstatusline's `[No credentials]`. Hide that per widget with
  `h` in Edit Lines ("when usage data is unavailable").
- **Thinking effort.** Also knows pi's `off` and `minimal` levels.
- **Widgets with no data in pi are left out:** claude-account-email, claude-status, output-style,
  vim-mode, voice-status, remote-control-status, skills, sandbox-status, block-timer, cache-timer,
  and worktree-mode/name/branch/original-branch. A config that uses them still loads; those items
  render nothing. `claude-session-id` shows pi's session id, and `version` shows pi's version.
- **Main menu.** "Install to Claude Code", "Manage Installation" and "Check for Updates" become
  **Enable/Disable in pi**. "Configure Status Line → Refresh Interval" sets pi's refresh interval.

Every edit to ccstatusline's files is marked with a `// pistatusline:` comment.

## Develop

```bash
npm install
npm run typecheck
npm test             # bun test: ccstatusline's suite plus src/pi tests
npm run build
pi -ne -e ./dist/extension.js   # try it without installing
```

`dist/` is committed: run `npm run build` before committing a source change.

The layout of `dist/`:

- `dist/extension.js` is loaded by pi's extension loader and stays free of Ink.
- `dist/render-worker.js` and `dist/tui.js` load as native ESM and share chunks.

## License

MIT. Includes ccstatusline © Matthew Breedlove, MIT (see `LICENSE.ccstatusline` and `NOTICE`).
