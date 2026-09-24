import * as path from 'node:path';
import {
    fileURLToPath,
    pathToFileURL
} from 'node:url';
import { Worker } from 'node:worker_threads';

import {
    getAgentDir,
    readStoredCredential,
    VERSION,
    type ExtensionAPI,
    type ExtensionContext
} from '@earendil-works/pi-coding-agent';

import { truncateStyledText } from '../utils/ansi';

import {
    buildStatusJson,
    toTranscriptRecords,
    type PiEntry
} from './adapter';
import type {
    RenderRequest,
    RenderResponse
} from './protocol';
import {
    readState,
    writeState,
    type PiStatuslineState
} from './state';
import type { PiStatuslineHost } from './tui-entry';
import {
    anthropicUsageSource,
    opencodeGoUsageSource,
    PlanUsage
} from './usage';

const DIST_DIR = path.dirname(fileURLToPath(import.meta.url));
// Claude Code debounces statusline updates by 300 ms.
const RENDER_DEBOUNCE_MS = 300;

// pi loads this file through jiti; a plain import() would be rewritten by it, and the editor
// bundle (Ink + yoga, top-level await) has to load as native ESM.
const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

class RenderClient {
    private worker: Worker | undefined;
    private busy = false;
    private pending: Omit<RenderRequest, 'id'> | undefined;
    private nextId = 1;

    constructor(private readonly onResult: (response: RenderResponse) => void) {}

    /** Latest wins: a request made while the worker is busy replaces any queued one. */
    request(request: Omit<RenderRequest, 'id'>): void {
        this.pending = request;
        this.pump();
    }

    private pump(): void {
        if (this.busy || !this.pending) {
            return;
        }
        const request: RenderRequest = { ...this.pending, id: this.nextId++ };
        this.pending = undefined;
        this.busy = true;
        this.ensureWorker().postMessage(request);
    }

    private ensureWorker(): Worker {
        if (this.worker) {
            return this.worker;
        }
        const worker = new Worker(path.join(DIST_DIR, 'render-worker.js'));
        worker.unref();
        worker.on('message', (response: RenderResponse) => {
            this.busy = false;
            this.onResult(response);
            this.pump();
        });
        worker.on('exit', () => {
            if (this.worker === worker) {
                this.worker = undefined;
                this.busy = false;
            }
        });
        this.worker = worker;
        return worker;
    }

    dispose(): void {
        this.pending = undefined;
        void this.worker?.terminate();
        this.worker = undefined;
    }
}

export default function pistatusline(pi: ExtensionAPI): void {
    const baseDir = path.join(getAgentDir(), 'pistatusline');
    const configPath = path.join(baseDir, 'settings.json');
    const statePath = path.join(baseDir, 'state.json');

    let state: PiStatuslineState = readState(statePath);
    let ctx: ExtensionContext | undefined;
    let lines: string[] = [];
    let footerWidth = 0;
    let footerInstalled = false;
    let requestFooterRender: (() => void) | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setInterval> | undefined;

    const client = new RenderClient((response) => {
        if (response.needsUsage) {
            usage.start();
        }
        lines = response.lines;
        requestFooterRender?.();
    });

    const usage = new PlanUsage([
        anthropicUsageSource(async () => {
            if (readStoredCredential('anthropic')?.type !== 'oauth') {
                return null;
            }
            // Resolves through pi's auth store, which refreshes an expired OAuth token.
            return (await ctx?.modelRegistry.getApiKeyForProvider('anthropic')) ?? null;
        }),
        opencodeGoUsageSource()
    ], () => { scheduleRender(0); });

    function renderNow(): void {
        if (!ctx || !footerInstalled || footerWidth <= 0) {
            return;
        }
        try {
            const sessionManager = ctx.sessionManager;
            const allEntries = sessionManager.getEntries() as unknown as PiEntry[];
            const branchEntries = sessionManager.getBranch() as unknown as PiEntry[];
            const startedAt = sessionManager.getHeader()?.timestamp ?? allEntries[0]?.timestamp;
            const startMs = startedAt ? Date.parse(startedAt) : Number.NaN;
            client.request({
                configPath,
                width: footerWidth,
                status: buildStatusJson({
                    cwd: ctx.cwd,
                    sessionId: sessionManager.getSessionId(),
                    piVersion: VERSION,
                    ...(ctx.model ? { model: { id: ctx.model.id, name: ctx.model.name } } : {}),
                    thinkingLevel: pi.getThinkingLevel(),
                    ...(ctx.getContextUsage() ? { context: ctx.getContextUsage() } : {}),
                    allEntries,
                    branchEntries,
                    sessionStartMs: Number.isFinite(startMs) ? startMs : null,
                    nowMs: Date.now()
                }),
                records: toTranscriptRecords(branchEntries),
                sessionName: sessionManager.getSessionName() ?? null,
                usage: usage.get(ctx.model?.provider)
            });
        } catch {
            // A context replaced by /new or /resume throws on access; the next session_start
            // hands over a fresh one.
        }
    }

    function scheduleRender(delayMs = RENDER_DEBOUNCE_MS): void {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(renderNow, delayMs);
        debounceTimer.unref?.();
    }

    function applyState(context: ExtensionContext): void {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = undefined;
        }
        if (!state.enabled) {
            if (footerInstalled) {
                context.ui.setFooter(undefined);
                footerInstalled = false;
            }
            return;
        }
        if (!footerInstalled) {
            context.ui.setFooter((tui) => {
                requestFooterRender = () => { tui.requestRender(); };
                return {
                    render(width: number): string[] {
                        if (width !== footerWidth) {
                            footerWidth = width;
                            scheduleRender(0);
                        }
                        // Lines rendered for a wider terminal stay on screen until the new
                        // render lands; never hand pi a line wider than the footer.
                        return lines.map(line => truncateStyledText(line, width));
                    },
                    invalidate(): void {},
                    dispose(): void {
                        requestFooterRender = undefined;
                    }
                };
            });
            footerInstalled = true;
        }
        if (state.refreshInterval) {
            refreshTimer = setInterval(() => { scheduleRender(0); }, state.refreshInterval * 1000);
            refreshTimer.unref?.();
        }
        scheduleRender(0);
    }

    pi.on('session_start', (_event, context) => {
        ctx = context;
        if (context.mode !== 'tui') {
            return;
        }
        footerInstalled = false;
        state = readState(statePath);
        applyState(context);
    });

    const onAny = pi.on.bind(pi) as (event: string, handler: (event: unknown, context: ExtensionContext) => void) => void;
    for (const event of [
        'message_end',
        'turn_end',
        'agent_end',
        'model_select',
        'thinking_level_select',
        'session_compact',
        'session_tree',
        'session_info_changed',
        'tool_result',
        'user_bash'
    ]) {
        onAny(event, (_event, context) => {
            ctx = context;
            scheduleRender();
        });
    }

    pi.on('session_shutdown', () => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        if (refreshTimer) {
            clearInterval(refreshTimer);
        }
        usage.dispose();
        client.dispose();
        ctx = undefined;
    });

    pi.registerCommand('pistatusline', {
        description: 'Configure the status line (ccstatusline editor)',
        handler: async (_args, context) => {
            if (context.mode !== 'tui') {
                context.ui.notify('/pistatusline needs the interactive terminal UI', 'warning');
                return;
            }
            const host: PiStatuslineHost = {
                isEnabled: () => state.enabled,
                setEnabled: (enabled) => {
                    state = { ...state, enabled };
                    writeState(statePath, state);
                    return Promise.resolve();
                },
                getRefreshInterval: () => state.refreshInterval,
                setRefreshInterval: (seconds) => {
                    state = { ...state, refreshInterval: seconds };
                    writeState(statePath, state);
                    return Promise.resolve();
                }
            };

            let failure: unknown;
            await context.ui.custom<void>((tui, _theme, _keybindings, done) => {
                // Same hand-over pi uses for its external editor: stop pi's TUI, let the
                // ccstatusline editor own the terminal, then restart and fully redraw.
                setImmediate(() => {
                    void (async () => {
                        tui.stop();
                        try {
                            const editor = await nativeImport(pathToFileURL(path.join(DIST_DIR, 'tui.js')).href) as typeof import('./tui-entry');
                            await editor.runEditor(host, configPath);
                        } catch (error) {
                            failure = error;
                        } finally {
                            tui.start();
                            tui.requestRender(true);
                            done();
                        }
                    })();
                });
                return { render: () => [], invalidate: () => undefined };
            });

            if (failure) {
                context.ui.notify(`pistatusline editor failed: ${failure instanceof Error ? failure.message : String(failure)}`, 'error');
            }
            applyState(context);
        }
    });
}
