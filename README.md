# pistatusline

A customizable, multi-line status line for the [pi coding agent](https://pi.dev), configured with a
full-screen TUI editor.

pistatusline is based on [ccstatusline](https://github.com/sirmalloc/ccstatusline) by Matthew
Breedlove, the status line for Claude Code. It ports ccstatusline 2.2.30 to run inside
[pi](https://github.com/earendil-works/pi) instead of Claude Code: it replaces pi's footer, and
`/pistatusline` opens ccstatusline's editor. It is not a lookalike. The widgets, the renderer
(separators, flex separators, merge, padding, Powerline, themes, gradients) and the editor are
ccstatusline's code, and the settings file uses ccstatusline's schema v4 unchanged. An existing
`~/.config/ccstatusline/settings.json` renders the same lines in pi as in Claude Code.

pistatusline is an independent project. It is not affiliated with or endorsed by ccstatusline or
pi. Bugs in pistatusline belong in [this repo's issues](https://github.com/christophesamueldhp/pistatusline/issues),
not ccstatusline's.

## Install

```bash
pi install npm:pistatusline
```

Or from GitHub:

```bash
pi install git:github.com/christophesamueldhp/pistatusline
```

The package ships prebuilt bundles in `dist/`, so installing needs no build step.

Then start `pi`. The footer is replaced right away. pi has one footer slot, so another package that
calls `setFooter` competes with this one, and the one loaded last wins. Keep only one enabled.

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
  per-model and extra-usage widgets) follows the active model's provider. Each source uses the
  credential pi already has for that provider (`/login` or its environment variable). A provider's
  plan is polled only after one of its models has been active. Plans with a 5-hour window fill the
  session widgets, and weekly windows fill the weekly ones.

  | Provider | Plan | Windows | Refresh |
  | --- | --- | --- | --- |
  | `anthropic` (OAuth login) | Claude subscription, ccstatusline's own endpoint | 5-hour, weekly, per-model, extra usage | 180 s |
  | `opencode-go` | OpenCode Go | 5-hour, weekly | 60 s |
  | `openai-codex` (OAuth login) | ChatGPT plan, the endpoint the Codex CLI reads | 5-hour, weekly | 60 s |
  | `kimi-coding` | Kimi For Coding | 5-hour, weekly | 60 s |
  | `zai`, `zai-coding-cn` | GLM Coding Plan | 5-hour, weekly | 60 s |
  | `minimax`, `minimax-cn` | MiniMax Token Plan (the plan-wide `general` quota) | 5-hour, weekly | 60 s |
  | `xai` (OAuth login) | SuperGrok weekly credits | weekly | 60 s |

  - Only the Anthropic and OpenCode Go sources are verified against a live account. The others
    follow the response formats in each provider's own client and are covered by tests.
  - Windows without a ccstatusline widget are not shown: OpenCode Go's monthly window, the Kimi
    and Z.ai monthly quotas, and xAI unified (monthly) billing.
  - GitHub Copilot counts a monthly premium-request quota, and OpenRouter has a credit balance.
    Neither has a 5-hour or weekly window, so neither has a source.

  When the active provider has no plan (pay-per-token APIs, local models) or no credentials, the
  widgets show ccstatusline's `[No credentials]`. They never show another provider's usage. Hide
  that state per widget with `h` in Edit Lines ("when usage data is unavailable").
- **Thinking effort.** Also knows pi's `off` and `minimal` levels.
- **Widgets with no data in pi are left out:** claude-account-email, claude-status, output-style,
  vim-mode, voice-status, remote-control-status, skills, sandbox-status, block-timer, cache-timer,
  and worktree-mode/name/branch/original-branch. A config that uses them still loads; those items
  render nothing. `claude-session-id` shows pi's session id, and `version` shows pi's version.
- **Main menu.** "Install to Claude Code", "Manage Installation" and "Check for Updates" become
  **Enable/Disable in pi**. "Configure Status Line → Refresh Interval" sets pi's refresh interval.

Every edit to ccstatusline's files is marked with a `// pistatusline:` comment.

## Develop

Needs Node.js 22+ and [Bun](https://bun.sh) for the test suite.

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
- `dist/render-worker.js` and `dist/tui-cli.js` load as native ESM and share chunks.

## Contributing

Issues and pull requests are welcome at
[github.com/christophesamueldhp/pistatusline](https://github.com/christophesamueldhp/pistatusline).

- Run `npm run typecheck`, `npm test` and `npm run build` before opening a pull request, and commit
  the rebuilt `dist/` with your source change.
- pi-specific code lives in `src/pi/`. Keep changes to ccstatusline's files small and mark each one
  with a `// pistatusline:` comment, so upstream ccstatusline releases stay easy to merge.
- A feature that is not specific to pi belongs in [ccstatusline](https://github.com/sirmalloc/ccstatusline)
  itself.

## Credits

- [ccstatusline](https://github.com/sirmalloc/ccstatusline) by Matthew Breedlove: the widgets,
  renderer and editor pistatusline is built on.
- [pi](https://pi.dev) ([source](https://github.com/earendil-works/pi)): the coding agent
  pistatusline runs in.

## License

MIT. Includes ccstatusline © Matthew Breedlove, MIT (see `LICENSE.ccstatusline` and `NOTICE`).
