# pistatusline Implementation Plan

> Executed inline (superpowers:executing-plans) in the same session as the spec.

**Goal:** ccstatusline 2.2.30, running as a pi extension footer + `/pistatusline` Ink editor.

**Architecture:** vendored ccstatusline `src/` + `src/pi/` glue; render pipeline in a worker thread;
esbuild bundles to `dist/`. See `docs/superpowers/specs/2026-09-23-pistatusline-design.md`.

**Tech stack:** TypeScript, esbuild, Ink 6.2 + React 19, zod 4, chalk 6; `bun test` for vendored
tests, same runner for new tests.

## Interfaces

```ts
// src/pi/protocol.ts — main thread ⇄ worker
interface RenderRequest {
  id: number;
  configPath: string;
  width: number;
  status: StatusJSON;              // built by src/pi/adapter.ts
  records: TranscriptLine[];       // pi session entries as Claude transcript records
  sessionName: string | null;
  usage: UsageData | null;         // src/pi/usage/*
}
interface RenderResponse { id: number; lines: string[] }
```

## Tasks

1. **Vendored-code edits** (each marked `// pistatusline:`)
   - `utils/config.ts`: no hook sync to Claude settings in `saveSettings`.
   - `utils/jsonl-metrics.ts`: export `getTranscriptAnalysisFromRecords(records, options)` sharing
     the `scanTranscript` loop.
   - `utils/renderer.ts`: `full`/`full-until-compact` reserve 0 columns outside preview (pi has no
     Claude Code chrome).
   - `utils/widget-manifest.ts`: drop widgets with no pi data.
   - `tui/App.tsx`, `tui/components/MainMenu.tsx`: pi host (enable/disable) replaces install,
     manage-installation, updates, refresh interval; `runTUI` resolves on exit.
   - Verify: `bun test` stays at baseline minus tests of removed features.
2. **`src/pi/render-core.ts`** — pure `renderLines(request)`: steps of ccstatusline's
   `renderMultipleLines` without stdout/nbsp. Test: user's settings file renders both lines.
3. **`src/pi/adapter.ts`** — pi ctx/session entries → `StatusJSON` + records. Unit tests with
   fixture entries (usage, compaction, error message, speed interval).
4. **`src/pi/usage/`** — `anthropic.ts` (pi OAuth token → `/api/oauth/usage` →
   `parseUsageApiResponse`), `opencode-go.ts` (dashboard scrape → UsageData), `index.ts`
   (poller, provider selection). Unit tests on parsing + selection.
5. **`src/pi/render-worker.ts` + `src/pi/renderer-client.ts`** — worker wrapper, latest-wins.
6. **`src/pi/extension.ts`** — config seeding, footer component, event wiring + debounce,
   `/pistatusline` suspend → `runTUI` → resume, state.json enable flag.
7. **Build** — `scripts/build.mjs` (esbuild, ink backspace patch, version replace, require shim).
8. **Live verification in tmux** with the installed `pi` 0.87: footer, editor round-trip, resize,
   disable/enable. README + NOTICE.
