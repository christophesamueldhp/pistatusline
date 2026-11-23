import type { NumberFormat } from '../types/NumberFormat';
import type { SpeedMetrics } from '../types/SpeedMetrics';

import { renderMagnitude } from './number-format';

export function calculateOutputSpeed(metrics: SpeedMetrics): number | null {
    if (metrics.totalDurationMs === 0) {
        return null;
    }
    const seconds = metrics.totalDurationMs / 1000;
    return metrics.outputTokens / seconds;
}

export function calculateInputSpeed(metrics: SpeedMetrics): number | null {
    if (metrics.totalDurationMs === 0) {
        return null;
    }
    const seconds = metrics.totalDurationMs / 1000;
    return metrics.inputTokens / seconds;
}

export function calculateTotalSpeed(metrics: SpeedMetrics): number | null {
    if (metrics.totalDurationMs === 0) {
        return null;
    }
    const seconds = metrics.totalDurationMs / 1000;
    return metrics.totalTokens / seconds;
}

export function formatSpeed(tokensPerSec: number | null, format: NumberFormat = {}): string {
    if (tokensPerSec === null) {
        return '—';
    }

    if (tokensPerSec >= 1000) {
        return `${renderMagnitude(tokensPerSec / 1000, format, 1)}k t/s`;
    }

    return `${renderMagnitude(tokensPerSec, format, 1)} t/s`;
}
