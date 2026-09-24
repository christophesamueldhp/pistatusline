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
    parseOpencodeGoUsage,
    selectUsage
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
