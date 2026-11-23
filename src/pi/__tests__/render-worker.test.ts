import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';
import {
    afterAll,
    describe,
    expect,
    it
} from 'vitest';

import { getVisibleText } from '../../utils/ansi';
import { buildStatusJson } from '../adapter';
import type {
    RenderRequest,
    RenderResponse
} from '../protocol';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pistatusline-render-worker-'));
const configPath = path.join(root, 'settings.json');
fs.copyFileSync(path.join(__dirname, 'fixtures', 'ccstatusline-settings.json'), configPath);

const NOW = Date.parse('2026-09-23T10:00:00.000Z');

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function render(request: Omit<RenderRequest, 'id' | 'configPath' | 'status' | 'records' | 'sessionName' | 'width'>): Promise<RenderResponse> {
    const worker = new Worker(path.join(__dirname, '..', 'render-worker.ts'));
    return new Promise<RenderResponse>((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.postMessage({
            id: 7,
            configPath,
            width: 140,
            status: buildStatusJson({
                cwd: '/nonexistent/pistatusline-test',
                sessionId: 's1',
                piVersion: '0.87.0',
                model: { id: 'claude-opus-5-5', name: 'Opus 5.5' },
                thinkingLevel: 'high',
                context: { tokens: 50_000, contextWindow: 200_000, percent: 25 },
                entriesAcrossBranches: [],
                branchEntries: [],
                sessionStartMs: NOW,
                nowMs: NOW
            }),
            records: [],
            sessionName: null,
            ...request
        } satisfies RenderRequest);
    }).finally(() => { void worker.terminate(); });
}

describe('render worker', () => {
    it('answers a render request with the status lines and whether usage is needed', async () => {
        const response = await render({ usage: { sessionUsage: 20, weeklyUsage: 12 } });

        expect(response.id).toBe(7);
        expect(response.error).toBeUndefined();
        expect(response.needsUsage).toBe(true);
        const visible = response.lines.map(line => getVisibleText(line)).join('\n');
        expect(visible).toContain('Opus 5.5');
        expect(visible).toContain('20.0%');
    });

    it('writes the active provider\'s usage to its cache file', async () => {
        const dir = path.join(root, 'usage');
        await render({ usage: { sessionUsage: 20, weeklyUsage: 12 }, usageCache: { dir, provider: 'opencode-go' } });

        const cached = JSON.parse(fs.readFileSync(path.join(dir, 'opencode-go.json'), 'utf-8')) as Record<string, unknown>;
        expect(cached).toEqual(expect.objectContaining({ sessionUsage: 20, weeklyUsage: 12 }));
    });

    it('writes no cache file while the usage is still pending', async () => {
        const dir = path.join(root, 'pending-usage');
        await render({ usage: 'pending', usageCache: { dir, provider: 'anthropic' } });

        expect(fs.existsSync(path.join(dir, 'anthropic.json'))).toBe(false);
    });
});
