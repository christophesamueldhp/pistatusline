import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    afterAll,
    describe,
    expect,
    it
} from 'vitest';

import { resolvePlanUsage } from '../render-core';
import { writeUsageCache } from '../usage-cache';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pistatusline-usage-cache-'));
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

const T1 = Date.parse('2026-10-16T10:00:00.000Z');
const T2 = Date.parse('2026-10-16T10:03:00.000Z');

function read(dir: string, provider: string): unknown {
    return JSON.parse(fs.readFileSync(path.join(dir, `${provider}.json`), 'utf-8'));
}

describe('writeUsageCache', () => {
    it('writes the usage numbers, reset times and fetchedAt, and nothing of the raw Anthropic response', () => {
        const dir = path.join(root, 'anthropic');
        const anthropicJson = JSON.stringify({
            five_hour: { utilization: 42, resets_at: '2026-10-16T12:00:00.000Z' },
            seven_day: { utilization: 17, resets_at: '2026-10-20T08:00:00.000Z' },
            account_uuid: 'secret-account'
        });
        writeUsageCache(dir, 'anthropic', resolvePlanUsage({ anthropicJson }), T1);
        expect(read(dir, 'anthropic')).toEqual({
            fetchedAt: '2026-10-16T10:00:00.000Z',
            sessionUsage: 42,
            sessionResetAt: '2026-10-16T12:00:00.000Z',
            weeklyUsage: 17,
            weeklyResetAt: '2026-10-20T08:00:00.000Z'
        });
        expect(fs.readdirSync(dir)).toEqual(['anthropic.json']);
    });

    it('writes again only when the usage changes', () => {
        const dir = path.join(root, 'throttle');
        writeUsageCache(dir, 'opencode-go', { sessionUsage: 10, weeklyUsage: 5 }, T1);
        writeUsageCache(dir, 'opencode-go', { sessionUsage: 10, weeklyUsage: 5 }, T2);
        expect(read(dir, 'opencode-go')).toMatchObject({ fetchedAt: '2026-10-16T10:00:00.000Z' });
        writeUsageCache(dir, 'opencode-go', { sessionUsage: 11, weeklyUsage: 5 }, T2);
        expect(read(dir, 'opencode-go')).toEqual({ fetchedAt: '2026-10-16T10:03:00.000Z', sessionUsage: 11, weeklyUsage: 5 });
    });

    it('keeps the last usage through an error, and writes nothing without a plan or before the first answer', () => {
        const dir = path.join(root, 'errors');
        writeUsageCache(dir, 'kimi-coding', null, T1);
        writeUsageCache(dir, 'kimi-coding', {}, T1);
        writeUsageCache(dir, 'kimi-coding', { error: 'rate-limited' }, T1);
        expect(fs.existsSync(dir)).toBe(false);
        writeUsageCache(dir, 'kimi-coding', { weeklyUsage: 30 }, T1);
        writeUsageCache(dir, 'kimi-coding', { error: 'timeout' }, T2);
        expect(read(dir, 'kimi-coding')).toEqual({ fetchedAt: '2026-10-16T10:00:00.000Z', weeklyUsage: 30 });
    });

    it('never throws when the directory cannot be written', () => {
        const blocker = path.join(root, 'blocker');
        fs.writeFileSync(blocker, '');
        expect(() => { writeUsageCache(path.join(blocker, 'usage'), 'anthropic', { sessionUsage: 1 }, T1); }).not.toThrow();
    });
});
