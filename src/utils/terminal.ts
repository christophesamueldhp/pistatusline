import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { probeWidthNative } from './terminal-native';
import {
    readCachedWidth,
    writeCachedWidth
} from './terminal-width-cache';

const PACKAGE_VERSION = '__PACKAGE_VERSION__';

export function getPackageVersion(): string {
    if (/^\d+\.\d+\.\d+/.test(PACKAGE_VERSION)) {
        return PACKAGE_VERSION;
    }

    const possiblePaths = [
        path.join(__dirname, '..', '..', 'package.json'),
        path.join(__dirname, '..', 'package.json')
    ];

    for (const packageJsonPath of possiblePaths) {
        try {
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
                return packageJson.version ?? '';
            }
        } catch {
        }
    }

    return '';
}

function probeTerminalWidth(): number | null {
    if (process.platform === 'win32') {
        return null;
    }

    const nativeWidth = probeWidthNative();
    if (nativeWidth !== null) {
        return nativeWidth;
    }

    let pid = process.pid;
    for (let depth = 0; depth < 8; depth += 1) {
        const parentPid = getParentProcessId(pid);
        if (parentPid === null) {
            break;
        }

        pid = parentPid;

        const tty = getTTYForProcess(pid);
        if (tty === null) {
            continue;
        }

        const width = getWidthForTTY(tty);
        if (width !== null) {
            return width;
        }
    }

    try {
        const width = execFileSync('tput', ['cols'], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            windowsHide: true
        }).trim();

        return parsePositiveInteger(width);
    } catch {
    }

    return null;
}

function parsePositiveInteger(value: string): number | null {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

function getParentProcessId(pid: number): number | null {
    try {
        const parentPidOutput = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            windowsHide: true
        }).trim();

        return parsePositiveInteger(parentPidOutput);
    } catch {
        return null;
    }
}

function getTTYForProcess(pid: number): string | null {
    try {
        const tty = execFileSync('ps', ['-o', 'tty=', '-p', String(pid)], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
            windowsHide: true
        }).replace(/\s+/g, '');

        if (!tty || tty === '??' || tty === '?') {
            return null;
        }

        return tty;
    } catch {
        return null;
    }
}

function getWidthForTTY(tty: string): number | null {
    const devicePath = `/dev/${tty}`;
    const attempts: string[][] = [
        ['-F', devicePath, 'size'],
        ['-f', devicePath, 'size']
    ];

    for (const args of attempts) {
        try {
            const output = execFileSync('stty', args, {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore'],
                windowsHide: true
            }).trim();

            const parsed = parsePositiveInteger(output.split(/\s+/)[1] ?? '');
            if (parsed !== null) {
                return parsed;
            }
        } catch {
        }
    }

    return null;
}

let hasProbed = false;
let cachedWidth: number | null = null;

export function resetTerminalWidthCache(): void {
    hasProbed = false;
    cachedWidth = null;
}

export interface TerminalWidthOptions {
    sessionId?: string;
    ttlSeconds?: number;
}

export function getTerminalWidth(options?: TerminalWidthOptions): number | null {
    if (hasProbed) {
        return cachedWidth;
    }

    const overrideRaw = process.env.CCSTATUSLINE_WIDTH;
    if (overrideRaw) {
        const override = parsePositiveInteger(overrideRaw);
        if (override !== null) {
            cachedWidth = override;
            hasProbed = true;
            return cachedWidth;
        }
    }

    const sessionId = options?.sessionId;
    const ttlSeconds = options?.ttlSeconds ?? 0;

    if (sessionId) {
        const cached = readCachedWidth(sessionId, ttlSeconds);
        if (cached?.width === null) {
            cachedWidth = null;
            hasProbed = true;
            return cachedWidth;
        }
    }

    cachedWidth = probeTerminalWidth();
    hasProbed = true;

    if (sessionId && ttlSeconds > 0 && cachedWidth === null) {
        writeCachedWidth(sessionId, null);
    }

    return cachedWidth;
}

export function canDetectTerminalWidth(): boolean {
    return getTerminalWidth() !== null;
}
