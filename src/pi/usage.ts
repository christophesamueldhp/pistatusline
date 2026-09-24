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
 * UsageData. Only the active model's provider counts: another plan's usage says nothing about
 * the model in use. Without a source or credentials the widgets fall back to ccstatusline's
 * own "no credentials" state (hideable per widget in the editor).
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


interface UsageRequest { url: string; headers: Record<string, string> }

/**
 * A plan-usage endpoint that answers JSON. `request` resolves the credential and returns
 * null without one, so providers the user never logged in to make no requests.
 */
function jsonUsageSource(
    providers: readonly string[],
    refreshMs: number,
    request: () => Promise<UsageRequest | null>,
    parse: (json: unknown) => UsageData | null
): UsageSource {
    return {
        providers,
        refreshMs,
        async fetch() {
            const target = await request();
            if (!target) {
                return null;
            }
            try {
                const response = await fetch(target.url, { headers: target.headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
                if (!response.ok) {
                    return { error: response.status === 429 ? 'rate-limited' : 'api-error' };
                }
                return parse(await response.json().catch(() => null)) ?? { error: 'parse-error' };
            } catch (error) {
                return { error: errorFor(error) };
            }
        }
    };
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

/** Numbers, or numeric strings (Kimi sends its counts as strings). */
function num(value: unknown): number | undefined {
    const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
}

/** ISO strings (nanosecond fractions trimmed), epoch seconds or epoch milliseconds → ISO. */
function isoTime(value: unknown): string | undefined {
    let ms: number | undefined;
    if (typeof value === 'string' && Number.isNaN(Number(value))) {
        ms = Date.parse(value.replace(/(\.\d{3})\d+/, '$1'));
    } else {
        const epoch = num(value);
        ms = epoch === undefined || epoch <= 0 ? undefined : epoch > 1e12 ? epoch : epoch * 1000;
    }
    return ms !== undefined && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

interface UsageWindow { percent: number; resetAt?: string }

function toUsageData(session: UsageWindow | undefined, weekly: UsageWindow | undefined): UsageData | null {
    if (!session && !weekly) {
        return null;
    }
    return {
        ...(session ? { sessionUsage: session.percent, ...(session.resetAt ? { sessionResetAt: session.resetAt } : {}) } : {}),
        ...(weekly ? { weeklyUsage: weekly.percent, ...(weekly.resetAt ? { weeklyResetAt: weekly.resetAt } : {}) } : {})
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
    return jsonUsageSource(['opencode-go'], 60_000, async () => {
        const key = await getApiKey();
        return key ? { url: OPENCODE_GO_USAGE_URL, headers: { Authorization: `Bearer ${key}` } } : null;
    }, parseOpencodeGoUsage);
}

const ONE_DAY_S = 86_400;

/**
 * ChatGPT (Codex) plan usage → UsageData. Windows are told apart by their length: a plan can
 * send the weekly window as the primary one, or only one of them.
 */
export function parseCodexUsage(json: unknown): UsageData | null {
    const limits = record(record(json)?.rate_limit);
    let session: UsageWindow | undefined;
    let weekly: UsageWindow | undefined;
    for (const [index, key] of ['primary_window', 'secondary_window'].entries()) {
        const window = record(limits?.[key]);
        const percent = num(window?.used_percent);
        if (!window || percent === undefined) {
            continue;
        }
        const parsed = { percent: clampPercent(percent), resetAt: isoTime(window.reset_at) };
        const seconds = num(window.limit_window_seconds);
        const isSession = seconds === undefined ? index === 0 : seconds <= ONE_DAY_S;
        if (isSession) {
            session ??= parsed;
        } else {
            weekly ??= parsed;
        }
    }
    return toUsageData(session, weekly);
}

/** ChatGPT plan usage for pi's `openai-codex` login, from the endpoint the Codex CLI reads. */
export function codexUsageSource(getCredential: () => Promise<{ token: string; accountId?: string } | null>): UsageSource {
    return jsonUsageSource(['openai-codex'], 60_000, async () => {
        const credential = await getCredential();
        if (!credential) {
            return null;
        }
        return {
            url: 'https://chatgpt.com/backend-api/wham/usage',
            headers: {
                'Authorization': `Bearer ${credential.token}`,
                'User-Agent': 'codex-cli',
                ...(credential.accountId ? { 'ChatGPT-Account-Id': credential.accountId } : {})
            }
        };
    }, parseCodexUsage);
}

const WINDOW_UNIT_MINUTES: Record<string, number> = { MINUTE: 1, HOUR: 60, DAY: 1440 };

function kimiResetAt(data: JsonRecord): string | undefined {
    return isoTime(data.reset_time ?? data.resetTime ?? data.reset_at ?? data.resetAt);
}

/** `{limit, used | remaining, resetTime}` with string counts. */
function kimiCountWindow(data: JsonRecord | undefined): UsageWindow | undefined {
    const limit = num(data?.limit);
    const used = num(data?.used) ?? (limit === undefined ? undefined : limit - (num(data?.remaining) ?? limit));
    if (!data || limit === undefined || limit <= 0 || used === undefined) {
        return undefined;
    }
    return { percent: clampPercent(used / limit * 100), resetAt: kimiResetAt(data) };
}

/** `{used_ratio: 0..1, reset_time}`, Kimi's newer usage pools. */
function kimiRatioWindow(data: JsonRecord | undefined): UsageWindow | undefined {
    const ratio = num(data?.used_ratio);
    return data && ratio !== undefined ? { percent: clampPercent(ratio * 100), resetAt: kimiResetAt(data) } : undefined;
}

/**
 * Kimi For Coding usage → UsageData: the 5-hour entry of `limits` (or the `limit_5h` pool) is the
 * session window, `usage` (or the `limit_7d` pool) the weekly quota.
 */
export function parseKimiUsage(json: unknown): UsageData | null {
    const body = record(json);
    const fiveHour = (Array.isArray(body?.limits) ? body.limits : []).map(record).find((item) => {
        const window = record(item?.window);
        const unit = String(window?.timeUnit ?? '').replace(/^TIME_UNIT_/, '');
        return (num(window?.duration) ?? 0) * (WINDOW_UNIT_MINUTES[unit] ?? 0) === 300;
    });
    const pools = record(body?.usages);
    const session = kimiCountWindow(record(fiveHour?.detail) ?? fiveHour) ?? kimiRatioWindow(record(pools?.limit_5h));
    const weekly = kimiCountWindow(record(body?.usage)) ?? kimiRatioWindow(record(pools?.limit_7d));
    return toUsageData(session, weekly);
}

/** Kimi For Coding usage, with the Authorization header pi builds for `kimi-coding`. */
export function kimiUsageSource(getAuthorization: () => Promise<string | null>): UsageSource {
    return jsonUsageSource(['kimi-coding'], 60_000, async () => {
        const authorization = await getAuthorization();
        return authorization ? { url: 'https://api.kimi.com/coding/v1/usages', headers: { Authorization: authorization } } : null;
    }, parseKimiUsage);
}

// Z.ai quota units: 3 = hours (the 5-hour window), 6 = weeks.
const ZAI_UNIT_HOURS = 3;
const ZAI_UNIT_WEEKS = 6;

/** GLM Coding Plan quota → UsageData, from its token limits (TIME_LIMIT is the MCP quota). */
export function parseZaiUsage(json: unknown): UsageData | null {
    const body = record(json);
    if (body?.success !== true) {
        return { error: 'api-error' };
    }
    const limits = (Array.isArray(record(body.data)?.limits) ? record(body.data)?.limits as unknown[] : []).map(record);
    const tokenWindow = (unit: number): UsageWindow | undefined => {
        const limit = limits.find(item => item?.type === 'TOKENS_LIMIT' && num(item.unit) === unit);
        const percent = num(limit?.percentage);
        return limit && percent !== undefined ? { percent: clampPercent(percent), resetAt: isoTime(limit.nextResetTime) } : undefined;
    };
    return toUsageData(tokenWindow(ZAI_UNIT_HOURS), tokenWindow(ZAI_UNIT_WEEKS));
}

const ZAI_HOSTS = { 'zai': 'https://api.z.ai', 'zai-coding-cn': 'https://open.bigmodel.cn' } as const;

/** GLM Coding Plan usage; the endpoint takes the raw API key, without "Bearer". */
export function zaiUsageSource(provider: keyof typeof ZAI_HOSTS, getApiKey: () => Promise<string | null>): UsageSource {
    return jsonUsageSource([provider], 60_000, async () => {
        const key = await getApiKey();
        return key ? { url: `${ZAI_HOSTS[provider]}/api/monitor/usage/quota/limit`, headers: { Authorization: key } } : null;
    }, parseZaiUsage);
}

// current_*_status: 2 = exhausted, 3 = unlimited.
const MINIMAX_EXHAUSTED = 2;
const MINIMAX_UNLIMITED = 3;

function minimaxWindow(bucket: JsonRecord, prefix: 'interval' | 'weekly', end: unknown): UsageWindow | undefined {
    const status = num(bucket[`current_${prefix}_status`]);
    const remaining = num(bucket[`current_${prefix}_remaining_percent`]);
    // The status outranks the percentage: an exhausted window may omit it or keep a stale one.
    const percent = status === MINIMAX_EXHAUSTED ? 100 : remaining === undefined ? undefined : 100 - remaining;
    return percent === undefined ? undefined : { percent: clampPercent(percent), resetAt: isoTime(end) };
}

/**
 * MiniMax Token Plan remains → UsageData, from the plan-wide `general` bucket (or the first
 * bucket in the plan). Counts are left alone: `*_usage_count` means "remaining" in some regions.
 */
export function parseMinimaxUsage(json: unknown): UsageData | null {
    const body = record(record(json)?.data) ?? record(json);
    if (num(record(body?.base_resp)?.status_code) !== 0) {
        // Rejected and pay-as-you-go keys still answer HTTP 200 with an error status.
        return { error: 'no-credentials' };
    }
    const buckets = (Array.isArray(body?.model_remains) ? body.model_remains : []).map(record).filter((bucket): bucket is JsonRecord => !!bucket);
    const inPlan = buckets.filter(bucket => !(num(bucket.current_interval_status) === MINIMAX_UNLIMITED && num(bucket.current_weekly_status) === MINIMAX_UNLIMITED));
    const bucket = inPlan.find(item => item.model_name === 'general') ?? inPlan[0];
    if (!bucket) {
        return null;
    }
    return toUsageData(minimaxWindow(bucket, 'interval', bucket.end_time), minimaxWindow(bucket, 'weekly', bucket.weekly_end_time));
}

const MINIMAX_HOSTS = { 'minimax': 'https://api.minimax.io', 'minimax-cn': 'https://api.minimaxi.com' } as const;

/** MiniMax Token Plan usage, with the API key pi uses for the provider. */
export function minimaxUsageSource(provider: keyof typeof MINIMAX_HOSTS, getApiKey: () => Promise<string | null>): UsageSource {
    return jsonUsageSource([provider], 60_000, async () => {
        const key = await getApiKey();
        return key ? { url: `${MINIMAX_HOSTS[provider]}/v1/token_plan/remains`, headers: { Authorization: `Bearer ${key}` } } : null;
    }, parseMinimaxUsage);
}

/**
 * SuperGrok weekly credits → UsageData (weekly only). A fresh period leaves the percentage out
 * until something is used.
 */
export function parseXaiUsage(json: unknown): UsageData | null {
    const config = record(record(json)?.config);
    const period = record(config?.currentPeriod);
    const resetAt = isoTime(period?.end);
    if (!resetAt || !String(period?.type ?? '').toUpperCase().includes('WEEK')) {
        return null;
    }
    const percent = num(config?.creditUsagePercent) ?? (Date.parse(resetAt) > Date.now() ? 0 : undefined);
    return percent === undefined ? null : toUsageData(undefined, { percent: clampPercent(percent), resetAt });
}

/** SuperGrok usage for pi's xAI OAuth login, from the Grok CLI's billing endpoint. */
export function xaiUsageSource(getOAuthToken: () => Promise<string | null>): UsageSource {
    return jsonUsageSource(['xai'], 60_000, async () => {
        const token = await getOAuthToken();
        return token
            ? {
                url: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
                headers: { 'Authorization': `Bearer ${token}`, 'X-XAI-Token-Auth': 'xai-grok-cli', 'Accept': 'application/json' }
            }
            : null;
    }, parseXaiUsage);
}

export class PlanUsage {
    private readonly data = new Map<UsageSource, PlanUsageData | null>();
    private readonly timers = new Map<UsageSource, ReturnType<typeof setTimeout>>();
    private readonly polling = new Set<UsageSource>();
    private started = false;
    private disposed = false;

    constructor(private readonly sources: readonly UsageSource[], private readonly onChange: () => void) {}

    /** Enables polling; called only once a configured line actually has a usage widget. */
    start(): void {
        if (this.started || this.disposed) {
            return;
        }
        this.started = true;
        this.onChange();
    }

    /** Usage of the active provider's plan. A source is polled from the first time its provider is active. */
    get(activeProvider: string | undefined): PlanUsageData | null {
        const active = this.sources.find(source => activeProvider !== undefined && source.providers.includes(activeProvider));
        if (active && this.started && !this.polling.has(active)) {
            this.poll(active);
        }
        return selectUsage(this.sources.map(source => ({ providers: source.providers, data: this.data.get(source) ?? null })), activeProvider);
    }

    private poll(source: UsageSource): void {
        this.polling.add(source);
        const run = async () => {
            const next = await source.fetch().catch(() => null);
            if (this.disposed) {
                return;
            }
            if (JSON.stringify(next) !== JSON.stringify(this.data.get(source) ?? null)) {
                this.data.set(source, next);
                this.onChange();
            }
            const timer = setTimeout(() => { void run(); }, source.refreshMs);
            timer.unref?.();
            this.timers.set(source, timer);
        };
        void run();
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
    return entries.find(entry => activeProvider !== undefined && entry.providers.includes(activeProvider))?.data ?? null;
}
