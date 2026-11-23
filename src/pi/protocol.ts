import type { StatusJSON } from '../types/StatusJSON';
import type { PlanUsageData } from './usage';

export interface RenderRequest {
    id: number;
    configPath: string;
    width: number;
    status: StatusJSON;
    records: unknown[];
    sessionName: string | null;
    usage: PlanUsageData | null;
    usageCache?: { dir: string; provider: string };
}

export interface RenderResponse {
    id: number;
    lines: string[];
    needsUsage: boolean;
    error?: string;
}
