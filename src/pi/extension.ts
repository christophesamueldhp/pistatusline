import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    type PiStatuslineState
} from './state';
import {
    anthropicUsageSource,
    codexUsageSource,
    kimiUsageSource,
    minimaxUsageSource,
    opencodeGoUsageSource,
    PlanUsage,
    xaiUsageSource,
    zaiUsageSource
} from './usage';

const DIST_DIR = path.dirname(fileURLToPath(import.meta.url));
// Claude Code debounces statusline updates by 300 ms.
const RENDER_DEBOUNCE_MS = 300;

// pi runs on Node, but a compiled pi binary's execPath is pi itself; the editor needs Node.
function nodeExecutable(): string {
    return /^node(\.exe)?$/i.test(path.basename(process.execPath)) ? process.execPath : 'node';
}

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

    // The key or token pi uses for the provider (/login or its env variable), resolved through
    // pi's auth store, which refreshes an expired OAuth token.
    const apiKey = (provider: string) => async () => (await ctx?.modelRegistry.getApiKeyForProvider(provider)) ?? null;
    // Subscription usage exists only for an OAuth login; an API key bills per token.
    const oauthToken = (provider: string) => async () => (readStoredCredential(provider)?.type === 'oauth' ? apiKey(provider)() : null);

    const usage = new PlanUsage([
        anthropicUsageSource(oauthToken('anthropic')),
        opencodeGoUsageSource(apiKey('opencode-go')),
        codexUsageSource(async () => {
            const token = await oauthToken('openai-codex')();
            const credential = readStoredCredential('openai-codex');
            const accountId = credential?.type === 'oauth' ? credential.accountId : undefined;
            return token ? { token, ...(typeof accountId === 'string' ? { accountId } : {}) } : null;
        }),
        // A Kimi OAuth login authenticates with a header rather than an API key.
        kimiUsageSource(async () => {
            const auth = (await ctx?.modelRegistry.getProviderAuth('kimi-coding'))?.auth;
            return auth?.headers?.Authorization ?? (auth?.apiKey ? `Bearer ${auth.apiKey}` : null);
        }),
        zaiUsageSource('zai', apiKey('zai')),
        zaiUsageSource('zai-coding-cn', apiKey('zai-coding-cn')),
        minimaxUsageSource('minimax', apiKey('minimax')),
        minimaxUsageSource('minimax-cn', apiKey('minimax-cn')),
        xaiUsageSource(oauthToken('xai'))
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
            let failure: string | undefined;
            await context.ui.custom<void>((tui, _theme, _keybindings, done) => {
                // Hand the terminal to the editor process without leaving copies of pi's screen
                // behind. A plain stop() writes the current frame into the scrollback (fullscreen
                // mode dumps it on leaving the alternate screen; regular mode parks the cursor
                // under it), so every /pistatusline would leave one more footer after pi exits.
                // preserveScreen skips that, and the editor draws on its own alternate screen.
                setImmediate(() => {
                    tui.stop({ preserveScreen: true });
                    try {
                        const result = spawnSync(nodeExecutable(), [path.join(DIST_DIR, 'tui-cli.js'), configPath, statePath], { stdio: 'inherit' });
                        if (result.error) {
                            failure = result.error.message;
                        } else if (result.status !== 0) {
                            failure = `exit code ${String(result.status ?? result.signal)}`;
                        }
                    } finally {
                        tui.start();
                        // Fullscreen re-enters an empty alternate screen and must redraw it all;
                        // regular mode's frame is still on screen, and a forced redraw would
                        // print it a second time below itself.
                        tui.requestRender(tui.mode === 'fullscreen');
                        done();
                    }
                });
                return { render: () => [], invalidate: () => undefined };
            });

            if (failure) {
                context.ui.notify(`pistatusline editor failed: ${failure}`, 'error');
            }
            state = readState(statePath);
            applyState(context);
        }
    });
}
