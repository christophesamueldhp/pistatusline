import type { NumberFormat } from '../types/NumberFormat';

import {
    effectiveDecimals,
    renderMagnitude
} from './number-format';

export function formatTokens(count: number, format: NumberFormat = {}, decimals = 1): string {
    const kDecimals = effectiveDecimals(format, decimals);
    if (count >= 1000000 - 500 / 10 ** kDecimals)
        return `${renderMagnitude(count / 1000000, format, 1)}M`;
    if (count >= 1000)
        return `${renderMagnitude(count / 1000, format, decimals)}k`;
    return count.toString();
}
