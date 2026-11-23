import type { WidgetItem } from '../../types/Widget';

const FORMAT_METADATA_KEY = 'format';
const NERD_FONT_METADATA_KEY = 'nerdFont';

export function isMetadataFlagEnabled(item: WidgetItem, key: string): boolean {
    return item.metadata?.[key] === 'true';
}

export function toggleMetadataFlag(item: WidgetItem, key: string): WidgetItem {
    return {
        ...item,
        metadata: {
            ...item.metadata,
            [key]: (!isMetadataFlagEnabled(item, key)).toString()
        }
    };
}

export function removeMetadataKeys(item: WidgetItem, keys: string[]): WidgetItem {
    const nextMetadata = Object.fromEntries(
        Object.entries(item.metadata ?? {}).filter(([key]) => !keys.includes(key))
    );

    return {
        ...item,
        metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined
    };
}

export interface NerdFontFormats<TFormat extends string> {
    defaultFormat: TFormat;
    canUseNerdFont: (item: WidgetItem) => boolean;
}

function removeNerdFont(item: WidgetItem): WidgetItem {
    return removeMetadataKeys(item, [NERD_FONT_METADATA_KEY]);
}

export function isNerdFontEnabled<TFormat extends string>(item: WidgetItem, formats: NerdFontFormats<TFormat>): boolean {
    return formats.canUseNerdFont(item) && isMetadataFlagEnabled(item, NERD_FONT_METADATA_KEY);
}

export function setNerdFontFormat<TFormat extends string>(item: WidgetItem, format: TFormat, formats: NerdFontFormats<TFormat>): WidgetItem {
    let updatedItem: WidgetItem;

    if (format === formats.defaultFormat) {
        updatedItem = removeMetadataKeys(item, [FORMAT_METADATA_KEY]);
    } else {
        updatedItem = {
            ...item,
            metadata: {
                ...item.metadata,
                [FORMAT_METADATA_KEY]: format
            }
        };
    }

    return formats.canUseNerdFont(updatedItem) ? updatedItem : removeNerdFont(updatedItem);
}

export function toggleNerdFont<TFormat extends string>(item: WidgetItem, formats: NerdFontFormats<TFormat>): WidgetItem {
    if (isNerdFontEnabled(item, formats) || !formats.canUseNerdFont(item)) {
        return removeNerdFont(item);
    }

    return {
        ...item,
        metadata: {
            ...item.metadata,
            [NERD_FONT_METADATA_KEY]: 'true'
        }
    };
}
