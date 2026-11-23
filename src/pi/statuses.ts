import { truncateStyledText } from '../utils/ansi';

export function renderStatuses(statuses: ReadonlyMap<string, string>, width: number, separator: string): string[] {
    const sorted = [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b));
    const chips: string[] = [];
    const blocks: string[] = [];
    for (const [, text] of sorted) {
        const lines = text.split('\n').map(line => line.replace(/[\r\t]/g, ' ').trimEnd()).filter(line => line.trim());
        if (text.includes('\n')) {
            blocks.push(...lines);
        } else if (lines.length === 1) {
            const chip = lines[0]!.replace(/ +/g, ' ').trim();
            if (!chips.includes(chip)) {
                chips.push(chip);
            }
        }
    }
    const rows = chips.length > 0 ? [chips.join(separator), ...blocks] : blocks;
    return rows.map(row => truncateStyledText(row, width));
}
