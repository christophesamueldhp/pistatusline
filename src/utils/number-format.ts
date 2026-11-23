import type {
    NumberFormat,
    NumberKind,
    NumberStyle
} from '../types/NumberFormat';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    WidgetItem
} from '../types/Widget';

export const CYCLE_NUMBER_STYLE_ACTION = 'cycle-number-style';
const NUMBER_FORMAT_KEYBIND: CustomKeybind = { key: '.', label: '(.) precision', action: CYCLE_NUMBER_STYLE_ACTION };

export function getNumberFormatKeybind(): CustomKeybind {
    return NUMBER_FORMAT_KEYBIND;
}

export function getNumberFormatModifierText(item: WidgetItem): string | undefined {
    const style = item.numberFormat?.style;
    return style === 'compact' || style === 'whole' ? `(${style})` : undefined;
}

export function getNextNumberStyle(currentStyle: NumberStyle | undefined): NumberStyle | undefined {
    const normalizedStyle = currentStyle === 'precise' ? undefined : currentStyle;

    return normalizedStyle === undefined
        ? 'compact'
        : normalizedStyle === 'compact'
            ? 'whole'
            : undefined;
}

export function cycleNumberStyle(item: WidgetItem): WidgetItem {
    const nextStyle = getNextNumberStyle(item.numberFormat?.style);
    const decimals = item.numberFormat?.decimals;

    if (nextStyle === undefined && decimals === undefined) {
        const { numberFormat, ...restItem } = item;
        return restItem;
    }

    const nextFormat: NumberFormat = {};
    if (nextStyle !== undefined) {
        nextFormat.style = nextStyle;
    }
    if (decimals !== undefined) {
        nextFormat.decimals = decimals;
    }

    return {
        ...item,
        numberFormat: nextFormat
    };
}

function trimTrailingZeros(value: string): string {
    return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

export function effectiveDecimals(format: NumberFormat, baselineDecimals: number): number {
    if (format.style === 'whole')
        return 0;
    return format.decimals ?? baselineDecimals;
}

export function renderMagnitude(value: number, format: NumberFormat, baselineDecimals: number): string {
    const fixed = value.toFixed(effectiveDecimals(format, baselineDecimals));
    return format.style === 'compact' ? trimTrailingZeros(fixed) : fixed;
}

export function formatPercent(value: number, format: NumberFormat = {}, baselineDecimals = 1): string {
    return `${renderMagnitude(value, format, baselineDecimals)}%`;
}

export function formatCost(value: number, format: NumberFormat = {}): string {
    return `$${renderMagnitude(value, format, 2)}`;
}

export function resolveNumberFormat(kind: NumberKind, item: WidgetItem, settings: Settings): NumberFormat {
    return settings.numberFormat?.[kind] ?? item.numberFormat ?? {};
}
