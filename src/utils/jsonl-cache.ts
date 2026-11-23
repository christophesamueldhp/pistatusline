import * as fs from 'fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import type { BlockMetrics } from '../types';

import { getClaudeConfigDir } from './claude-settings';
import { getBlockMetrics } from './jsonl-blocks';

const readFileSync = fs.readFileSync;
const writeFileSync = fs.writeFileSync;
const mkdirSync = fs.mkdirSync;
const existsSync = fs.existsSync;

interface BlockCache {
    startTime?: string;
    emptyUntil?: string;
    configDir?: string;
}

const EMPTY_RESULT_TTL_MS = 60 * 1000;

function normalizeConfigDir(configDir: string): string {
    return path.resolve(configDir);
}

export function getBlockCachePath(configDir = getClaudeConfigDir()): string {
    const normalizedConfigDir = normalizeConfigDir(configDir);
    const configHash = createHash('sha256')
        .update(normalizedConfigDir)
        .digest('hex')
        .slice(0, 16);

    return path.join(
        os.homedir(),
        '.cache',
        'ccstatusline',
        `block-cache-${configHash}.json`
    );
}

export function readBlockCache(expectedConfigDir?: string): Date | null {
    try {
        const normalizedExpectedConfigDir = expectedConfigDir !== undefined
            ? normalizeConfigDir(expectedConfigDir)
            : undefined;
        const cachePath = getBlockCachePath(normalizedExpectedConfigDir);
        if (!existsSync(cachePath)) {
            return null;
        }
        const content = readFileSync(cachePath, 'utf-8');
        const cache = JSON.parse(content) as BlockCache;
        if (typeof cache.startTime !== 'string') {
            return null;
        }
        if (normalizedExpectedConfigDir !== undefined) {
            if (typeof cache.configDir !== 'string') {
                return null;
            }
            if (cache.configDir !== normalizedExpectedConfigDir) {
                return null;
            }
        }
        const date = new Date(cache.startTime);
        if (Number.isNaN(date.getTime())) {
            return null;
        }
        return date;
    } catch {
        return null;
    }
}

function readEmptyBlockCache(expectedConfigDir?: string): Date | null {
    try {
        const normalizedExpectedConfigDir = expectedConfigDir !== undefined
            ? normalizeConfigDir(expectedConfigDir)
            : undefined;
        const cachePath = getBlockCachePath(normalizedExpectedConfigDir);
        if (!existsSync(cachePath)) {
            return null;
        }
        const content = readFileSync(cachePath, 'utf-8');
        const cache = JSON.parse(content) as BlockCache;
        if (typeof cache.emptyUntil !== 'string') {
            return null;
        }
        if (normalizedExpectedConfigDir !== undefined) {
            if (typeof cache.configDir !== 'string') {
                return null;
            }
            if (cache.configDir !== normalizedExpectedConfigDir) {
                return null;
            }
        }
        const date = new Date(cache.emptyUntil);
        if (Number.isNaN(date.getTime())) {
            return null;
        }
        return date;
    } catch {
        return null;
    }
}

function writeEmptyBlockCache(emptyUntil: Date, configDir = getClaudeConfigDir()): void {
    try {
        const normalizedConfigDir = normalizeConfigDir(configDir);
        const cachePath = getBlockCachePath(normalizedConfigDir);
        const cacheDir = path.dirname(cachePath);
        if (!existsSync(cacheDir)) {
            mkdirSync(cacheDir, { recursive: true });
        }
        const cache: BlockCache = {
            emptyUntil: emptyUntil.toISOString(),
            configDir: normalizedConfigDir
        };
        writeFileSync(cachePath, JSON.stringify(cache), 'utf-8');
    } catch {
    }
}

export function writeBlockCache(startTime: Date, configDir = getClaudeConfigDir()): void {
    try {
        const normalizedConfigDir = normalizeConfigDir(configDir);
        const cachePath = getBlockCachePath(normalizedConfigDir);
        const cacheDir = path.dirname(cachePath);
        if (!existsSync(cacheDir)) {
            mkdirSync(cacheDir, { recursive: true });
        }
        const cache: BlockCache = {
            startTime: startTime.toISOString(),
            configDir: normalizedConfigDir
        };
        writeFileSync(cachePath, JSON.stringify(cache), 'utf-8');
    } catch {
    }
}

export function getCachedBlockMetrics(sessionDurationHours = 5): BlockMetrics | null {
    const sessionDurationMs = sessionDurationHours * 60 * 60 * 1000;
    const now = new Date();
    const activeConfigDir = getClaudeConfigDir();

    const cachedStartTime = readBlockCache(activeConfigDir);
    if (cachedStartTime) {
        const blockEndTime = new Date(cachedStartTime.getTime() + sessionDurationMs);
        if (now.getTime() <= blockEndTime.getTime()) {
            return {
                startTime: cachedStartTime,
                lastActivity: now
            };
        }
    }

    const emptyUntil = readEmptyBlockCache(activeConfigDir);
    if (emptyUntil && now.getTime() < emptyUntil.getTime()) {
        return null;
    }

    const metrics = getBlockMetrics();

    if (metrics) {
        writeBlockCache(metrics.startTime, activeConfigDir);
    } else {
        writeEmptyBlockCache(new Date(now.getTime() + EMPTY_RESULT_TTL_MS), activeConfigDir);
    }

    return metrics;
}
