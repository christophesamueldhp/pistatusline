import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';

import { getClaudeConfigDir } from './claude-settings';
import type {
    UsageData,
    UsageDataField,
    UsageError
} from './usage-types';
import {
    UsageErrorSchema,
    WEEKLY_MODEL_USAGE_BUCKETS,
    setUsageField
} from './usage-types';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'ccstatusline');
const CACHE_FILE = path.join(CACHE_DIR, 'usage.json');
const LOCK_FILE = path.join(CACHE_DIR, 'usage.lock');
const CACHE_MAX_AGE = 180;
const LOCK_MAX_AGE = 30;
const DEFAULT_RATE_LIMIT_BACKOFF = 300;
const MAX_LOCK_HORIZON = 24 * 60 * 60;
const MACOS_USAGE_CREDENTIALS_SERVICE = 'Claude Code-credentials';
const MACOS_SECURITY_DUMP_MAX_BUFFER = 8 * 1024 * 1024;

export interface FetchUsageDataOptions { requiredFields?: readonly UsageDataField[] }

interface UsageCredentials {
    accessToken: string;
    refreshToken?: string;
}

interface UsageCacheIdentity {
    preferredHash: string;
    accessTokenHash: string;
}

const EXTRA_USAGE_DETAIL_FIELDS = new Set<UsageDataField>([
    'extraUsageLimit',
    'extraUsageUsed',
    'extraUsageUtilization'
]);

const FABLE_USAGE_FIELDS = new Set<UsageDataField>([
    'fableUsage',
    'fableResetAt'
]);

const WINDOW_RESET_FIELD_SENTINELS: Partial<Record<UsageDataField, UsageDataField>> = {
    sessionResetAt: 'sessionUsage',
    weeklyResetAt: 'weeklyUsage',
    ...Object.fromEntries(WEEKLY_MODEL_USAGE_BUCKETS.map(bucket => [bucket.resetField, bucket.usageField]))
};

const UsageCredentialsSchema = z.object({
    claudeAiOauth: z.object({
        accessToken: z.string().nullable().optional(),
        refreshToken: z.string().nullable().optional()
    }).optional()
});
const UsageLockErrorSchema = z.enum(['timeout', 'rate-limited', 'parse-error']);
const UsageLockSchema = z.object({
    blockedUntil: z.number(),
    error: UsageLockErrorSchema.optional()
});

const CachedUsageDataSchema = z.object({
    sessionUsage: z.number().nullable().optional(),
    sessionResetAt: z.string().nullable().optional(),
    weeklyUsage: z.number().nullable().optional(),
    weeklyResetAt: z.string().nullable().optional(),
    weeklySonnetUsage: z.number().nullable().optional(),
    weeklySonnetResetAt: z.string().nullable().optional(),
    weeklyOpusUsage: z.number().nullable().optional(),
    weeklyOpusResetAt: z.string().nullable().optional(),
    fableUsage: z.number().nullable().optional(),
    fableResetAt: z.string().nullable().optional(),
    extraUsageEnabled: z.boolean().nullable().optional(),
    extraUsageLimit: z.number().nullable().optional(),
    extraUsageUsed: z.number().nullable().optional(),
    extraUsageUtilization: z.number().nullable().optional(),
    extraUsageCurrency: z.string().nullable().optional(),
    error: z.string().nullable().optional()
});

const CachedTokenHashSchema = z.object({ tokenHash: z.string().optional() });

const UsageApiBucketSchema = z.looseObject({
    utilization: z.number().nullable().optional(),
    resets_at: z.string().nullable().optional()
}).nullable().optional();

type UsageApiBucket = z.infer<typeof UsageApiBucketSchema>;

// Newer accounts no longer have the flat five_hour and seven_day buckets. They
// report the same windows in a limits[] array instead, see ccstatusline #503.
// Per-model weekly usage is in weekly_scoped entries, identified by
// scope.model.display_name. Only the fields this module reads are declared,
// and looseObject passes the rest through without failing validation.
const UsageApiLimitSchema = z.looseObject({
    kind: z.string().nullable().optional(),
    percent: z.number().nullable().optional(),
    resets_at: z.string().nullable().optional(),
    scope: z.looseObject({ model: z.looseObject({ display_name: z.string().nullable().optional() }).nullable().optional() }).nullable().catch(null).optional()
});

type UsageApiLimit = z.infer<typeof UsageApiLimitSchema>;

const UsageApiResponseSchema = z.looseObject({
    five_hour: UsageApiBucketSchema,
    seven_day: UsageApiBucketSchema,
    seven_day_sonnet: UsageApiBucketSchema,
    seven_day_opus: UsageApiBucketSchema,
    limits: z.array(UsageApiLimitSchema).nullable().optional(),
    extra_usage: z.looseObject({
        is_enabled: z.boolean().nullable().optional(),
        monthly_limit: z.number().nullable().optional(),
        used_credits: z.number().nullable().optional(),
        utilization: z.number().nullable().optional(),
        currency: z.string().nullable().optional()
    }).nullable().optional()
});

export const __testing = {
    CachedUsageDataSchema,
    UsageApiResponseSchema,
    parseUsageApiResponse
};

function getUsageApiBucketUtilization(bucket: UsageApiBucket): number | undefined {
    return bucket === null ? 0 : bucket?.utilization ?? undefined;
}

function findUsageApiLimit(limits: UsageApiLimit[] | null | undefined, kind: string): UsageApiLimit | undefined {
    return limits?.find(limit => limit.kind === kind);
}

// A limits[] entry that reports 0% with no resets_at is a placeholder, not a
// usage window, the same case as the null buckets in ccstatusline #343. The
// limits[] fallback must not show it as a 0% reading.
//
// A weekly_scoped entry that names a model is real data even at 0%. An account
// with a per-model quota reports percent 0 and resets_at null until the model is
// first used in the window. Accounts without the quota omit the entry.
function isPlaceholderUsageApiLimit(limit: UsageApiLimit): boolean {
    if (limit.scope?.model?.display_name) {
        return false;
    }
    return (limit.percent ?? 0) === 0 && (limit.resets_at ?? null) === null;
}

function getUsageApiLimitPercent(limit: UsageApiLimit | undefined): number | undefined {
    return limit && !isPlaceholderUsageApiLimit(limit) ? limit.percent ?? undefined : undefined;
}

function getUsageApiLimitResetAt(limit: UsageApiLimit | undefined): string | undefined {
    return limit && !isPlaceholderUsageApiLimit(limit) ? limit.resets_at ?? undefined : undefined;
}

// Finds a model's weekly quota in the limits[] array. A display name can start
// with a model family, for example "Claude 3.5 Fable", so matching ignores case
// and accepts the registry name as a substring.
function findWeeklyScopedLimit(limits: UsageApiLimit[] | null | undefined, modelDisplayName: string): UsageApiLimit | undefined {
    const normalizedModelName = modelDisplayName.toLowerCase();
    return limits?.find(limit => (
        limit.kind === 'weekly_scoped'
        && (limit.scope?.model?.display_name ?? '').toLowerCase().includes(normalizedModelName)
    ));
}

function parseJsonWithSchema<T>(rawJson: string, schema: z.ZodType<T>): T | null {
    try {
        const parsed = schema.safeParse(JSON.parse(rawJson));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

function parseUsageCredentials(rawJson: string): UsageCredentials | null {
    const oauth = parseJsonWithSchema(rawJson, UsageCredentialsSchema)?.claudeAiOauth;
    if (!oauth?.accessToken) {
        return null;
    }

    return {
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken ?? undefined
    };
}

function parseCachedUsageData(rawJson: string): UsageData | null {
    const parsed = parseJsonWithSchema(rawJson, CachedUsageDataSchema);
    if (!parsed) {
        return null;
    }

    const parsedError = UsageErrorSchema.safeParse(parsed.error);

    return {
        sessionUsage: parsed.sessionUsage ?? undefined,
        sessionResetAt: parsed.sessionResetAt ?? undefined,
        weeklyUsage: parsed.weeklyUsage ?? undefined,
        weeklyResetAt: parsed.weeklyResetAt ?? undefined,
        weeklySonnetUsage: parsed.weeklySonnetUsage ?? undefined,
        weeklySonnetResetAt: parsed.weeklySonnetResetAt ?? undefined,
        weeklyOpusUsage: parsed.weeklyOpusUsage ?? undefined,
        weeklyOpusResetAt: parsed.weeklyOpusResetAt ?? undefined,
        fableUsage: parsed.fableUsage ?? undefined,
        fableResetAt: parsed.fableResetAt ?? undefined,
        extraUsageEnabled: parsed.extraUsageEnabled ?? undefined,
        extraUsageLimit: parsed.extraUsageLimit ?? undefined,
        extraUsageUsed: parsed.extraUsageUsed ?? undefined,
        extraUsageUtilization: parsed.extraUsageUtilization ?? undefined,
        extraUsageCurrency: parsed.extraUsageCurrency ?? undefined,
        error: parsedError.success ? parsedError.data : undefined
    };
}

function fingerprintUsageToken(token: string): string {
    return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function getUsageCacheIdentity(credentials: UsageCredentials): UsageCacheIdentity {
    const accessTokenHash = fingerprintUsageToken(credentials.accessToken);
    return {
        preferredHash: credentials.refreshToken ? fingerprintUsageToken(credentials.refreshToken) : accessTokenHash,
        accessTokenHash
    };
}

function readCachedTokenHash(rawJson: string): string | undefined {
    return parseJsonWithSchema(rawJson, CachedTokenHashSchema)?.tokenHash;
}

function tokenHashMatches(cachedHash: string | undefined, identity: UsageCacheIdentity | null): boolean {
    if (identity === null) {
        return true;
    }
    return cachedHash === identity.preferredHash || cachedHash === identity.accessTokenHash;
}

function getLegacyUsageApiBucket(parsed: Record<string, unknown>, apiBucketKey: string): UsageApiBucket {
    return parsed[apiBucketKey] as UsageApiBucket;
}

export function parseUsageApiResponse(rawJson: string): UsageData | null {
    const parsed = parseJsonWithSchema(rawJson, UsageApiResponseSchema);
    if (!parsed) {
        return null;
    }

    // The flat five_hour and seven_day buckets come first. Accounts that moved to
    // limits[] can have them missing or null, so each field falls back to the
    // matching limits[] entry on its own. The percentage and resets_at can come
    // from different sources, see ccstatusline #503.
    const sessionLimit = findUsageApiLimit(parsed.limits, 'session');
    const weeklyLimit = findUsageApiLimit(parsed.limits, 'weekly_all');

    const result: UsageData = {
        sessionUsage: getUsageApiBucketUtilization(parsed.five_hour) ?? getUsageApiLimitPercent(sessionLimit),
        sessionResetAt: parsed.five_hour?.resets_at ?? getUsageApiLimitResetAt(sessionLimit),
        weeklyUsage: getUsageApiBucketUtilization(parsed.seven_day) ?? getUsageApiLimitPercent(weeklyLimit),
        weeklyResetAt: parsed.seven_day?.resets_at ?? getUsageApiLimitResetAt(weeklyLimit),
        extraUsageEnabled: parsed.extra_usage?.is_enabled ?? undefined,
        extraUsageLimit: parsed.extra_usage?.monthly_limit ?? undefined,
        extraUsageUsed: parsed.extra_usage?.used_credits ?? undefined,
        extraUsageUtilization: parsed.extra_usage?.utilization ?? undefined,
        extraUsageCurrency: parsed.extra_usage?.currency ?? undefined
    };

    for (const bucket of WEEKLY_MODEL_USAGE_BUCKETS) {
        const scopedLimit = findWeeklyScopedLimit(parsed.limits, bucket.modelDisplayName);
        const legacyBucket = bucket.apiBucketKey
            ? getLegacyUsageApiBucket(parsed, bucket.apiBucketKey)
            : undefined;

        setUsageField(
            result,
            bucket.usageField,
            getUsageApiLimitPercent(scopedLimit) ?? getUsageApiBucketUtilization(legacyBucket)
        );
        setUsageField(
            result,
            bucket.resetField,
            getUsageApiLimitResetAt(scopedLimit) ?? legacyBucket?.resets_at ?? undefined
        );
    }

    return result;
}

let cachedUsageData: UsageData | null = null;
let usageCacheTime = 0;
let usageErrorCacheMaxAge = LOCK_MAX_AGE;

type UsageLockError = z.infer<typeof UsageLockErrorSchema>;

type UsageApiFetchResult = { kind: 'success'; body: string } | { kind: 'rate-limited'; retryAfterSeconds: number } | { kind: 'error' };
interface MacKeychainCredentialCandidate {
    modifiedAt: string | null;
    order: number;
    service: string;
}

function ensureCacheDirExists(): void {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
}

function setCachedUsageError(error: UsageError, now: number, maxAge = LOCK_MAX_AGE): UsageData {
    const errorData: UsageData = { error };
    cachedUsageData = errorData;
    usageCacheTime = now;
    usageErrorCacheMaxAge = maxAge;
    return errorData;
}

function cacheUsageData(data: UsageData, now: number): UsageData {
    cachedUsageData = data;
    usageCacheTime = now;
    usageErrorCacheMaxAge = LOCK_MAX_AGE;
    return data;
}

function hasRequiredUsageField(data: UsageData, field: UsageDataField): boolean {
    if (data[field] !== undefined) {
        return true;
    }

    const windowSentinel = WINDOW_RESET_FIELD_SENTINELS[field];
    if (windowSentinel !== undefined && data[windowSentinel] !== undefined) {
        return true;
    }

    if (data.extraUsageEnabled !== undefined && EXTRA_USAGE_DETAIL_FIELDS.has(field)) {
        return true;
    }

    return (data.sessionUsage !== undefined || data.weeklyUsage !== undefined) && FABLE_USAGE_FIELDS.has(field);
}

function hasRequiredUsageFields(data: UsageData, requiredFields: readonly UsageDataField[] = []): boolean {
    return requiredFields.every(field => hasRequiredUsageField(data, field));
}

function getStaleUsageOrError(
    error: UsageError,
    now: number,
    cacheIdentity: UsageCacheIdentity | null,
    errorCacheMaxAge = LOCK_MAX_AGE,
    requiredFields: readonly UsageDataField[] = []
): UsageData {
    const stale = readStaleUsageCache(cacheIdentity);
    if (stale && !stale.error && hasRequiredUsageFields(stale, requiredFields)) {
        return cacheUsageData(stale, now);
    }

    return setCachedUsageError(error, now, errorCacheMaxAge);
}

function normalizeSecurityTimedateValue(rawValue: string): string | null {
    const cleaned = rawValue.replace(/\\000/g, '').replace(/\0/g, '').trim();
    return /^\d{14}Z$/.test(cleaned) ? cleaned : null;
}

function decodeHexAscii(rawHex: string): string | null {
    if (rawHex.length === 0 || rawHex.length % 2 !== 0) {
        return null;
    }

    let decoded = '';

    for (let i = 0; i < rawHex.length; i += 2) {
        const byte = Number.parseInt(rawHex.slice(i, i + 2), 16);
        if (Number.isNaN(byte)) {
            return null;
        }

        decoded += String.fromCharCode(byte);
    }

    return decoded;
}

function parseModifiedTimeFromKeychainBlock(block: string): string | null {
    const quotedMatch = /"mdat"<timedate>=(?:0x[0-9A-Fa-f]+\s+)?"([^"]+)"/.exec(block);
    if (quotedMatch?.[1]) {
        const parsed = normalizeSecurityTimedateValue(quotedMatch[1]);
        if (parsed !== null) {
            return parsed;
        }
    }

    const hexMatch = /"mdat"<timedate>=0x([0-9A-Fa-f]+)/.exec(block);
    if (!hexMatch?.[1]) {
        return null;
    }

    const decoded = decodeHexAscii(hexMatch[1]);
    return decoded ? normalizeSecurityTimedateValue(decoded) : null;
}

function sortMacKeychainCredentialCandidates(a: MacKeychainCredentialCandidate, b: MacKeychainCredentialCandidate): number {
    if (a.modifiedAt !== null && b.modifiedAt !== null && a.modifiedAt !== b.modifiedAt) {
        return b.modifiedAt.localeCompare(a.modifiedAt);
    }

    if (a.modifiedAt !== null && b.modifiedAt === null) {
        return -1;
    }

    if (a.modifiedAt === null && b.modifiedAt !== null) {
        return 1;
    }

    return a.order - b.order;
}

export function parseMacKeychainCredentialCandidates(rawDump: string, servicePrefix = MACOS_USAGE_CREDENTIALS_SERVICE): string[] {
    const blocks = rawDump.split(/(?=^keychain:\s)/m).filter(block => block.trim().length > 0);
    const dedupedCandidates = new Map<string, MacKeychainCredentialCandidate>();
    let order = 0;

    for (const block of blocks) {
        const serviceMatch = /"svce"<blob>="([^"]+)"/.exec(block);
        const service = serviceMatch?.[1];

        if (!service || !service.startsWith(servicePrefix) || service === MACOS_USAGE_CREDENTIALS_SERVICE) {
            continue;
        }

        const candidate: MacKeychainCredentialCandidate = {
            modifiedAt: parseModifiedTimeFromKeychainBlock(block),
            order,
            service
        };
        order += 1;

        const existing = dedupedCandidates.get(service);
        if (!existing || sortMacKeychainCredentialCandidates(candidate, existing) < 0) {
            dedupedCandidates.set(service, candidate);
        }
    }

    return [...dedupedCandidates.values()]
        .sort(sortMacKeychainCredentialCandidates)
        .map(candidate => candidate.service);
}

function readMacKeychainSecret(service: string): string | null {
    try {
        return execFileSync(
            'security',
            ['find-generic-password', '-s', service, '-w'],
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
        ).trim();
    } catch {
        return null;
    }
}

function readUsageCredentialsFromMacKeychainService(service: string): UsageCredentials | null {
    const secret = readMacKeychainSecret(service);
    return secret ? parseUsageCredentials(secret) : null;
}

function listMacKeychainCredentialCandidates(): string[] {
    try {
        const rawDump = execFileSync(
            'security',
            ['dump-keychain'],
            {
                encoding: 'utf8',
                maxBuffer: MACOS_SECURITY_DUMP_MAX_BUFFER,
                stdio: ['pipe', 'pipe', 'ignore'],
                windowsHide: true
            }
        );

        return parseMacKeychainCredentialCandidates(rawDump);
    } catch {
        return [];
    }
}

function readUsageCredentialsFromMacKeychainCandidates(): UsageCredentials | null {
    const candidates = listMacKeychainCredentialCandidates();

    for (const service of candidates) {
        const credentials = readUsageCredentialsFromMacKeychainService(service);
        if (credentials) {
            return credentials;
        }
    }

    return null;
}

function readUsageCredentialsFromCredentialsFile(): UsageCredentials | null {
    try {
        const credFile = path.join(getClaudeConfigDir(), '.credentials.json');
        return parseUsageCredentials(fs.readFileSync(credFile, 'utf8'));
    } catch {
        return null;
    }
}

export function getMacKeychainConfigDirService(): string | null {
    const rawConfigDir = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? '';
    if (rawConfigDir === '') {
        return null;
    }

    const configDir = rawConfigDir.normalize('NFC');
    const suffix = createHash('sha256').update(configDir).digest('hex').slice(0, 8);
    return `${MACOS_USAGE_CREDENTIALS_SERVICE}-${suffix}`;
}

export function getUsageCredentials(): UsageCredentials | null {
    if (process.platform !== 'darwin') {
        return readUsageCredentialsFromCredentialsFile();
    }

    const configDirService = getMacKeychainConfigDirService();
    if (configDirService !== null) {
        return readUsageCredentialsFromMacKeychainService(configDirService)
            ?? readUsageCredentialsFromCredentialsFile();
    }

    return readUsageCredentialsFromMacKeychainService(MACOS_USAGE_CREDENTIALS_SERVICE)
        ?? readUsageCredentialsFromMacKeychainCandidates()
        ?? readUsageCredentialsFromCredentialsFile();
}

export function getUsageToken(): string | null {
    return getUsageCredentials()?.accessToken ?? null;
}

function readStaleUsageCache(cacheIdentity: UsageCacheIdentity | null): UsageData | null {
    try {
        const rawCache = fs.readFileSync(CACHE_FILE, 'utf8');
        if (!tokenHashMatches(readCachedTokenHash(rawCache), cacheIdentity)) {
            return null;
        }
        return parseCachedUsageData(rawCache);
    } catch {
        return null;
    }
}

function writeUsageLock(blockedUntil: number, error: UsageLockError): void {
    try {
        ensureCacheDirExists();
        fs.writeFileSync(LOCK_FILE, JSON.stringify({ blockedUntil, error }));
    } catch {
    }
}

function clearUsageLock(): void {
    try {
        fs.rmSync(LOCK_FILE, { force: true });
    } catch {
    }
}

function readActiveUsageLock(now: number): { blockedUntil: number; error: UsageLockError } | null {
    let hasValidJsonLock = false;

    try {
        const parsed = parseJsonWithSchema(fs.readFileSync(LOCK_FILE, 'utf8'), UsageLockSchema);
        if (parsed) {
            hasValidJsonLock = true;
            if (parsed.blockedUntil > now && parsed.blockedUntil <= now + MAX_LOCK_HORIZON) {
                return {
                    blockedUntil: parsed.blockedUntil,
                    error: parsed.error ?? 'timeout'
                };
            }
            return null;
        }
    } catch {
    }

    if (hasValidJsonLock) {
        return null;
    }

    try {
        const lockStat = fs.statSync(LOCK_FILE);
        const lockMtime = Math.floor(lockStat.mtimeMs / 1000);
        const blockedUntil = lockMtime + LOCK_MAX_AGE;
        if (blockedUntil > now) {
            return {
                blockedUntil,
                error: 'timeout'
            };
        }
    } catch {
    }

    return null;
}

function parseRetryAfterSeconds(headerValue: string | string[] | undefined, nowMs = Date.now()): number | null {
    const rawValue = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const trimmedValue = rawValue?.trim();
    if (!trimmedValue) {
        return null;
    }

    if (/^\d+$/.test(trimmedValue)) {
        const seconds = Number.parseInt(trimmedValue, 10);
        return seconds > 0 ? seconds : null;
    }

    const retryAtMs = Date.parse(trimmedValue);
    if (Number.isNaN(retryAtMs)) {
        return null;
    }

    const retryAfterSeconds = Math.ceil((retryAtMs - nowMs) / 1000);
    return retryAfterSeconds > 0 ? retryAfterSeconds : null;
}

const USAGE_API_HOST = 'api.anthropic.com';
const USAGE_API_PATH = '/api/oauth/usage';
const USAGE_API_TIMEOUT_MS = 5000;

function getUsageApiProxyUrl(): string | null {
    const proxyUrl = process.env.HTTPS_PROXY?.trim();
    if (proxyUrl === '') {
        return null;
    }

    return proxyUrl ?? null;
}

function getUsageApiRequestOptions(token: string): https.RequestOptions | null {
    const proxyUrl = getUsageApiProxyUrl();

    try {
        return {
            hostname: USAGE_API_HOST,
            path: USAGE_API_PATH,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'anthropic-beta': 'oauth-2025-04-20'
            },
            timeout: USAGE_API_TIMEOUT_MS,
            ...(proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl) } : {})
        };
    } catch {
        return null;
    }
}

async function fetchFromUsageApi(token: string): Promise<UsageApiFetchResult> {
    return new Promise((resolve) => {
        let settled = false;

        const finish = (value: UsageApiFetchResult) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(value);
        };

        const requestOptions = getUsageApiRequestOptions(token);
        if (!requestOptions) {
            finish({ kind: 'error' });
            return;
        }

        const request = https.request(requestOptions, (response) => {
            let data = '';
            response.setEncoding('utf8');

            response.on('data', (chunk: string) => {
                data += chunk;
            });

            response.on('end', () => {
                if (response.statusCode === 200 && data) {
                    finish({ kind: 'success', body: data });
                    return;
                }

                if (response.statusCode === 429) {
                    finish({
                        kind: 'rate-limited',
                        retryAfterSeconds: parseRetryAfterSeconds(response.headers['retry-after']) ?? DEFAULT_RATE_LIMIT_BACKOFF
                    });
                    return;
                }

                finish({ kind: 'error' });
            });
        });

        request.on('error', () => { finish({ kind: 'error' }); });
        request.on('timeout', () => {
            request.destroy();
            finish({ kind: 'error' });
        });
        request.end();
    });
}

export async function fetchUsageData(options: FetchUsageDataOptions = {}): Promise<UsageData> {
    const now = Math.floor(Date.now() / 1000);
    const requiredFields = options.requiredFields ?? [];

    if (cachedUsageData) {
        const cacheAge = now - usageCacheTime;
        if (!cachedUsageData.error && cacheAge < CACHE_MAX_AGE && hasRequiredUsageFields(cachedUsageData, requiredFields)) {
            return cachedUsageData;
        }
        if (cachedUsageData.error && cacheAge < usageErrorCacheMaxAge) {
            return cachedUsageData;
        }
    }

    const credentials = getUsageCredentials();
    const token = credentials?.accessToken ?? null;
    const cacheIdentity = credentials ? getUsageCacheIdentity(credentials) : null;

    try {
        const stat = fs.statSync(CACHE_FILE);
        const fileAge = now - Math.floor(stat.mtimeMs / 1000);
        if (fileAge < CACHE_MAX_AGE) {
            const rawCache = fs.readFileSync(CACHE_FILE, 'utf8');
            const fileData = parseCachedUsageData(rawCache);
            if (fileData && !fileData.error
                && tokenHashMatches(readCachedTokenHash(rawCache), cacheIdentity)
                && hasRequiredUsageFields(fileData, requiredFields)) {
                return cacheUsageData(fileData, now);
            }
        }
    } catch {
    }

    if (!token) {
        return getStaleUsageOrError('no-credentials', now, cacheIdentity, LOCK_MAX_AGE, requiredFields);
    }

    const activeLock = readActiveUsageLock(now);
    if (activeLock) {
        return getStaleUsageOrError(
            activeLock.error,
            now,
            cacheIdentity,
            Math.max(1, activeLock.blockedUntil - now),
            requiredFields
        );
    }

    writeUsageLock(now + LOCK_MAX_AGE, 'timeout');

    try {
        const response = await fetchFromUsageApi(token);

        if (response.kind === 'rate-limited') {
            writeUsageLock(now + response.retryAfterSeconds, 'rate-limited');
            return getStaleUsageOrError('rate-limited', now, cacheIdentity, response.retryAfterSeconds, requiredFields);
        }

        if (response.kind === 'error') {
            return getStaleUsageOrError('api-error', now, cacheIdentity, LOCK_MAX_AGE, requiredFields);
        }

        const usageData = parseUsageApiResponse(response.body);
        if (!usageData) {
            writeUsageLock(now + LOCK_MAX_AGE, 'parse-error');
            return getStaleUsageOrError('parse-error', now, cacheIdentity, LOCK_MAX_AGE, requiredFields);
        }

        if (usageData.sessionUsage === undefined && usageData.weeklyUsage === undefined) {
            writeUsageLock(now + LOCK_MAX_AGE, 'parse-error');
            return getStaleUsageOrError('parse-error', now, cacheIdentity, LOCK_MAX_AGE, requiredFields);
        }

        try {
            ensureCacheDirExists();
            fs.writeFileSync(CACHE_FILE, JSON.stringify({ ...usageData, tokenHash: cacheIdentity?.preferredHash }));
        } catch {
        }

        if (hasRequiredUsageFields(usageData, requiredFields)) {
            clearUsageLock();
        }

        return cacheUsageData(usageData, now);
    } catch {
        writeUsageLock(now + LOCK_MAX_AGE, 'parse-error');
        return getStaleUsageOrError('parse-error', now, cacheIdentity, LOCK_MAX_AGE, requiredFields);
    }
}
