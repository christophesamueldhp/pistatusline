import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CACHE_SCHEMA_VERSION = 1 as const;
const PRUNE_AFTER_MS = 60 * 60 * 1000;
const LOCK_STALE_MS = 2000;

interface WidthCacheEntry {
    width: number | null;
    createdAt: number;
}

interface PersistentWidthCache {
    version: typeof CACHE_SCHEMA_VERSION;
    entries: Record<string, WidthCacheEntry>;
}

export interface WidthCacheDeps {
    readFileSync: (path: string) => string;
    writeFileSync: (path: string, data: string) => void;
    renameSync: (from: string, to: string) => void;
    mkdirSync: (path: string) => void;
    now: () => number;
    cachePath: string;
}

function defaultCachePath(): string {
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'terminal-width.json');
}

const defaultDeps: WidthCacheDeps = {
    readFileSync: (p: string) => fs.readFileSync(p, 'utf-8'),
    writeFileSync: (p: string, data: string) => { fs.writeFileSync(p, data, 'utf-8'); },
    renameSync: (from: string, to: string) => { fs.renameSync(from, to); },
    mkdirSync: (p: string) => { fs.mkdirSync(p, { recursive: true }); },
    now: () => Date.now(),
    cachePath: defaultCachePath()
};

function isEntry(value: unknown): value is WidthCacheEntry {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const entry = value as Record<string, unknown>;
    return (typeof entry.width === 'number' || entry.width === null)
        && typeof entry.createdAt === 'number';
}

function isEexist(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EEXIST';
}

function withCacheLock(cachePath: string, fn: () => void): void {
    const lockPath = `${cachePath}.lock`;
    let haveLock = false;
    let contended = false;

    try {
        try {
            fs.closeSync(fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY));
            haveLock = true;
        } catch (error) {
            if (isEexist(error)) {
                contended = true;
                try {
                    if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
                        fs.unlinkSync(lockPath);
                        fs.closeSync(fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY));
                        haveLock = true;
                        contended = false;
                    }
                } catch {
                }
            }
        }

        if (haveLock || !contended) {
            fn();
        }
    } finally {
        if (haveLock) {
            try {
                fs.unlinkSync(lockPath);
            } catch {
            }
        }
    }
}

function readCache(deps: WidthCacheDeps): PersistentWidthCache {
    const empty: PersistentWidthCache = { version: CACHE_SCHEMA_VERSION, entries: {} };
    try {
        const parsed = JSON.parse(deps.readFileSync(deps.cachePath)) as unknown;
        if (typeof parsed !== 'object' || parsed === null) {
            return empty;
        }

        const data = parsed as { version?: unknown; entries?: unknown };
        if (data.version !== CACHE_SCHEMA_VERSION || typeof data.entries !== 'object' || data.entries === null) {
            return empty;
        }

        const entries: Record<string, WidthCacheEntry> = {};
        for (const [key, value] of Object.entries(data.entries)) {
            if (isEntry(value)) {
                entries[key] = value;
            }
        }

        return { version: CACHE_SCHEMA_VERSION, entries };
    } catch {
        return empty;
    }
}

export function readCachedWidth(
    sessionId: string,
    ttlSeconds: number,
    deps: WidthCacheDeps = defaultDeps
): { width: number | null } | null {
    if (ttlSeconds <= 0) {
        return null;
    }

    const entry = readCache(deps).entries[sessionId];
    if (!entry) {
        return null;
    }

    if (deps.now() - entry.createdAt > ttlSeconds * 1000) {
        return null;
    }

    return { width: entry.width };
}

export function writeCachedWidth(
    sessionId: string,
    width: number | null,
    deps: WidthCacheDeps = defaultDeps
): void {
    try {
        deps.mkdirSync(path.dirname(deps.cachePath));

        withCacheLock(deps.cachePath, () => {
            const now = deps.now();
            const existing = readCache(deps);

            const entries: Record<string, WidthCacheEntry> = {};
            for (const [key, entry] of Object.entries(existing.entries)) {
                if (now - entry.createdAt <= PRUNE_AFTER_MS) {
                    entries[key] = entry;
                }
            }

            entries[sessionId] = { width, createdAt: now };
            const cache: PersistentWidthCache = { version: CACHE_SCHEMA_VERSION, entries };

            const tempPath = `${deps.cachePath}.${process.pid}.tmp`;
            deps.writeFileSync(tempPath, JSON.stringify(cache));
            deps.renameSync(tempPath, deps.cachePath);
        });
    } catch {
    }
}
