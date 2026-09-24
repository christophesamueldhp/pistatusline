import {
    describe,
    expect,
    it
} from 'vitest';

import { getVisibleWidth } from '../../utils/ansi';
import { renderStatuses } from '../statuses';

const render = (entries: [string, string][], width = 200) => renderStatuses(new Map(entries), width, ' · ');

describe('renderStatuses', () => {
    it('renders nothing without statuses', () => {
        expect(render([])).toEqual([]);
    });

    it('puts the mode first, tasks beside it, the agents hint last, the rest alphabetically', () => {
        expect(render([
            ['agents', '← for agents'],
            ['mcp', 'mcp 2'],
            ['tasks', '1 shell'],
            ['shell', 'bash mode'],
            ['mode', '⏵⏵ auto mode on']
        ])).toEqual(['⏵⏵ auto mode on · 1 shell · mcp 2 · bash mode · ← for agents']);
    });

    it('draws a multi-line status as its own block below the row, keeping its spacing', () => {
        expect(render([
            ['subagents', '  ⎿ explore   Searching…\n  ⎿ review    Reading…\n'],
            ['mode', '⏵⏵ auto mode on']
        ])).toEqual(['⏵⏵ auto mode on', '  ⎿ explore   Searching…', '  ⎿ review    Reading…']);
    });

    it('treats a single row with a trailing line break as a block', () => {
        expect(render([['subagents', '  ⎿ explore\n'], ['mode', 'm']])).toEqual(['m', '  ⎿ explore']);
    });

    it('shows a block even when no single-line status exists', () => {
        expect(render([['subagents', 'a\nb']])).toEqual(['a', 'b']);
    });

    it('collapses whitespace in a chip and drops duplicate chips', () => {
        expect(render([['a', ' x \t y '], ['b', 'x y'], ['c', '']])).toEqual(['x y']);
    });

    it('truncates every row to the width', () => {
        const rows = render([['mode', 'x'.repeat(50)], ['subagents', `${'y'.repeat(50)}\nz`]], 20);
        expect(rows.every(row => getVisibleWidth(row) <= 20)).toBe(true);
    });
});
