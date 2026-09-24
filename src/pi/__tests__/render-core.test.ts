import * as fs from 'fs';
import * as path from 'path';
import {
    describe,
    expect,
    it
} from 'vitest';

import { SettingsSchema } from '../../types/Settings';
import { getVisibleText } from '../../utils/ansi';
import { buildStatusJson } from '../adapter';
import { renderLines } from '../render-core';

// The user's real ~/.config/ccstatusline/settings.json (schema v4), unmodified.
const userSettings = SettingsSchema.parse(JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'ccstatusline-settings.json'),
    'utf-8'
)));

const NOW = Date.parse('2026-09-23T10:00:00.000Z');

function status() {
    return buildStatusJson({
        cwd: '/nonexistent/pistatusline-test',
        sessionId: 's1',
        piVersion: '0.87.0',
        model: { id: 'claude-opus-5-5', name: 'Opus 5.5' },
        thinkingLevel: 'high',
        context: { tokens: 50_000, contextWindow: 200_000, percent: 25 },
        allEntries: [],
        branchEntries: [],
        sessionStartMs: NOW,
        nowMs: NOW
    });
}

describe('renderLines with the user ccstatusline config', () => {
    it('renders line 1 (model, effort, context slider, cwd) and line 2 (plan usage)', async () => {
        const lines = await renderLines({
            settings: userSettings,
            configError: null,
            status: status(),
            records: [],
            sessionName: null,
            usage: {
                sessionUsage: 42,
                sessionResetAt: new Date(Date.now() + 2 * 3600_000 + 30 * 60_000).toISOString(),
                weeklyUsage: 17,
                weeklyResetAt: new Date(Date.now() + 3 * 86400_000).toISOString()
            },
            width: 140
        });

        const visible = lines.map(line => getVisibleText(line));
        expect(visible).toHaveLength(2);
        expect(visible[0]).toContain('Opus 5.5');
        expect(visible[0]).toContain('high');
        expect(visible[0]).toContain('25');
        expect(visible[0]).toContain('/nonexistent/pistatusline-test');
        expect(visible[1]).toContain('42');
        expect(visible[1]).toContain('17');
        for (const line of visible) {
            expect(line.length).toBeLessThanOrEqual(140);
        }
        // flexMode "full": the flex separator pushes the right side to the footer's full width.
        expect(visible[0]?.length).toBe(140);
    });

    it('shows ccstatusline\'s error state for usage widgets when no plan-usage source has data', async () => {
        const lines = await renderLines({
            settings: userSettings,
            configError: null,
            status: status(),
            records: [],
            sessionName: null,
            usage: null,
            width: 140
        });

        expect(getVisibleText(lines[1] ?? '')).toContain('No credentials');
    });
});
