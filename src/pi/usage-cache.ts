import * as fs from 'fs';
import * as path from 'path';

import type {
    UsageData,
    UsageDataField
} from '../utils/usage-types';

/**
 * The plan usage pi shows, kept per provider in `<dir>/<provider>.json` for other programs that
 * draw this status line (a remote view of the session): `fetchedAt` plus the usage percentages,
 * reset times and extra-usage amounts. Never credentials or raw responses.
 */
const CACHED_FIELDS: readonly UsageDataField[] = [
    'sessionUsage',
    'sessionResetAt',
    'weeklyUsage',
    'weeklyResetAt',
    'weeklySonnetUsage',
    'weeklySonnetResetAt',
    'weeklyOpusUsage',
    'weeklyOpusResetAt',
    'fableUsage',
    'fableResetAt',
    'extraUsageEnabled',
    'extraUsageLimit',
    'extraUsageUsed',
    'extraUsageUtilization',
    'extraUsageCurrency'
];

// What each file was last written with, so unchanged usage is not written again.
const written = new Map<string, string>();

/** Writes the provider's usage when it changed; an error, no plan or no data writes nothing. Never throws. */
export function writeUsageCache(dir: string, provider: string, usage: UsageData | null, now = Date.now()): void {
    if (!usage || usage.error) {
        return;
    }
    const fields = Object.fromEntries(CACHED_FIELDS.filter(key => usage[key] !== undefined).map(key => [key, usage[key]]));
    const serialized = JSON.stringify(fields);
    const file = path.join(dir, `${provider}.json`);
    if (Object.keys(fields).length === 0 || written.get(file) === serialized) {
        return;
    }
    try {
        fs.mkdirSync(dir, { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify({ fetchedAt: new Date(now).toISOString(), ...fields }, null, 2), 'utf-8');
        fs.renameSync(temp, file);
        written.set(file, serialized);
    } catch {
        // A remote view falls back to what it has; the footer never depends on this file.
    }
}
