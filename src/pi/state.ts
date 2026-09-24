import * as fs from 'fs';
import * as path from 'path';

/**
 * What ccstatusline keeps in Claude Code's settings.json (statusLine present or not, and its
 * refreshInterval) lives here for pi, next to pistatusline's settings.json.
 */
export interface PiStatuslineState {
    enabled: boolean;
    /** Seconds between time-based re-renders; null renders on events only, like Claude Code. */
    refreshInterval: number | null;
}

// ccstatusline's installer writes refreshInterval 10 for Claude Code >= 2.1.97.
const DEFAULT_STATE: PiStatuslineState = { enabled: true, refreshInterval: 10 };

export function readState(file: string): PiStatuslineState {
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<PiStatuslineState>;
        return {
            enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_STATE.enabled,
            refreshInterval: raw.refreshInterval === null || typeof raw.refreshInterval === 'number'
                ? raw.refreshInterval
                : DEFAULT_STATE.refreshInterval
        };
    } catch {
        return { ...DEFAULT_STATE };
    }
}

export function writeState(file: string, state: PiStatuslineState): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(temp, file);
}
