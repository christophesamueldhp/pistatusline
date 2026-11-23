import type { StatusJSON } from '../types/StatusJSON';

export interface PiEntry {
    type: string;
    timestamp: string;
    message?: {
        role?: string;
        usage?: PiUsage;
        stopReason?: string;
    };
    usage?: PiUsage;
    tokensBefore?: number;
}

export interface PiUsage {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: { total?: number };
}

export interface PiSnapshot {
    cwd: string;
    sessionId: string;
    piVersion: string;
    model?: { id: string; name?: string };
    thinkingLevel?: string;
    context?: { tokens: number | null; contextWindow: number; percent: number | null };
    allEntries: readonly PiEntry[];
    branchEntries: readonly PiEntry[];
    sessionStartMs: number | null;
    nowMs: number;
}

function finite(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function entryUsage(entry: PiEntry): PiUsage | undefined {
    return entry.type === 'message' ? entry.message?.usage : entry.usage;
}

export function buildStatusJson(snapshot: PiSnapshot): StatusJSON {
    const totalCost = snapshot.allEntries.reduce((sum, entry) => sum + finite(entryUsage(entry)?.cost?.total), 0);
    const status: StatusJSON = {
        session_id: snapshot.sessionId,
        cwd: snapshot.cwd,
        workspace: { current_dir: snapshot.cwd, project_dir: snapshot.cwd },
        version: snapshot.piVersion,
        cost: {
            total_cost_usd: totalCost,
            ...(snapshot.sessionStartMs === null ? {} : { total_duration_ms: Math.max(0, snapshot.nowMs - snapshot.sessionStartMs) })
        }
    };
    if (snapshot.model) {
        status.model = { id: snapshot.model.id, display_name: snapshot.model.name ?? snapshot.model.id };
    }
    if (snapshot.thinkingLevel) {
        status.effort = { level: snapshot.thinkingLevel };
    }
    if (snapshot.context) {
        // tokens is null right after a compaction, until the next reply reports usage;
        // leaving the counts out lets the widgets fall back to the transcript records.
        status.context_window = {
            context_window_size: snapshot.context.contextWindow,
            ...(snapshot.context.tokens === null ? {} : { current_usage: snapshot.context.tokens }),
            ...(snapshot.context.percent === null ? {} : { used_percentage: snapshot.context.percent })
        };
    }
    return status;
}

function toTokenUsage(usage: PiUsage) {
    return {
        input_tokens: finite(usage.input),
        output_tokens: finite(usage.output),
        cache_read_input_tokens: finite(usage.cacheRead),
        cache_creation_input_tokens: finite(usage.cacheWrite)
    };
}

/**
 * pi's rule for a reply whose usage measures the context. The reply did not fail or abort, and
 * it reports usage. Providers that send usage only at the end of a stream leave an aborted
 * reply at zero.
 */
function countsForContext(stopReason: string | undefined, usage: PiUsage): boolean {
    const total = finite(usage.input) + finite(usage.output) + finite(usage.cacheRead) + finite(usage.cacheWrite);
    return stopReason !== 'error' && stopReason !== 'aborted' && total > 0;
}

export function toTranscriptRecords(entries: readonly PiEntry[]): unknown[] {
    const records: unknown[] = [];
    for (const entry of entries) {
        const { timestamp } = entry;
        if (entry.type === 'message') {
            const role = entry.message?.role;
            if (role === 'user') {
                records.push({ type: 'user', timestamp });
            } else if (role === 'assistant' && entry.message?.usage) {
                records.push({
                    type: 'assistant',
                    timestamp,
                    isApiErrorMessage: !countsForContext(entry.message.stopReason, entry.message.usage),
                    message: { usage: toTokenUsage(entry.message.usage), stop_reason: entry.message.stopReason ?? 'stop' }
                });
            }
            continue;
        }
        if (entry.type === 'compaction') {
            records.push({
                type: 'system',
                subtype: 'compact_boundary',
                timestamp,
                compactMetadata: { preTokens: entry.tokensBefore }
            });
        }
        if (entry.usage && (entry.type === 'compaction' || entry.type === 'branch_summary' || entry.type === 'usage')) {
            records.push({
                type: 'assistant',
                timestamp,
                isSidechain: true,
                message: { usage: toTokenUsage(entry.usage), stop_reason: 'stop' }
            });
        }
    }
    return records;
}
