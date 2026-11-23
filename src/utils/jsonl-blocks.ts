import * as fs from 'fs';
import path from 'node:path';
import { globSync } from 'tinyglobby';

import type { BlockMetrics } from '../types';

import { getClaudeConfigDir } from './claude-settings';
import {
    iterateJsonlLinesSync,
    parseJsonlLine
} from './jsonl-lines';

const statSync = fs.statSync;

export function getBlockMetrics(): BlockMetrics | null {
    const claudeDir: string | null = getClaudeConfigDir();

    if (!claudeDir)
        return null;

    try {
        return findMostRecentBlockStartTime(claudeDir);
    } catch {
        return null;
    }
}

function findMostRecentBlockStartTime(
    rootDir: string,
    sessionDurationHours = 5
): BlockMetrics | null {
    const sessionDurationMs = sessionDurationHours * 60 * 60 * 1000;
    const now = new Date();

    const pattern = path.posix.join(rootDir.replace(/\\/g, '/'), 'projects', '**', '*.jsonl');
    const files = globSync([pattern], {
        absolute: true,
        cwd: rootDir
    });

    if (files.length === 0)
        return null;

    const filesWithStats = files.map((file) => {
        const stats = statSync(file);
        return { file, mtime: stats.mtime };
    });

    filesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    const lookbackChunks = [
        10,
        20,
        48
    ];

    let timestamps: Date[] = [];
    let mostRecentTimestamp: Date | null = null;
    let continuousWorkStart: Date | null = null;
    let foundSessionGap = false;

    for (const lookbackHours of lookbackChunks) {
        const cutoffTime = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
        timestamps = [];

        for (const { file, mtime } of filesWithStats) {
            if (mtime.getTime() < cutoffTime.getTime()) {
                break;
            }
            const fileTimestamps = getAllTimestampsFromFile(file);
            timestamps.push(...fileTimestamps);
        }

        if (timestamps.length === 0) {
            continue;
        }

        timestamps.sort((a, b) => b.getTime() - a.getTime());

        if (!mostRecentTimestamp && timestamps[0]) {
            mostRecentTimestamp = timestamps[0];

            const timeSinceLastActivity = now.getTime() - mostRecentTimestamp.getTime();
            if (timeSinceLastActivity > sessionDurationMs) {
                return null;
            }
        }

        continuousWorkStart = mostRecentTimestamp;
        for (let i = 1; i < timestamps.length; i++) {
            const currentTimestamp = timestamps[i];
            const previousTimestamp = timestamps[i - 1];

            if (!currentTimestamp || !previousTimestamp)
                continue;

            const gap = previousTimestamp.getTime() - currentTimestamp.getTime();

            if (gap >= sessionDurationMs) {
                foundSessionGap = true;
                break;
            }

            continuousWorkStart = currentTimestamp;
        }

        if (foundSessionGap) {
            break;
        }

        if (lookbackHours === lookbackChunks[lookbackChunks.length - 1]) {
            break;
        }
    }

    if (!mostRecentTimestamp || !continuousWorkStart) {
        return null;
    }

    const blocks: { start: Date; end: Date }[] = [];
    const sortedTimestamps = timestamps.slice().sort((a, b) => a.getTime() - b.getTime());

    let currentBlockStart: Date | null = null;
    let currentBlockEnd: Date | null = null;

    for (const timestamp of sortedTimestamps) {
        if (timestamp.getTime() < continuousWorkStart.getTime())
            continue;

        if (!currentBlockStart || (currentBlockEnd && timestamp.getTime() > currentBlockEnd.getTime())) {
            currentBlockStart = floorToHour(timestamp);
            currentBlockEnd = new Date(currentBlockStart.getTime() + sessionDurationMs);
            blocks.push({ start: currentBlockStart, end: currentBlockEnd });
        }
    }

    for (const block of blocks) {
        if (now.getTime() >= block.start.getTime() && now.getTime() <= block.end.getTime()) {
            const hasActivity = timestamps.some(t => t.getTime() >= block.start.getTime()
                && t.getTime() <= block.end.getTime()
            );

            if (hasActivity) {
                return {
                    startTime: block.start,
                    lastActivity: mostRecentTimestamp
                };
            }
        }
    }

    return null;
}

function getAllTimestampsFromFile(filePath: string): Date[] {
    const timestamps: Date[] = [];
    try {
        for (const line of iterateJsonlLinesSync(filePath)) {
            const json = parseJsonlLine(line) as {
                timestamp?: string;
                isSidechain?: boolean;
                message?: { usage?: { input_tokens?: number; output_tokens?: number } };
            } | null;
            if (!json) {
                continue;
            }

            const usage = json.message?.usage;
            if (!usage)
                continue;

            const hasInputTokens = typeof usage.input_tokens === 'number';
            const hasOutputTokens = typeof usage.output_tokens === 'number';
            if (!hasInputTokens || !hasOutputTokens)
                continue;

            if (json.isSidechain === true)
                continue;

            const timestamp = json.timestamp;
            if (typeof timestamp !== 'string')
                continue;

            const date = new Date(timestamp);
            if (!Number.isNaN(date.getTime()))
                timestamps.push(date);
        }

        return timestamps;
    } catch {
        return [];
    }
}

function floorToHour(timestamp: Date): Date {
    const floored = new Date(timestamp);
    floored.setUTCMinutes(0, 0, 0);
    return floored;
}
