import type { NumberFormat } from '../../types/NumberFormat';
import type { RenderContext } from '../../types/RenderContext';
import {
    getContextWindowTurnCacheTokens,
    type TurnCacheTokens
} from '../../utils/context-window';
import { formatPercent } from '../../utils/number-format';
import { formatTokens } from '../../utils/renderer';

export function getCacheTokens(context: RenderContext, sessionScope: boolean): TurnCacheTokens | null {
    if (sessionScope) {
        const metrics = context.tokenMetrics;
        if (!metrics) {
            return null;
        }

        return {
            read: metrics.cacheReadTokens ?? 0,
            creation: metrics.cacheCreationTokens ?? 0,
            input: metrics.inputTokens
        };
    }

    return getContextWindowTurnCacheTokens(context.data);
}

export function getCacheHitRate(tokens: TurnCacheTokens): number | null {
    const denominator = tokens.read + tokens.creation;
    return denominator > 0 ? (tokens.read / denominator) * 100 : null;
}

export function getCacheReadPercentage(tokens: TurnCacheTokens): number | null {
    const denominator = tokens.input + tokens.read + tokens.creation;
    return denominator > 0 ? (tokens.read / denominator) * 100 : null;
}

export function getCacheWritePercentage(tokens: TurnCacheTokens): number | null {
    const denominator = tokens.input + tokens.read + tokens.creation;
    return denominator > 0 ? (tokens.creation / denominator) * 100 : null;
}

export function formatTokensWithPercentage(
    tokenCount: number,
    percentage: number | null,
    tokenFormat: NumberFormat = {},
    percentFormat: NumberFormat = {}
): string {
    const tokens = formatTokens(tokenCount, tokenFormat);
    return percentage === null ? tokens : `${tokens} (${formatPercent(percentage, percentFormat)})`;
}
