import { truncateStyledText } from '../utils/ansi';

// Claude Code's order: the permission mode first, background tasks beside it, the agent
// view hint last. Keys missing here sort alphabetically in between.
const FIRST = ['mode', 'tasks'];
const LAST = ['agents'];

function rank(key: string): number {
    if (FIRST.includes(key)) {
        return FIRST.indexOf(key);
    }
    if (LAST.includes(key)) {
        return FIRST.length + 1 + LAST.indexOf(key);
    }
    return FIRST.length;
}

/**
 * The lines extensions publish with `ctx.ui.setStatus`, which pi's own footer shows and a
 * replacement footer has to draw itself. Single-line statuses share one row joined by
 * `separator`; a status with a line break, even a trailing one, is a block of its own below
 * that row, spacing kept.
 */
export function renderStatuses(statuses: ReadonlyMap<string, string>, width: number, separator: string): string[] {
    const sorted = [...statuses.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
    const chips: string[] = [];
    const blocks: string[] = [];
    for (const [, text] of sorted) {
        const lines = text.split('\n').map(line => line.replace(/[\r\t]/g, ' ').trimEnd()).filter(line => line.trim());
        if (text.includes('\n')) {
            blocks.push(...lines);
        } else if (lines.length === 1) {
            // pi's footer collapses runs of spaces the same way.
            const chip = lines[0]!.replace(/ +/g, ' ').trim();
            // Extensions may echo the same state under different keys.
            if (!chips.includes(chip)) {
                chips.push(chip);
            }
        }
    }
    const rows = chips.length > 0 ? [chips.join(separator), ...blocks] : blocks;
    return rows.map(row => truncateStyledText(row, width));
}
