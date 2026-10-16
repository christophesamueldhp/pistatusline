import type { StatusJSON } from '../types/StatusJSON';
import type { PlanUsageData } from './usage';

/** Main thread → render worker. */
export interface RenderRequest {
    id: number;
    configPath: string;
    width: number;
    status: StatusJSON;
    records: unknown[];
    sessionName: string | null;
    usage: PlanUsageData | null;
    /** Where pi keeps the active provider's usage for remote views (see usage-cache.ts); others leave it out. */
    usageCache?: { dir: string; provider: string };
}

/** Render worker → main thread. */
export interface RenderResponse {
    id: number;
    lines: string[];
    /** A configured widget reads plan usage, so the usage sources should poll. */
    needsUsage: boolean;
    error?: string;
}
