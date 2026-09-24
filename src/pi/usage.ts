import type {
    UsageData,
    UsageError
} from '../utils/usage-types';

/**
 * UsageData, or the raw Anthropic usage response: ccstatusline's parser lives in the render
 * worker because its module graph (Claude settings, config, widgets) is too heavy for pi's
 * extension loader.
 */
export type PlanUsageData = UsageData & { anthropicJson?: string };

/**
 * Provider-neutral plan usage for ccstatusline's usage widgets (session-usage, weekly-usage,
 * reset timers, ...). Each source polls one billing plan and adapts it to ccstatusline's
 * UsageData; the source matching the active model's provider wins, otherwise the first one
 * with data. Sources without credentials report nothing, so the widgets fall back to
 * ccstatusline's own "no credentials" state (hideable per widget in the editor).
 */
export interface UsageSource {
    readonly providers: readonly string[];
    readonly refreshMs: number;
    fetch(): Promise<PlanUsageData | null>;
}

const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const REQUEST_TIMEOUT_MS = 5000;

function errorFor(error: unknown): UsageError {
    return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'api-error';
}

/** Claude subscription usage — the endpoint ccstatusline reads, with pi's Anthropic OAuth login. */
export function anthropicUsageSource(getOAuthToken: () => Promise<string | null>): UsageSource {
    return {
        providers: ['anthropic'],
        refreshMs: 180_000, // ccstatusline's usage cache age
        async fetch() {
            const token = await getOAuthToken();
            if (!token) {
                return null;
            }
            try {
                const response = await fetch(ANTHROPIC_USAGE_URL, {
                    headers: { 'Authorization': `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
                });
                if (!response.ok) {
                    return { error: response.status === 429 ? 'rate-limited' : 'api-error' };
                }
                return { anthropicJson: await response.text() };
            } catch (error) {
                return { error: errorFor(error) };
            }
        }
    };
}

const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';

interface OpencodeGoWindow { status?: unknown; percent?: unknown; resetsAt?: unknown }

function goWindow(window: OpencodeGoWindow | undefined): { percent: number; resetsAt: string } | null {
    const percent = window?.percent;
    const resetsAt = window?.resetsAt;
    if (typeof percent !== 'number' || !Number.isFinite(percent) || typeof resetsAt !== 'string') {
        return null;
    }
    // "rate-limited" means the window is used up, whatever percent the server reports.
    return { percent: window?.status === 'rate-limited' ? 100 : Math.max(0, percent), resetsAt };
}

/**
 * OpenCode Go usage response → UsageData: the rolling 5-hour window is ccstatusline's
 * "session", weekly is weekly. The monthly window has no ccstatusline widget.
 */
export function parseOpencodeGoUsage(json: unknown): UsageData | null {
    const usage = (json as { usage?: Record<string, OpencodeGoWindow> } | null)?.usage;
    const rolling = goWindow(usage?.rolling);
    const weekly = goWindow(usage?.weekly);
    if (!rolling && !weekly) {
        return null;
    }
    return {
        ...(rolling ? { sessionUsage: rolling.percent, sessionResetAt: rolling.resetsAt } : {}),
        ...(weekly ? { weeklyUsage: weekly.percent, weeklyResetAt: weekly.resetsAt } : {})
    };
}

/** OpenCode Go plan usage from its usage endpoint, with the API key pi already uses for the provider. */
export function opencodeGoUsageSource(getApiKey: () => Promise<string | null>): UsageSource {
    return {
        providers: ['opencode-go'],
        refreshMs: 60_000,
        async fetch() {
            const key = await getApiKey();
            if (!key) {
                return null;
            }
            try {
                const response = await fetch(OPENCODE_GO_USAGE_URL, {
                    headers: { Authorization: `Bearer ${key}` },
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
                });
                if (!response.ok) {
                    return { error: response.status === 429 ? 'rate-limited' : 'api-error' };
                }
                return parseOpencodeGoUsage(await response.json().catch(() => null)) ?? { error: 'parse-error' };
            } catch (error) {
                return { error: errorFor(error) };
            }
        }
    };
}

export class PlanUsage {
    private readonly data = new Map<UsageSource, PlanUsageData | null>();
    private readonly timers = new Map<UsageSource, ReturnType<typeof setTimeout>>();
    private started = false;
    private disposed = false;

    constructor(private readonly sources: readonly UsageSource[], private readonly onChange: () => void) {}

    /** Starts polling; called only once a configured line actually has a usage widget. */
    start(): void {
        if (this.started || this.disposed) {
            return;
        }
        this.started = true;
        for (const source of this.sources) {
            const poll = async () => {
                const next = await source.fetch().catch(() => null);
                if (this.disposed) {
                    return;
                }
                if (JSON.stringify(next) !== JSON.stringify(this.data.get(source) ?? null)) {
                    this.data.set(source, next);
                    this.onChange();
                }
                const timer = setTimeout(() => { void poll(); }, source.refreshMs);
                timer.unref?.();
                this.timers.set(source, timer);
            };
            void poll();
        }
    }

    get(activeProvider: string | undefined): PlanUsageData | null {
        return selectUsage(this.sources.map(source => ({ providers: source.providers, data: this.data.get(source) ?? null })), activeProvider);
    }

    dispose(): void {
        this.disposed = true;
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
    }
}

export function selectUsage(
    entries: readonly { providers: readonly string[]; data: PlanUsageData | null }[],
    activeProvider: string | undefined
): PlanUsageData | null {
    const matching = entries.find(entry => entry.data && activeProvider !== undefined && entry.providers.includes(activeProvider));
    return matching?.data ?? entries.find(entry => entry.data && !entry.data.error)?.data ?? entries.find(entry => entry.data)?.data ?? null;
}
