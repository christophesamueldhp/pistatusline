import type {
    BlockMetrics,
    SkillsMetrics
} from '../types';

import type { SpeedMetrics } from './SpeedMetrics';
import type { StatusJSON } from './StatusJSON';
import type { TokenMetrics } from './TokenMetrics';

export interface RenderUsageData {
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
    error?: 'no-credentials' | 'timeout' | 'rate-limited' | 'api-error' | 'parse-error';
}

export interface ClaudeStatusRenderData {
    indicator?: string;
    incidents?: {
        impact: 'minor' | 'major' | 'critical';
        startMs: number;
        endMs: number | null;
    }[];
    error?: boolean;
}

export interface CompactionData {
    count: number;
    byTrigger: { auto: number; manual: number; unknown: number };
    tokensReclaimed: number;
}

export interface RenderContext {
    data?: StatusJSON;
    tokenMetrics?: TokenMetrics | null;
    speedMetrics?: SpeedMetrics | null;
    windowedSpeedMetrics?: Record<string, SpeedMetrics> | null;
    usageData?: RenderUsageData | null;
    claudeStatusData?: ClaudeStatusRenderData | null;
    sessionDuration?: string | null;
    transcriptSessionName?: string | null;
    transcriptThinkingEffort?: { value: string; known: boolean } | null;
    blockMetrics?: BlockMetrics | null;
    skillsMetrics?: SkillsMetrics | null;
    compactionData?: CompactionData | null;
    terminalWidth?: number | null;
    isPreview?: boolean;
    minimalist?: boolean;
    gitCacheTtlSeconds?: number;
    customCommandCacheTtlSeconds?: number;
    gitReviewNeedsChecks?: boolean;
    lineIndex?: number;
    globalSeparatorIndex?: number;

    gitData?: {
        changedFiles?: number;
        insertions?: number;
        deletions?: number;
    };
    globalPowerlineThemeIndex?: number;
    globalPowerlineStartCapIndex?: number;
}
