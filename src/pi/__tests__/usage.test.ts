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
    opencodeGoUsageSource,
    parseOpencodeGoDashboard,
    selectUsage
} from '../usage';

const originalFetch = globalThis.fetch;
function stubFetch(mock: unknown): void {
    globalThis.fetch = mock as typeof fetch;
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('parseOpencodeGoDashboard', () => {
    it('maps the SSR hydration windows onto session/weekly usage', () => {
        const before = Date.now();
        const usage = parseOpencodeGoDashboard(
            'x rollingUsage:$R[3]={usagePercent:37.5,resetInSec:3600} weeklyUsage:$R[4]={resetInSec:86400,usagePercent:12}'
        );

        expect(usage?.sessionUsage).toBe(37.5);
        expect(usage?.weeklyUsage).toBe(12);
        expect(Date.parse(usage?.sessionResetAt ?? '') - before).toBeGreaterThanOrEqual(3600_000 - 1000);
    });

    it('falls back to the data-slot markup', () => {
        const usage = parseOpencodeGoDashboard(
            '<div data-slot="usage-item"><span data-slot="usage-label">Rolling (5h)</span>'
            + '<span data-slot="usage-value">81%</span><span data-slot="reset-time">Resets in 1 hour 5 minutes</span></div>'
        );
        expect(usage?.sessionUsage).toBe(81);
        expect(usage?.weeklyUsage).toBeUndefined();
    });

    it('returns null for a page without usage', () => {
        expect(parseOpencodeGoDashboard('<html>login</html>')).toBeNull();
    });
});

describe('selectUsage', () => {
    const claude = { providers: ['anthropic'], data: { sessionUsage: 10 } };
    const go = { providers: ['opencode-go'], data: { sessionUsage: 90 } };

    it('prefers the source of the active provider', () => {
        expect(selectUsage([claude, go], 'opencode-go')).toEqual({ sessionUsage: 90 });
        expect(selectUsage([claude, go], 'anthropic')).toEqual({ sessionUsage: 10 });
    });

    it('otherwise uses the first source with good data, then any data', () => {
        expect(selectUsage([{ providers: ['anthropic'], data: { error: 'api-error' } }, go], 'openai-codex')).toEqual({ sessionUsage: 90 });
        expect(selectUsage([{ providers: ['anthropic'], data: { error: 'timeout' } }], undefined)).toEqual({ error: 'timeout' });
        expect(selectUsage([{ providers: ['anthropic'], data: null }], undefined)).toBeNull();
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

    it('leaves OpenCode Go silent without its env credentials', async () => {
        const fetchMock = vi.fn();
        stubFetch(fetchMock);
        expect(await opencodeGoUsageSource({}).fetch()).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
