import { z } from 'zod';

export const FIVE_HOUR_BLOCK_MS = 5 * 60 * 60 * 1000;
export const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const UsageErrorSchema = z.enum(['no-credentials', 'timeout', 'rate-limited', 'api-error', 'parse-error']);
export type UsageError = z.infer<typeof UsageErrorSchema>;

export interface UsageData {
    sessionUsage?: number;
    sessionResetAt?: string;
    weeklyUsage?: number;
    weeklyResetAt?: string;
    weeklySonnetUsage?: number;
    weeklySonnetResetAt?: string;
    weeklyOpusUsage?: number;
    weeklyOpusResetAt?: string;
    fableUsage?: number;
    fableResetAt?: string;
    extraUsageEnabled?: boolean;
    extraUsageLimit?: number;
    extraUsageUsed?: number;
    extraUsageUtilization?: number;
    extraUsageCurrency?: string;
    error?: UsageError;
}

export interface UsageWindowMetrics {
    sessionDurationMs: number;
    elapsedMs: number;
    remainingMs: number;
    elapsedPercent: number;
    remainingPercent: number;
}

export type UsageDataField = Exclude<keyof UsageData, 'error'>;

export function setUsageField<K extends UsageDataField>(target: Partial<UsageData>, field: K, value: UsageData[K]): void {
    target[field] = value;
}

export interface WeeklyModelUsageBucket {
    widgetType: string;
    // Since 2026-07, /api/oauth/usage reports per-model weekly usage as a
    // weekly_scoped entry in its `limits` array, matched by
    // scope.model.display_name. The older flat keys such as seven_day_sonnet
    // return null even for models with real usage. modelDisplayName is the
    // limits[] lookup key. apiBucketKey is set only for models that also have
    // a legacy flat bucket.
    modelDisplayName: string;
    apiBucketKey?: string;
    usageField: UsageDataField;
    resetField: UsageDataField;
}

export const WEEKLY_MODEL_USAGE_BUCKETS: readonly WeeklyModelUsageBucket[] = [
    { widgetType: 'weekly-sonnet-usage', modelDisplayName: 'Sonnet', apiBucketKey: 'seven_day_sonnet', usageField: 'weeklySonnetUsage', resetField: 'weeklySonnetResetAt' },
    { widgetType: 'weekly-opus-usage', modelDisplayName: 'Opus', apiBucketKey: 'seven_day_opus', usageField: 'weeklyOpusUsage', resetField: 'weeklyOpusResetAt' },
    { widgetType: 'fable-weekly-usage', modelDisplayName: 'Fable', usageField: 'fableUsage', resetField: 'fableResetAt' }
];
