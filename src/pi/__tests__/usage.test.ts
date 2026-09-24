import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { resolvePlanUsage } from '../render-core';
import {
    anthropicUsageSource,
    codexUsageSource,
    kimiUsageSource,
    minimaxUsageSource,
    opencodeGoUsageSource,
    parseCodexUsage,
    parseKimiUsage,
    parseMinimaxUsage,
    parseOpencodeGoUsage,
    parseXaiUsage,
    parseZaiUsage,
    PlanUsage,
    selectUsage,
    xaiUsageSource,
    zaiUsageSource,
    type UsageSource
} from '../usage';

const originalFetch = globalThis.fetch;
function stubFetch(mock: unknown): void {
    globalThis.fetch = mock as typeof fetch;
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('parseOpencodeGoUsage', () => {
    it('maps the rolling and weekly windows onto session/weekly usage', () => {
        expect(parseOpencodeGoUsage({
            usage: {
                rolling: { status: 'ok', percent: 37.5, resetsAt: '2026-09-24T10:00:00.000Z' },
                weekly: { status: 'ok', percent: 54, resetsAt: '2026-09-28T00:00:00.000Z' },
                monthly: { status: 'ok', percent: 30, resetsAt: '2026-10-03T17:33:15.000Z' }
            }
        })).toEqual({
            sessionUsage: 37.5,
            sessionResetAt: '2026-09-24T10:00:00.000Z',
            weeklyUsage: 54,
            weeklyResetAt: '2026-09-28T00:00:00.000Z'
        });
    });

    it('shows a rate-limited window as used up', () => {
        expect(parseOpencodeGoUsage({
            usage: { rolling: { status: 'rate-limited', percent: 97, resetsAt: '2026-09-24T10:00:00.000Z' } }
        })?.sessionUsage).toBe(100);
    });

    it('returns null for a response without usage windows', () => {
        expect(parseOpencodeGoUsage({ type: 'error' })).toBeNull();
        expect(parseOpencodeGoUsage(null)).toBeNull();
    });
});

describe('selectUsage', () => {
    const claude = { providers: ['anthropic'], data: { sessionUsage: 10 } };
    const go = { providers: ['opencode-go'], data: { sessionUsage: 90 } };

    it('prefers the source of the active provider', () => {
        expect(selectUsage([claude, go], 'opencode-go')).toEqual({ sessionUsage: 90 });
        expect(selectUsage([claude, go], 'anthropic')).toEqual({ sessionUsage: 10 });
    });

    it('shows no usage when the active provider has no plan-usage source', () => {
        expect(selectUsage([claude, go], 'openai')).toBeNull();
        expect(selectUsage([claude, go], undefined)).toBeNull();
        expect(selectUsage([{ providers: ['anthropic'], data: null }], 'anthropic')).toBeNull();
    });

    it('passes the active source\'s error through', () => {
        expect(selectUsage([{ providers: ['anthropic'], data: { error: 'timeout' } }, go], 'anthropic')).toEqual({ error: 'timeout' });
    });
});

describe('usage sources', () => {
    it('skips the request without an Anthropic OAuth token', async () => {
        const fetchMock = vi.fn();
        stubFetch(fetchMock);
        expect(await anthropicUsageSource(() => Promise.resolve(null)).fetch()).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('parses the Anthropic usage response with ccstatusline\'s parser', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
            five_hour: { utilization: 33, resets_at: '2026-09-23T15:00:00Z' },
            seven_day: { utilization: 44, resets_at: '2026-09-28T00:00:00Z' }
        }))));
        stubFetch(fetchMock);

        const usage = resolvePlanUsage(await anthropicUsageSource(() => Promise.resolve('tok')).fetch());

        expect(usage).toEqual(expect.objectContaining({ sessionUsage: 33, weeklyUsage: 44, weeklyResetAt: '2026-09-28T00:00:00Z' }));
        expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/api/oauth/usage', expect.objectContaining({
            headers: expect.objectContaining({ Authorization: 'Bearer tok' })
        }));
    });

    it('reports rate limiting as ccstatusline\'s rate-limited error', async () => {
        stubFetch(vi.fn(() => Promise.resolve(new Response('', { status: 429 }))));
        expect(await anthropicUsageSource(() => Promise.resolve('tok')).fetch()).toEqual({ error: 'rate-limited' });
    });

    it('leaves OpenCode Go silent without an API key', async () => {
        const fetchMock = vi.fn();
        stubFetch(fetchMock);
        expect(await opencodeGoUsageSource(() => Promise.resolve(null)).fetch()).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reads OpenCode Go usage with the provider API key', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
            usage: { rolling: { status: 'ok', percent: 12, resetsAt: '2026-09-24T10:00:00.000Z' } }
        }))));
        stubFetch(fetchMock);

        expect(await opencodeGoUsageSource(() => Promise.resolve('go-key')).fetch())
            .toEqual({ sessionUsage: 12, sessionResetAt: '2026-09-24T10:00:00.000Z' });
        expect(fetchMock).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1/usage', expect.objectContaining({
            headers: { Authorization: 'Bearer go-key' }
        }));
    });

    it('reports a rejected key as an API error', async () => {
        stubFetch(vi.fn(() => Promise.resolve(new Response('{"type":"error"}', { status: 401 }))));
        expect(await opencodeGoUsageSource(() => Promise.resolve('bad')).fetch()).toEqual({ error: 'api-error' });
    });
});

// Response shapes from the providers' own clients and reference implementations:
// openai/codex (backend-openapi-models), MoonshotAI/kimi-cli + CodexBar fixtures,
// zai-org/zai-coding-plugins, MiniMax-AI/cli, CodexBar/oh-my-pi (xAI billing).
describe('provider usage parsers', () => {
    it('maps Codex rate-limit windows by their length, not their position', () => {
        expect(parseCodexUsage({
            plan_type: 'plus',
            rate_limit: {
                primary_window: { used_percent: 61, limit_window_seconds: 604800, reset_after_seconds: 1, reset_at: 1790500000 },
                secondary_window: { used_percent: 7, limit_window_seconds: 18000, reset_after_seconds: 1, reset_at: 1790240000 }
            }
        })).toEqual({
            sessionUsage: 7,
            sessionResetAt: new Date(1790240000 * 1000).toISOString(),
            weeklyUsage: 61,
            weeklyResetAt: new Date(1790500000 * 1000).toISOString()
        });
        expect(parseCodexUsage({ plan_type: 'free' })).toBeNull();
    });

    it('reads Kimi\'s 5-hour limit and weekly usage (string counts)', () => {
        expect(parseKimiUsage({
            usage: { limit: '1000', used: '250', remaining: '750', resetTime: '2026-09-28T05:24:18.443553353Z' },
            limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', remaining: '60', resetTime: '2026-09-24T12:00:00Z' } }]
        })).toEqual({
            sessionUsage: 40,
            sessionResetAt: '2026-09-24T12:00:00.000Z',
            weeklyUsage: 25,
            weeklyResetAt: '2026-09-28T05:24:18.443Z'
        });
    });

    it('falls back to Kimi\'s ratio pools', () => {
        expect(parseKimiUsage({
            usages: {
                limit_5h: { used_ratio: 0.125, reset_time: '2026-09-16T20:15:44Z' },
                limit_7d: { used_ratio: 0.5, reset_time: '2026-09-20T00:00:00Z' },
                limit_month_total: { used_ratio: 0.0056, reset_time: '2026-10-17T00:00:00Z' }
            }
        })).toEqual({
            sessionUsage: 12.5,
            sessionResetAt: '2026-09-16T20:15:44.000Z',
            weeklyUsage: 50,
            weeklyResetAt: '2026-09-20T00:00:00.000Z'
        });
    });

    it('reads the Z.ai coding plan token windows', () => {
        expect(parseZaiUsage({
            code: 200,
            success: true,
            data: {
                level: 'pro',
                limits: [
                    { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 11, nextResetTime: 1790240000000 },
                    { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 42, nextResetTime: 1790500000000 },
                    { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 90, nextResetTime: 1791000000000 }
                ]
            }
        })).toEqual({
            sessionUsage: 11,
            sessionResetAt: new Date(1790240000000).toISOString(),
            weeklyUsage: 42,
            weeklyResetAt: new Date(1790500000000).toISOString()
        });
        expect(parseZaiUsage({ code: 1001, success: false, msg: 'unauthorized' })).toEqual({ error: 'api-error' });
    });

    it('reads the MiniMax plan\'s shared bucket (remaining percent → used)', () => {
        expect(parseMinimaxUsage({
            base_resp: { status_code: 0, status_msg: 'success' },
            model_remains: [
                { model_name: 'video', start_time: 0, end_time: 1, current_interval_remaining_percent: 0, current_interval_status: 2 },
                {
                    model_name: 'general',
                    start_time: 1790222000000,
                    end_time: 1790240000000,
                    current_interval_remaining_percent: 70,
                    current_interval_status: 1,
                    weekly_start_time: 1789900000000,
                    weekly_end_time: 1790500000000,
                    current_weekly_status: 2
                }
            ]
        })).toEqual({
            sessionUsage: 30,
            sessionResetAt: new Date(1790240000000).toISOString(),
            weeklyUsage: 100,
            weeklyResetAt: new Date(1790500000000).toISOString()
        });
        // Bad or pay-as-you-go keys still answer HTTP 200, with an error status.
        expect(parseMinimaxUsage({ base_resp: { status_code: 1004, status_msg: 'invalid api key' } })).toEqual({ error: 'no-credentials' });
    });

    it('reads the xAI SuperGrok weekly credits (absent percent = unused)', () => {
        const future = new Date(Date.now() + 86_400_000).toISOString();
        expect(parseXaiUsage({ config: { currentPeriod: { start: '2026-09-20T00:00:00Z', end: future, type: 'BILLING_PERIOD_TYPE_WEEKLY' }, creditUsagePercent: 37 } }))
            .toEqual({ weeklyUsage: 37, weeklyResetAt: future });
        expect(parseXaiUsage({ config: { currentPeriod: { start: '2026-09-20T00:00:00Z', end: future, type: 'BILLING_PERIOD_TYPE_WEEKLY' } } }))
            .toEqual({ weeklyUsage: 0, weeklyResetAt: future });
    });
});

describe('provider usage requests', () => {
    const ok = (body: unknown) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body))));

    it('sends each provider\'s credential the way its own client does', async () => {
        const cases: [UsageSource, string, Record<string, string>][] = [
            [codexUsageSource(() => Promise.resolve({ token: 'cx', accountId: 'acct' })), 'https://chatgpt.com/backend-api/wham/usage', { 'Authorization': 'Bearer cx', 'ChatGPT-Account-Id': 'acct' }],
            [kimiUsageSource(() => Promise.resolve('Bearer km')), 'https://api.kimi.com/coding/v1/usages', { Authorization: 'Bearer km' }],
            [zaiUsageSource('zai', () => Promise.resolve('zk')), 'https://api.z.ai/api/monitor/usage/quota/limit', { Authorization: 'zk' }],
            [zaiUsageSource('zai-coding-cn', () => Promise.resolve('zk')), 'https://open.bigmodel.cn/api/monitor/usage/quota/limit', { Authorization: 'zk' }],
            [minimaxUsageSource('minimax', () => Promise.resolve('mm')), 'https://api.minimax.io/v1/token_plan/remains', { Authorization: 'Bearer mm' }],
            [minimaxUsageSource('minimax-cn', () => Promise.resolve('mm')), 'https://api.minimaxi.com/v1/token_plan/remains', { Authorization: 'Bearer mm' }],
            [xaiUsageSource(() => Promise.resolve('xa')), 'https://cli-chat-proxy.grok.com/v1/billing?format=credits', { 'Authorization': 'Bearer xa', 'X-XAI-Token-Auth': 'xai-grok-cli' }]
        ];
        for (const [source, url, headers] of cases) {
            const fetchMock = ok({});
            stubFetch(fetchMock);
            await source.fetch();
            expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ headers: expect.objectContaining(headers) }));
        }
    });

    it('makes no request without a credential', async () => {
        const fetchMock = vi.fn();
        stubFetch(fetchMock);
        const none = () => Promise.resolve(null);
        for (const source of [codexUsageSource(none), kimiUsageSource(none), zaiUsageSource('zai', none), minimaxUsageSource('minimax', none), xaiUsageSource(none)]) {
            expect(await source.fetch()).toBeNull();
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('PlanUsage', () => {
    it('polls only the sources of providers that have been active', async () => {
        const fetched: string[] = [];
        const source = (provider: string): UsageSource => ({
            providers: [provider],
            refreshMs: 60_000,
            fetch: () => { fetched.push(provider); return Promise.resolve({ sessionUsage: 1 }); }
        });
        let changes = 0;
        const usage = new PlanUsage([source('anthropic'), source('opencode-go')], () => { changes++; });

        expect(usage.get('opencode-go')).toBeNull();
        usage.start();
        usage.get('opencode-go');
        await new Promise(resolve => setImmediate(resolve));

        expect(fetched).toEqual(['opencode-go']);
        expect(usage.get('opencode-go')).toEqual({ sessionUsage: 1 });
        expect(changes).toBeGreaterThan(0);
        usage.dispose();
    });
});
