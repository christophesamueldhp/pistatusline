import type {
    UsageData,
    UsageError
} from '../utils/usage-types';

export type PlanUsageData = UsageData | { anthropicJson: string };
export type PlanUsageState = PlanUsageData | 'no-plan' | 'pending';

export interface UsageSource {
    readonly providers: readonly string[];
    readonly refreshMs: number;
    fetch(): Promise<PlanUsageData | 'no-plan'>;
}

const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const REQUEST_TIMEOUT_MS = 5000;
const CCSTATUSLINE_USAGE_CACHE_MS = 180_000;
const PLAN_REFRESH_MS = 60_000;

function errorFor(error: unknown): UsageError {
    return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'api-error';
}

export function anthropicUsageSource(getOAuthToken: () => Promise<string | null>): UsageSource {
    return {
        providers: ['anthropic'],
        refreshMs: CCSTATUSLINE_USAGE_CACHE_MS,
        async fetch() {
            const token = await getOAuthToken();
            if (!token) {
                return 'no-plan';
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
                return 'no-plan';
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

/** Numbers, or numeric strings, because Kimi sends its counts as strings. */
function num(value: unknown): number | undefined {
    const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
}

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

export function opencodeGoUsageSource(getApiKey: () => Promise<string | null>): UsageSource {
    return jsonUsageSource(['opencode-go'], PLAN_REFRESH_MS, async () => {
        const key = await getApiKey();
        return key ? { url: OPENCODE_GO_USAGE_URL, headers: { Authorization: `Bearer ${key}` } } : null;
    }, parseOpencodeGoUsage);
}

const ONE_DAY_S = 86_400;

/**
 * Converts ChatGPT plan usage from Codex to UsageData. Windows are told apart by their length,
 * because a plan can send the weekly window as the primary one, or send only one window.
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

export function codexUsageSource(getCredential: () => Promise<{ token: string; accountId?: string } | null>): UsageSource {
    return jsonUsageSource(['openai-codex'], PLAN_REFRESH_MS, async () => {
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
const FIVE_HOURS_IN_MINUTES = 300;

function kimiResetAt(data: JsonRecord): string | undefined {
    return isoTime(data.reset_time ?? data.resetTime ?? data.reset_at ?? data.resetAt);
}

function kimiCountWindow(data: JsonRecord | undefined): UsageWindow | undefined {
    const limit = num(data?.limit);
    const used = num(data?.used) ?? (limit === undefined ? undefined : limit - (num(data?.remaining) ?? limit));
    if (!data || limit === undefined || limit <= 0 || used === undefined) {
        return undefined;
    }
    return { percent: clampPercent(used / limit * 100), resetAt: kimiResetAt(data) };
}

function kimiRatioWindow(data: JsonRecord | undefined): UsageWindow | undefined {
    const ratio = num(data?.used_ratio);
    return data && ratio !== undefined ? { percent: clampPercent(ratio * 100), resetAt: kimiResetAt(data) } : undefined;
}

export function parseKimiUsage(json: unknown): UsageData | null {
    const body = record(json);
    const fiveHour = (Array.isArray(body?.limits) ? body.limits : []).map(record).find((item) => {
        const window = record(item?.window);
        const unit = String(window?.timeUnit ?? '').replace(/^TIME_UNIT_/, '');
        return (num(window?.duration) ?? 0) * (WINDOW_UNIT_MINUTES[unit] ?? 0) === FIVE_HOURS_IN_MINUTES;
    });
    const pools = record(body?.usages);
    const session = kimiCountWindow(record(fiveHour?.detail) ?? fiveHour) ?? kimiRatioWindow(record(pools?.limit_5h));
    const weekly = kimiCountWindow(record(body?.usage)) ?? kimiRatioWindow(record(pools?.limit_7d));
    return toUsageData(session, weekly);
}

export function kimiUsageSource(getAuthorization: () => Promise<string | null>): UsageSource {
    return jsonUsageSource(['kimi-coding'], PLAN_REFRESH_MS, async () => {
        const authorization = await getAuthorization();
        return authorization ? { url: 'https://api.kimi.com/coding/v1/usages', headers: { Authorization: authorization } } : null;
    }, parseKimiUsage);
}

const ZAI_UNIT_HOURS = 3;
const ZAI_UNIT_WEEKS = 6;

/** Converts the GLM Coding Plan token limits to UsageData. TIME_LIMIT is the MCP quota, not a token window. */
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

/** Fetches GLM Coding Plan usage. The endpoint takes the raw API key, without "Bearer". */
export function zaiUsageSource(provider: keyof typeof ZAI_HOSTS, getApiKey: () => Promise<string | null>): UsageSource {
    return jsonUsageSource([provider], PLAN_REFRESH_MS, async () => {
        const key = await getApiKey();
        return key ? { url: `${ZAI_HOSTS[provider]}/api/monitor/usage/quota/limit`, headers: { Authorization: key } } : null;
    }, parseZaiUsage);
}

const MINIMAX_EXHAUSTED = 2;
const MINIMAX_UNLIMITED = 3;

function minimaxWindow(bucket: JsonRecord, prefix: 'interval' | 'weekly', end: unknown): UsageWindow | undefined {
    const status = num(bucket[`current_${prefix}_status`]);
    const remaining = num(bucket[`current_${prefix}_remaining_percent`]);
    // The status outranks the percentage, because an exhausted window may omit it or keep a stale one.
    const percent = status === MINIMAX_EXHAUSTED ? 100 : remaining === undefined ? undefined : 100 - remaining;
    return percent === undefined ? undefined : { percent: clampPercent(percent), resetAt: isoTime(end) };
}

/**
 * Converts MiniMax Token Plan remains to UsageData, from the plan-wide `general` bucket, or else
 * the first bucket in the plan. Counts are not used, because `*_usage_count` means "remaining"
 * in some regions.
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

export function minimaxUsageSource(provider: keyof typeof MINIMAX_HOSTS, getApiKey: () => Promise<string | null>): UsageSource {
    return jsonUsageSource([provider], PLAN_REFRESH_MS, async () => {
        const key = await getApiKey();
        return key ? { url: `${MINIMAX_HOSTS[provider]}/v1/token_plan/remains`, headers: { Authorization: `Bearer ${key}` } } : null;
    }, parseMinimaxUsage);
}

/**
 * Converts SuperGrok weekly credits to UsageData, which has only the weekly window. A fresh
 * period leaves the percentage out until something is used.
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

export function xaiUsageSource(getOAuthToken: () => Promise<string | null>): UsageSource {
    return jsonUsageSource(['xai'], PLAN_REFRESH_MS, async () => {
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
    private readonly data = new Map<UsageSource, PlanUsageData | 'no-plan'>();
    private readonly timers = new Map<UsageSource, ReturnType<typeof setTimeout>>();
    private readonly polling = new Set<UsageSource>();
    private pollingEnabled = false;
    private disposed = false;

    constructor(private readonly sources: readonly UsageSource[], private readonly onChange: () => void) {}

    enablePolling(): void {
        if (this.pollingEnabled || this.disposed) {
            return;
        }
        this.pollingEnabled = true;
        this.onChange();
    }

    watch(activeProvider: string | undefined): void {
        const active = this.sources.find(source => activeProvider !== undefined && source.providers.includes(activeProvider));
        if (active && this.pollingEnabled && !this.polling.has(active)) {
            this.poll(active);
        }
    }

    get(activeProvider: string | undefined): PlanUsageState {
        return selectUsage(this.sources.map(source => ({ providers: source.providers, data: this.data.get(source) })), activeProvider);
    }

    private poll(source: UsageSource): void {
        this.polling.add(source);
        const run = async () => {
            const next = await source.fetch().catch((): PlanUsageData => ({ error: 'no-credentials' }));
            if (this.disposed) {
                return;
            }
            if (!this.data.has(source) || JSON.stringify(next) !== JSON.stringify(this.data.get(source))) {
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
    entries: readonly { providers: readonly string[]; data: PlanUsageData | 'no-plan' | undefined }[],
    activeProvider: string | undefined
): PlanUsageState {
    const entry = entries.find(item => activeProvider !== undefined && item.providers.includes(activeProvider));
    return entry ? (entry.data ?? 'pending') : 'no-plan';
}
