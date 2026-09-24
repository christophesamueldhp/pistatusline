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

interface OpencodeGoWindow { usagePercent: number; resetAt: string }

function parseSsrWindow(html: string, windowName: string): OpencodeGoWindow | null {
    const num = String.raw`(-?\d+(?:\.\d+)?)`;
    const pctFirst = new RegExp(String.raw`${windowName}Usage:\$R\[\d+\]=\{[^}]*usagePercent:${num}[^}]*resetInSec:${num}[^}]*\}`).exec(html);
    const resetFirst = new RegExp(String.raw`${windowName}Usage:\$R\[\d+\]=\{[^}]*resetInSec:${num}[^}]*usagePercent:${num}[^}]*\}`).exec(html);
    const usagePercent = Number(pctFirst?.[1] ?? resetFirst?.[2]);
    const resetInSec = Number(pctFirst?.[2] ?? resetFirst?.[1]);
    if (!Number.isFinite(usagePercent) || !Number.isFinite(resetInSec)) {
        return null;
    }
    return {
        usagePercent: Math.max(0, usagePercent),
        resetAt: new Date(Date.now() + Math.max(0, resetInSec) * 1000).toISOString()
    };
}

function parseHumanReadableSeconds(text: string): number | null {
    const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
    if (/^(reset[- ]now|now|resets now)$/.test(normalized)) {
        return 0;
    }
    let total = 0;
    let matched = false;
    for (const [unit, seconds] of [['days?', 86400], ['hours?', 3600], ['minutes?', 60], ['seconds?', 1]] as const) {
        const match = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*${unit}`).exec(normalized);
        if (match?.[1]) {
            total += Number(match[1]) * seconds;
            matched = true;
        }
    }
    return matched ? total : null;
}

function parseDataSlotWindow(html: string, labelWord: string): OpencodeGoWindow | null {
    for (const content of html.split(/data-slot="usage-item"/).slice(1)) {
        const label = /data-slot="usage-label">([^<]+)</.exec(content)?.[1]?.trim().toLowerCase();
        if (!label?.includes(labelWord)) {
            continue;
        }
        const usageMatch = /data-slot="usage-value">[^0-9]*(\d+(?:\.\d+)?)/.exec(content);
        const resetMatch = /data-slot="(reset-time|reset-now)">([\s\S]*?)<\/span>/.exec(content);
        if (!usageMatch?.[1] || !resetMatch) {
            continue;
        }
        const resetText = (resetMatch[2] ?? '').replace(/<!--\$-->|<!--\/-->/g, '').replace(/Resets?\s*in\s*/i, '').trim();
        const resetInSec = resetMatch[1] === 'reset-now' ? 0 : parseHumanReadableSeconds(resetText);
        if (resetInSec === null) {
            continue;
        }
        return {
            usagePercent: Math.max(0, Number(usageMatch[1])),
            resetAt: new Date(Date.now() + resetInSec * 1000).toISOString()
        };
    }
    return null;
}

/** OpenCode Go dashboard HTML → UsageData: the rolling 5h window is the "session", weekly is weekly. */
export function parseOpencodeGoDashboard(html: string): UsageData | null {
    const rolling = parseSsrWindow(html, 'rolling') ?? parseDataSlotWindow(html, 'rolling');
    const weekly = parseSsrWindow(html, 'weekly') ?? parseDataSlotWindow(html, 'weekly');
    if (!rolling && !weekly) {
        return null;
    }
    return {
        ...(rolling ? { sessionUsage: rolling.usagePercent, sessionResetAt: rolling.resetAt } : {}),
        ...(weekly ? { weeklyUsage: weekly.usagePercent, weeklyResetAt: weekly.resetAt } : {})
    };
}

/**
 * OpenCode Go has no usage API; like opencode-quota, scrape the workspace dashboard with the
 * browser `auth` cookie from OPENCODE_GO_WORKSPACE_ID / OPENCODE_GO_AUTH_COOKIE.
 */
export function opencodeGoUsageSource(env: NodeJS.ProcessEnv = process.env): UsageSource {
    return {
        providers: ['opencode-go'],
        refreshMs: 60_000,
        async fetch() {
            const workspaceId = env.OPENCODE_GO_WORKSPACE_ID?.trim();
            const authCookie = env.OPENCODE_GO_AUTH_COOKIE?.trim();
            if (!workspaceId || !authCookie) {
                return null;
            }
            try {
                const response = await fetch(`https://opencode.ai/workspace/${encodeURIComponent(workspaceId)}/go`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0',
                        'Accept': 'text/html',
                        'Cookie': `auth=${authCookie}`
                    },
                    signal: AbortSignal.timeout(10_000)
                });
                if (!response.ok) {
                    return { error: response.status === 429 ? 'rate-limited' : 'api-error' };
                }
                return parseOpencodeGoDashboard(await response.text()) ?? { error: 'parse-error' };
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
