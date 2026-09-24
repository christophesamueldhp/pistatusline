import {
    describe,
    expect,
    it
} from 'vitest';

import { getTranscriptAnalysisFromRecords } from '../../utils/jsonl-metrics';
import {
    buildStatusJson,
    toTranscriptRecords,
    type PiEntry,
    type PiSnapshot
} from '../adapter';

const T0 = Date.parse('2026-09-23T10:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

const user = (seconds: number): PiEntry => ({ type: 'message', timestamp: at(seconds), message: { role: 'user' } });
const assistant = (seconds: number, usage: PiEntry['usage'], stopReason = 'stop'): PiEntry => ({
    type: 'message',
    timestamp: at(seconds),
    message: { role: 'assistant', usage, stopReason }
});

function snapshot(overrides: Partial<PiSnapshot> = {}): PiSnapshot {
    return {
        cwd: '/work/repo',
        sessionId: 'session-1',
        piVersion: '0.87.0',
        allEntries: [],
        branchEntries: [],
        sessionStartMs: T0,
        nowMs: T0 + 90_000,
        ...overrides
    };
}

describe('buildStatusJson', () => {
    it('maps pi model, thinking level and context usage onto the Claude Code status fields', () => {
        const status = buildStatusJson(snapshot({
            model: { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
            thinkingLevel: 'high',
            context: { tokens: 42_000, contextWindow: 200_000, percent: 21 }
        }));

        expect(status.model).toEqual({ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' });
        expect(status.effort).toEqual({ level: 'high' });
        expect(status.context_window).toEqual({
            context_window_size: 200_000,
            current_usage: 42_000,
            used_percentage: 21
        });
        expect(status.version).toBe('0.87.0');
        expect(status.cwd).toBe('/work/repo');
        expect(status.cost?.total_duration_ms).toBe(90_000);
    });

    it('leaves context counts out while pi does not know them (after compaction)', () => {
        const status = buildStatusJson(snapshot({ context: { tokens: null, contextWindow: 200_000, percent: null } }));
        expect(status.context_window).toEqual({ context_window_size: 200_000 });
    });

    it('sums cost across every branch of the session', () => {
        const status = buildStatusJson(snapshot({
            allEntries: [
                assistant(1, { cost: { total: 0.25 } }),
                assistant(2, { cost: { total: 0.5 } }),
                { type: 'compaction', timestamp: at(3), usage: { cost: { total: 0.125 } } }
            ]
        }));
        expect(status.cost?.total_cost_usd).toBeCloseTo(0.875);
    });
});

describe('toTranscriptRecords', () => {
    it('feeds token totals, context length and speed to the ccstatusline analysis', async () => {
        const records = toTranscriptRecords([
            user(0),
            assistant(10, { input: 100, output: 50, cacheRead: 1000, cacheWrite: 200 }),
            user(20),
            assistant(25, { input: 10, output: 40, cacheRead: 1300, cacheWrite: 0 })
        ]);

        const analysis = await getTranscriptAnalysisFromRecords(records, { includeSpeedMetrics: true, includeSessionDuration: true });

        expect(analysis.tokenMetrics).toEqual({
            inputTokens: 110,
            outputTokens: 90,
            cachedTokens: 2500,
            cacheReadTokens: 2300,
            cacheCreationTokens: 200,
            totalTokens: 2700,
            contextLength: 1310
        });
        expect(analysis.speedMetricsCollection?.sessionAverage).toEqual({
            totalDurationMs: 15_000,
            inputTokens: 110,
            outputTokens: 90,
            totalTokens: 200,
            requestCount: 2
        });
        expect(analysis.sessionDuration).toBe('<1m');
    });

    it('counts compactions and keeps side LLM calls out of the context length', async () => {
        const records = toTranscriptRecords([
            user(0),
            assistant(5, { input: 500, output: 10 }),
            { type: 'compaction', timestamp: at(6), tokensBefore: 510, usage: { input: 900, output: 30 } },
            user(7),
            assistant(8, { input: 80, output: 5 })
        ]);

        const analysis = await getTranscriptAnalysisFromRecords(records, { includeCompactionStats: true });

        expect(analysis.compactionData?.count).toBe(1);
        expect(analysis.tokenMetrics.contextLength).toBe(80);
        expect(analysis.tokenMetrics.inputTokens).toBe(1480);
    });

    it('excludes failed replies from the context length but not from the totals', async () => {
        const records = toTranscriptRecords([
            user(0),
            assistant(1, { input: 300, output: 3 }),
            user(2),
            assistant(3, { input: 7, output: 0 }, 'error')
        ]);

        const analysis = await getTranscriptAnalysisFromRecords(records);

        expect(analysis.tokenMetrics.contextLength).toBe(300);
        expect(analysis.tokenMetrics.inputTokens).toBe(307);
    });

    it('reads token counts from the parts, whatever the provider reports as its total', async () => {
        // pi-ai usage as the Responses and Google APIs fill it: totalTokens 0 when the
        // provider leaves it out, reasoning counted inside output.
        const records = toTranscriptRecords([
            user(0),
            assistant(4, { input: 120, output: 60, cacheRead: 900, cacheWrite: 0, totalTokens: 0, reasoning: 40 } as PiEntry['usage'])
        ]);

        const analysis = await getTranscriptAnalysisFromRecords(records);

        expect(analysis.tokenMetrics.totalTokens).toBe(1080);
        expect(analysis.tokenMetrics.contextLength).toBe(1020);
    });

    it('skips aborted replies for the context length, as pi does', async () => {
        // Providers that report usage only at the end of the stream leave an aborted reply at zero.
        const records = toTranscriptRecords([
            user(0),
            { type: 'compaction', timestamp: at(1), tokensBefore: 5000 },
            user(2),
            assistant(3, { input: 700, output: 20 }),
            user(4),
            assistant(5, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 'aborted')
        ]);

        const analysis = await getTranscriptAnalysisFromRecords(records);

        expect(analysis.tokenMetrics.contextLength).toBe(700);
    });
});
