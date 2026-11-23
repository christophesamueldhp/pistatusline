import chalk from 'chalk';

import type {
    RenderContext,
    WidgetItem
} from '../types';
import {
    getColorLevelString,
    type ColorLevel
} from '../types/ColorLevel';
import type {
    DefaultPaddingSide,
    Settings
} from '../types/Settings';
import {
    MERGE_TARGET_HIDDEN_HIDEABLE_STATE,
    isHidden
} from '../widgets/shared/hideable';

import {
    applyLineGradient,
    applyLineGradientSegment,
    getVisibleText,
    getVisibleWidth,
    stripSgrCodes,
    truncateStyledText
} from './ansi';
import {
    applyColors,
    applyParensDim,
    bgToFg,
    getColorAnsiCode,
    getPowerlineTheme
} from './colors';
import { calculateContextPercentage } from './context-percentage';
import {
    isGradientSpec,
    parseGradientSpec
} from './gradient';
import { getTerminalWidth } from './terminal';
import {
    getWidget,
    widgetPreservesColors
} from './widgets';

export { formatTokens } from './format-tokens';

export function buildConfigWarningBadge(colorLevel: ColorLevel): string {
    return applyColors('⚠ invalid config', 'red', undefined, false, getColorLevelString(colorLevel));
}

function maybeApplyForegroundGradient(
    line: string,
    settings: Settings,
    colorLevel: 'ansi16' | 'ansi256' | 'truecolor'
): string {
    const stops = parseGradientSpec(settings.overrideForegroundColor);
    return stops ? applyLineGradient(line, stops, colorLevel) : line;
}

function hasForegroundOverride(settings: Settings): boolean {
    return Boolean(settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none');
}

function preservesIntrinsicForeground(item: WidgetItem, settings: Settings): boolean {
    return widgetPreservesColors(item) && !hasForegroundOverride(settings);
}

function resolvePaddingSides(padding: string, side: DefaultPaddingSide | undefined): { leading: string; trailing: string } {
    if (side === 'left')
        return { leading: padding, trailing: '' };
    if (side === 'right')
        return { leading: '', trailing: padding };
    return { leading: padding, trailing: padding };
}

function resolveEffectiveTerminalWidth(
    detectedWidth: number | null,
    settings: Settings,
    context: RenderContext
): number | null {
    if (!detectedWidth) {
        return null;
    }

    const flexMode = settings.flexMode as string;

    if (context.isPreview) {
        if (flexMode === 'full') {
            return detectedWidth - 6;
        }
        if (flexMode === 'full-minus-40') {
            return detectedWidth - 40;
        }
        if (flexMode === 'full-until-compact') {
            return detectedWidth - 6;
        }
        return null;
    }

    // pistatusline: pi hands the footer its exact width, so the 6 columns that ccstatusline
    // reserves for Claude Code's own UI are not needed.
    if (flexMode === 'full') {
        return detectedWidth;
    }
    if (flexMode === 'full-minus-40') {
        return detectedWidth - 40;
    }
    if (flexMode === 'full-until-compact') {
        const threshold = settings.compactThreshold;
        const contextPercentage = calculateContextPercentage(context);
        return contextPercentage >= threshold
            ? detectedWidth - 40
            : detectedWidth;
    }

    return null;
}

function renderPowerlineStatusLine(
    widgets: WidgetItem[],
    settings: Settings,
    context: RenderContext,
    lineIndex = 0,
    globalSeparatorOffset = 0,
    globalThemeColorOffset = 0,
    preRenderedWidgets: PreRenderedWidget[],
    preCalculatedMaxWidths: number[]
): string {
    const powerlineConfig = settings.powerline as Record<string, unknown> | undefined;
    const config = powerlineConfig ?? {};
    const continueThemeAcrossLines = Boolean(config.continueThemeAcrossLines);

    const separators = (config.separators as string[] | undefined) ?? ['\uE0B0'];
    const invertBgs = (config.separatorInvertBackground as boolean[] | undefined) ?? separators.map(() => false);

    const startCaps = (config.startCaps as string[] | undefined) ?? [];
    const endCaps = (config.endCaps as string[] | undefined) ?? [];

    const capLineIndex = context.lineIndex ?? lineIndex;
    const startCapIndex = context.globalPowerlineStartCapIndex ?? capLineIndex;
    const getStartCap = (segmentOffset: number): string => (
        startCaps.length > 0 ? (startCaps[(startCapIndex + segmentOffset) % startCaps.length] ?? '') : ''
    );
    const getEndCap = (segmentOffset: number): string => (
        endCaps.length > 0 ? (endCaps[(startCapIndex + segmentOffset) % endCaps.length] ?? '') : ''
    );

    const themeName = config.theme as string | undefined;
    let themeColors: { fg: string[]; bg: string[] } | undefined;

    if (themeName && themeName !== 'custom') {
        const theme = getPowerlineTheme(themeName);
        if (theme) {
            const colorLevel = getColorLevelString(settings.colorLevel);
            const colorLevelKey = colorLevel === 'ansi16' ? '1' : colorLevel === 'ansi256' ? '2' : '3';
            themeColors = theme[colorLevelKey];
        }
    }

    const colorLevel = getColorLevelString(settings.colorLevel);
    const overrideForegroundGradientStops = parseGradientSpec(settings.overrideForegroundColor);
    const isSeparatorBoundary = (widget: WidgetItem | undefined): boolean => (
        widget?.type === 'separator' || widget?.type === 'flex-separator'
    );

    const filteredWidgets = widgets.filter(widget => widget.type !== 'separator' && widget.type !== 'flex-separator'
    );

    const FLEX_SENTINEL = '\x01FLEX_SEP\x01';

    if (filteredWidgets.length === 0)
        return '';

    const detectedWidth = context.terminalWidth ?? getTerminalWidth();

    const terminalWidth = resolveEffectiveTerminalWidth(detectedWidth, settings, context);

    const widgetElements: {
        content: string;
        bgColor?: string;
        fgColor?: string;
        mergesWithNext: boolean;
        originalIndex: number;
        widget: WidgetItem;
    }[] = [];
    let widgetColorIndex = continueThemeAcrossLines ? globalThemeColorOffset : 0;

    const hasNextRenderedWidgetBeforeSeparator = (originalIndex: number): boolean => {
        for (let j = originalIndex + 1; j < widgets.length; j++) {
            const nextWidget = widgets[j];
            if (!nextWidget)
                continue;
            if (isSeparatorBoundary(nextWidget))
                return false;
            if (preRenderedWidgets[j]?.content)
                return true;
        }

        return false;
    };

    const canMergeWithNextRenderedWidget = (originalIndex: number | undefined): boolean => {
        if (originalIndex === undefined)
            return false;

        const widget = widgets[originalIndex];
        return Boolean(widget?.merge && hasNextRenderedWidgetBeforeSeparator(originalIndex));
    };

    const findPreviousRenderedWidgetIndexBeforeSeparator = (originalIndex: number): number | null => {
        for (let j = originalIndex - 1; j >= 0; j--) {
            const previousWidget = widgets[j];
            if (!previousWidget)
                continue;
            if (isSeparatorBoundary(previousWidget))
                return null;
            if (preRenderedWidgets[j]?.content)
                return j;
        }

        return null;
    };

    const preRenderedIndices: number[] = [];
    for (let i = 0; i < widgets.length; i++) {
        const widget = widgets[i];
        if (widget && widget.type !== 'separator' && widget.type !== 'flex-separator') {
            preRenderedIndices.push(i);
        }
    }

    for (let i = 0; i < filteredWidgets.length; i++) {
        const widget = filteredWidgets[i];
        if (!widget)
            continue;
        let widgetText = '';
        let defaultColor = 'white';

        if (widget.type === 'separator' || widget.type === 'flex-separator') {
            continue;
        }

        const actualPreRenderedIndex = preRenderedIndices[i];
        const preRendered = actualPreRenderedIndex !== undefined ? preRenderedWidgets[actualPreRenderedIndex] : undefined;
        const widgetImpl = getWidget(widget.type);
        if (preRendered?.content) {
            widgetText = preRendered.content;
            if (widgetImpl) {
                defaultColor = widgetImpl.getDefaultColor();
            }
        }

        if (widgetText) {
            const padding = settings.defaultPadding ?? '';
            const { leading: sideLeadingPadding, trailing: sideTrailingPadding } = resolvePaddingSides(padding, settings.defaultPaddingSide);

            if (hasForegroundOverride(settings) && widgetPreservesColors(widget)) {
                widgetText = stripSgrCodes(widgetText);
            }

            const previousRenderedIndex = actualPreRenderedIndex !== undefined
                ? findPreviousRenderedWidgetIndexBeforeSeparator(actualPreRenderedIndex)
                : null;
            const previousRenderedWidget = previousRenderedIndex !== null
                ? widgets[previousRenderedIndex]
                : undefined;
            const mergesWithNext = canMergeWithNextRenderedWidget(actualPreRenderedIndex);
            const omitLeadingPadding = previousRenderedWidget?.merge === 'no-padding'
                && canMergeWithNextRenderedWidget(previousRenderedIndex ?? undefined);
            const omitTrailingPadding = widget.merge === 'no-padding' && mergesWithNext;

            const leadingPadding = omitLeadingPadding ? '' : sideLeadingPadding;
            const trailingPadding = omitTrailingPadding ? '' : sideTrailingPadding;
            const paddedText = `${leadingPadding}${widgetText}${trailingPadding}`;

            let fgColor = widget.color ?? defaultColor;
            let bgColor = widget.backgroundColor;

            const skipFgTheme = preservesIntrinsicForeground(widget, settings);

            if (themeColors) {
                if (!skipFgTheme) {
                    fgColor = themeColors.fg[widgetColorIndex % themeColors.fg.length] ?? fgColor;
                }
                bgColor = themeColors.bg[widgetColorIndex % themeColors.bg.length] ?? bgColor;

                if (!mergesWithNext) {
                    widgetColorIndex++;
                }
            }

            if (settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none'
                && !isGradientSpec(settings.overrideForegroundColor)) {
                fgColor = settings.overrideForegroundColor;
            }

            widgetElements.push({
                content: paddedText,
                bgColor: bgColor ?? undefined,
                fgColor: fgColor,
                mergesWithNext,
                originalIndex: actualPreRenderedIndex ?? -1,
                widget: widget
            });
        }
    }

    if (widgetElements.length === 0)
        return '';

    const renderedElementIndexByOriginalIndex = new Map<number, number>();
    widgetElements.forEach((element, index) => {
        renderedElementIndexByOriginalIndex.set(element.originalIndex, index);
    });

    const flexAfterIndex = new Map<number, number>();
    const startCapBeforeIndex = new Map<number, number>();
    const segmentOffsetByRenderedIndex = new Map<number, number>();
    let leadingFlexCount = 0;
    let totalFlexCount = 0;
    let lastRenderedIndex: number | null = null;
    let pendingFlexCount = 0;
    let segmentOffset = 0;
    let hasRenderedSegment = false;
    for (let i = 0; i < widgets.length; i++) {
        const widget = widgets[i];
        if (!widget || widget.type === 'separator')
            continue;

        if (widget.type === 'flex-separator') {
            totalFlexCount++;
            if (lastRenderedIndex === null) {
                leadingFlexCount++;
            } else {
                pendingFlexCount++;
                flexAfterIndex.set(lastRenderedIndex, (flexAfterIndex.get(lastRenderedIndex) ?? 0) + 1);
            }
            continue;
        }

        const renderedIndex = renderedElementIndexByOriginalIndex.get(i);
        if (renderedIndex !== undefined) {
            if (!hasRenderedSegment) {
                startCapBeforeIndex.set(renderedIndex, segmentOffset);
                pendingFlexCount = 0;
                hasRenderedSegment = true;
            } else if (pendingFlexCount > 0) {
                segmentOffset++;
                startCapBeforeIndex.set(renderedIndex, segmentOffset);
                pendingFlexCount = 0;
            }
            segmentOffsetByRenderedIndex.set(renderedIndex, segmentOffset);
            lastRenderedIndex = renderedIndex;
        }
    }

    const autoAlign = config.autoAlign as boolean | undefined;
    if (autoAlign) {
        let alignmentPos = 0;
        for (let i = 0; i < widgetElements.length; i++) {
            const element = widgetElements[i];
            if (!element)
                continue;

            if (element.widget.excludeFromAutoAlign)
                break;

            const prevWidget = i > 0 ? widgetElements[i - 1] : null;
            const isPreviousMerged = prevWidget?.mergesWithNext;

            if (!isPreviousMerged) {
                const maxWidth = preCalculatedMaxWidths[alignmentPos];
                if (maxWidth !== undefined) {
                    let combinedLength = getVisibleWidth(element.content);
                    let j = i;
                    while (j < widgetElements.length - 1 && widgetElements[j]?.mergesWithNext) {
                        j++;
                        const nextElement = widgetElements[j];
                        if (nextElement) {
                            combinedLength += getVisibleWidth(nextElement.content);
                        }
                    }

                    const paddingNeeded = maxWidth - combinedLength;
                    if (paddingNeeded > 0) {
                        const lastElement = widgetElements[j];
                        if (lastElement) {
                            lastElement.content += ' '.repeat(paddingNeeded);
                        }
                    }

                    i = j;
                }
                alignmentPos++;
            }
        }
    }

    const powerlineGradientWidth = overrideForegroundGradientStops && colorLevel !== 'ansi16'
        ? widgetElements.reduce((sum, element) => {
            const isPreserveColors = preservesIntrinsicForeground(element.widget, settings);
            return isPreserveColors ? sum : sum + getVisibleWidth(element.content);
        }, 0)
        : 0;
    let powerlineGradientColumn = 0;

    let result = '';

    if (leadingFlexCount > 0) {
        result += FLEX_SENTINEL.repeat(leadingFlexCount);
    }

    let localSeparatorIndex = 0;
    for (let i = 0; i < widgetElements.length; i++) {
        const widget = widgetElements[i];
        const nextWidget = widgetElements[i + 1];

        if (!widget)
            continue;

        const shouldBold = (settings.globalBold) || widget.widget.bold;
        const shouldDim = widget.widget.dim === true;

        const needsSeparator = i < widgetElements.length - 1 && separators.length > 0 && nextWidget !== undefined && !widget.mergesWithNext;
        const flexCountAfter = flexAfterIndex.get(i) ?? 0;
        const currentSegmentOffset = segmentOffsetByRenderedIndex.get(i) ?? 0;
        const isLastWidget = i === widgetElements.length - 1;
        const hasEndCapAfterWidget = Boolean(getEndCap(currentSegmentOffset)) && (flexCountAfter > 0 || isLastWidget);

        const startCapSegmentOffset = startCapBeforeIndex.get(i);
        if (startCapSegmentOffset !== undefined) {
            const segmentStartCap = getStartCap(startCapSegmentOffset);
            if (segmentStartCap) {
                if (widget.bgColor) {
                    const capFg = bgToFg(widget.bgColor);
                    const fgCode = getColorAnsiCode(capFg, colorLevel, false);
                    result += fgCode + segmentStartCap + '\x1b[39m';
                } else {
                    result += segmentStartCap;
                }
            }
        }

        let widgetContent = '';

        const isPreserveColors = preservesIntrinsicForeground(widget.widget, settings);

        if (shouldBold) {
            widgetContent += '\x1b[1m';
        }
        if (shouldDim) {
            widgetContent += '\x1b[2m';
        }
        const textGradientStops = !isPreserveColors && powerlineGradientWidth > 1
            ? overrideForegroundGradientStops
            : null;
        const styledContent = widget.widget.dim === 'parens'
            ? applyParensDim(widget.content, shouldBold)
            : widget.content;

        if (widget.fgColor && !isPreserveColors && !textGradientStops) {
            widgetContent += getColorAnsiCode(widget.fgColor, colorLevel, false);
        }
        if (widget.bgColor) {
            widgetContent += getColorAnsiCode(widget.bgColor, colorLevel, true);
        }
        if (textGradientStops) {
            const gradientResult = applyLineGradientSegment(
                styledContent,
                textGradientStops,
                colorLevel,
                powerlineGradientColumn,
                powerlineGradientWidth
            );
            widgetContent += gradientResult.text;
            powerlineGradientColumn = gradientResult.nextColumn;
        } else {
            widgetContent += styledContent;
        }
        if (isPreserveColors) {
            widgetContent += '\x1b[0m';
        } else {
            widgetContent += '\x1b[49m\x1b[39m';
            const shouldRestoreBoldForBoundary = shouldDim && shouldBold && (needsSeparator || hasEndCapAfterWidget);
            if (shouldRestoreBoldForBoundary) {
                widgetContent += '\x1b[22;1m';
            } else if (shouldDim || (shouldBold && !needsSeparator && !hasEndCapAfterWidget)) {
                widgetContent += '\x1b[22m';
            }
        }

        result += widgetContent;

        if (flexCountAfter > 0) {
            const segmentEndCap = getEndCap(currentSegmentOffset);
            if (segmentEndCap) {
                if (widget.bgColor) {
                    const capFg = bgToFg(widget.bgColor);
                    const fgCode = getColorAnsiCode(capFg, colorLevel, false);
                    result += fgCode + segmentEndCap + '\x1b[39m';
                } else {
                    result += segmentEndCap;
                }
            }
            if (shouldBold) {
                result += '\x1b[22m';
            }
            result += FLEX_SENTINEL.repeat(flexCountAfter);
            continue;
        }

        if (needsSeparator) {
            const globalIndex = globalSeparatorOffset + localSeparatorIndex;
            const separatorIndex = globalIndex % separators.length;
            const separator = separators[separatorIndex] ?? '\uE0B0';
            const shouldInvert = invertBgs[separatorIndex] ?? false;

            let separatorOutput: string;

            const sameBackground = widget.bgColor && nextWidget.bgColor && widget.bgColor === nextWidget.bgColor;

            if (shouldInvert) {
                if (widget.bgColor && nextWidget.bgColor) {
                    if (sameBackground) {
                        const fgColor = nextWidget.fgColor;
                        const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                        const bgCode = getColorAnsiCode(widget.bgColor, colorLevel, true);
                        separatorOutput = fgCode + bgCode + separator + '\x1b[39m\x1b[49m';
                    } else {
                        const fgColor = bgToFg(nextWidget.bgColor);
                        const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                        const bgCode = getColorAnsiCode(widget.bgColor, colorLevel, true);
                        separatorOutput = fgCode + bgCode + separator + '\x1b[39m\x1b[49m';
                    }
                } else if (widget.bgColor && !nextWidget.bgColor) {
                    const fgColor = bgToFg(widget.bgColor);
                    const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                    separatorOutput = fgCode + separator + '\x1b[39m';
                } else if (!widget.bgColor && nextWidget.bgColor) {
                    const fgColor = bgToFg(nextWidget.bgColor);
                    const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                    separatorOutput = fgCode + separator + '\x1b[39m';
                } else {
                    separatorOutput = separator;
                }
            } else {
                if (widget.bgColor && nextWidget.bgColor) {
                    if (sameBackground) {
                        const fgColor = widget.fgColor;
                        const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                        const bgCode = getColorAnsiCode(nextWidget.bgColor, colorLevel, true);
                        separatorOutput = fgCode + bgCode + separator + '\x1b[39m\x1b[49m';
                    } else {
                        const fgColor = bgToFg(widget.bgColor);
                        const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                        const bgCode = getColorAnsiCode(nextWidget.bgColor, colorLevel, true);
                        separatorOutput = fgCode + bgCode + separator + '\x1b[39m\x1b[49m';
                    }
                } else if (widget.bgColor && !nextWidget.bgColor) {
                    const fgColor = bgToFg(widget.bgColor);
                    const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                    separatorOutput = fgCode + separator + '\x1b[39m';
                } else if (!widget.bgColor && nextWidget.bgColor) {
                    const fgColor = bgToFg(nextWidget.bgColor);
                    const fgCode = getColorAnsiCode(fgColor, colorLevel, false);
                    separatorOutput = fgCode + separator + '\x1b[39m';
                } else {
                    separatorOutput = separator;
                }
            }

            result += separatorOutput;

            if (shouldBold || shouldDim) {
                result += '\x1b[22m';
            }
            localSeparatorIndex++;
        }
    }

    if (widgetElements.length > 0) {
        const lastWidgetIndex = widgetElements.length - 1;
        const lastWidget = widgetElements[lastWidgetIndex];
        const lastWidgetBold = (settings.globalBold) || lastWidget?.widget.bold;
        const lastWidgetDim = lastWidget?.widget.dim === true;
        const lastSegmentOffset = segmentOffsetByRenderedIndex.get(lastWidgetIndex) ?? 0;
        const lastWidgetHasFlexAfter = (flexAfterIndex.get(lastWidgetIndex) ?? 0) > 0;
        const segmentEndCap = getEndCap(lastSegmentOffset);

        if (segmentEndCap && !lastWidgetHasFlexAfter) {
            if (lastWidget?.bgColor) {
                const capFg = bgToFg(lastWidget.bgColor);
                const fgCode = getColorAnsiCode(capFg, colorLevel, false);
                result += fgCode + segmentEndCap + '\x1b[39m';
            } else {
                result += segmentEndCap;
            }

            if (lastWidgetBold || lastWidgetDim) {
                result += '\x1b[22m';
            }
        }
    }

    if (totalFlexCount > 0) {
        if (terminalWidth && terminalWidth > 0) {
            const parts = result.split(FLEX_SENTINEL);
            const totalContentWidth = parts.reduce((sum, p) => sum + getVisibleWidth(p), 0);
            const flexCount = parts.length - 1;
            const totalSpace = Math.max(0, terminalWidth - totalContentWidth);
            const spacePerFlex = flexCount > 0 ? Math.floor(totalSpace / flexCount) : 0;
            const extraSpace = flexCount > 0 ? totalSpace % flexCount : 0;
            let newResult = parts[0] ?? '';
            for (let i = 1; i < parts.length; i++) {
                const flexSize = spacePerFlex + (i - 1 < extraSpace ? 1 : 0);
                newResult += ' '.repeat(flexSize) + (parts[i] ?? '');
            }
            result = newResult;
        } else {
            result = result.split(FLEX_SENTINEL).join(' ');
        }
    }

    result += chalk.reset('');

    if (terminalWidth && terminalWidth > 0) {
        const plainLength = getVisibleWidth(result);
        if (plainLength > terminalWidth) {
            result = truncateStyledText(result, terminalWidth, { ellipsis: true });
        }
    }

    return result;
}

function formatSeparator(sep: string): string {
    if (sep === '|') {
        return ' | ';
    } else if (sep === ' ') {
        return ' ';
    } else if (sep === ',') {
        return ', ';
    } else if (sep === '-') {
        return ' - ';
    }
    return sep;
}

function isSpacingSeparator(widget: WidgetItem | undefined, defaultSeparator: string | undefined): boolean {
    return widget?.type === 'separator'
        && (widget.character ?? defaultSeparator ?? '|').trim().length === 0;
}

export interface RenderResult {
    line: string;
    wasTruncated: boolean;
}

export interface PreRenderedWidget {
    content: string;
    plainLength: number;
    widget: WidgetItem;
}

export function countPowerlineStartCapSlots(
    widgets: WidgetItem[],
    preRenderedWidgets: PreRenderedWidget[]
): number {
    let pendingFlexAfterRenderedSegment = false;
    let hasRenderedSegment = false;
    let renderedSegmentCount = 0;

    for (let i = 0; i < widgets.length; i++) {
        const widget = widgets[i];
        if (!widget || widget.type === 'separator')
            continue;

        if (widget.type === 'flex-separator') {
            if (hasRenderedSegment) {
                pendingFlexAfterRenderedSegment = true;
            }
            continue;
        }

        if (!preRenderedWidgets[i]?.content)
            continue;

        if (!hasRenderedSegment) {
            hasRenderedSegment = true;
            renderedSegmentCount = 1;
        } else if (pendingFlexAfterRenderedSegment) {
            renderedSegmentCount++;
            pendingFlexAfterRenderedSegment = false;
        }
    }

    return renderedSegmentCount;
}

const DECORATIVE_WIDGET_TYPES = new Set(['custom-text', 'custom-symbol']);

function isSeparatorType(type: string): boolean {
    return type === 'separator' || type === 'flex-separator';
}

export function applyMergeTargetHiding(preRenderedLine: PreRenderedWidget[]): void {
    let chainStart = 0;
    for (let i = 0; i <= preRenderedLine.length; i++) {
        const element = preRenderedLine[i];
        if (element && !isSeparatorType(element.widget.type)) {
            continue;
        }

        applyMergeTargetHidingToSegment(preRenderedLine.slice(chainStart, i));
        chainStart = i + 1;
    }
}

function applyMergeTargetHidingToSegment(segment: PreRenderedWidget[]): void {
    let chainStart = 0;
    for (let i = 0; i < segment.length; i++) {
        const linksToNext = Boolean(segment[i]?.widget.merge) && i < segment.length - 1;
        if (linksToNext) {
            continue;
        }

        const chain = segment.slice(chainStart, i + 1);
        chainStart = i + 1;
        if (chain.length < 2) {
            continue;
        }

        for (let position = 0; position < chain.length; position++) {
            const element = chain[position];
            if (!element
                || !DECORATIVE_WIDGET_TYPES.has(element.widget.type)
                || !isHidden(element.widget, MERGE_TARGET_HIDDEN_HIDEABLE_STATE.key)) {
                continue;
            }

            const target = chain.slice(position + 1).find(candidate => !DECORATIVE_WIDGET_TYPES.has(candidate.widget.type))
                ?? chain.slice(0, position).reverse().find(candidate => !DECORATIVE_WIDGET_TYPES.has(candidate.widget.type));

            if (target?.content === '') {
                element.content = '';
                element.plainLength = 0;
            }
        }
    }
}

export function preRenderAllWidgets(
    allLinesWidgets: WidgetItem[][],
    settings: Settings,
    context: RenderContext
): PreRenderedWidget[][] {
    const preRenderedLines: PreRenderedWidget[][] = [];

    for (const lineWidgets of allLinesWidgets) {
        const preRenderedLine: PreRenderedWidget[] = [];

        for (const widget of lineWidgets) {
            if (widget.type === 'separator' || widget.type === 'flex-separator') {
                preRenderedLine.push({
                    content: '',
                    plainLength: 0,
                    widget
                });
                continue;
            }

            const widgetImpl = getWidget(widget.type);
            if (!widgetImpl) {
                preRenderedLine.push({
                    content: '',
                    plainLength: 0,
                    widget
                });
                continue;
            }

            const effectiveWidget = context.minimalist ? { ...widget, rawValue: true } : widget;
            const widgetText = widgetImpl.render(effectiveWidget, context, settings) ?? '';

            const plainLength = getVisibleWidth(widgetText);
            preRenderedLine.push({
                content: widgetText,
                plainLength,
                widget
            });
        }

        applyMergeTargetHiding(preRenderedLine);
        preRenderedLines.push(preRenderedLine);
    }

    return preRenderedLines;
}

export function calculateMaxWidthsFromPreRendered(
    preRenderedLines: PreRenderedWidget[][],
    settings: Settings
): number[] {
    const maxWidths: number[] = [];
    const defaultPadding = settings.defaultPadding ?? '';
    const { leading: sideLeadingPadding, trailing: sideTrailingPadding } = resolvePaddingSides(defaultPadding, settings.defaultPaddingSide);
    const paddingPairLength = sideLeadingPadding.length + sideTrailingPadding.length;

    for (const preRenderedLine of preRenderedLines) {
        const isSeparatorBoundary = (entry: PreRenderedWidget | undefined): boolean => (
            entry?.widget.type === 'separator' || entry?.widget.type === 'flex-separator'
        );
        const hasNextRenderedWidgetBeforeSeparator = (originalIndex: number): boolean => {
            for (let j = originalIndex + 1; j < preRenderedLine.length; j++) {
                const nextEntry = preRenderedLine[j];
                if (!nextEntry)
                    continue;
                if (isSeparatorBoundary(nextEntry))
                    return false;
                if (nextEntry.content)
                    return true;
            }

            return false;
        };

        const renderedWidgets = preRenderedLine
            .map((entry, originalIndex) => ({
                ...entry,
                mergesWithNext: Boolean(entry.widget.merge && hasNextRenderedWidgetBeforeSeparator(originalIndex))
            }))
            .filter(entry => !isSeparatorBoundary(entry) && entry.content);

        let alignmentPos = 0;
        for (let i = 0; i < renderedWidgets.length; i++) {
            const widget = renderedWidgets[i];
            if (!widget)
                continue;

            if (widget.widget.excludeFromAutoAlign)
                break;

            let totalWidth = widget.plainLength + paddingPairLength;

            let j = i;
            while (j < renderedWidgets.length - 1 && renderedWidgets[j]?.mergesWithNext) {
                j++;
                const nextWidget = renderedWidgets[j];
                if (nextWidget) {
                    if (renderedWidgets[j - 1]?.widget.merge === 'no-padding') {
                        totalWidth += nextWidget.plainLength;
                    } else {
                        totalWidth += nextWidget.plainLength + paddingPairLength;
                    }
                }
            }

            const currentMax = maxWidths[alignmentPos];
            if (currentMax === undefined) {
                maxWidths[alignmentPos] = totalWidth;
            } else {
                maxWidths[alignmentPos] = Math.max(currentMax, totalWidth);
            }

            i = j;
            alignmentPos++;
        }
    }

    return maxWidths;
}

export function renderStatusLineWithInfo(
    widgets: WidgetItem[],
    settings: Settings,
    context: RenderContext,
    preRenderedWidgets: PreRenderedWidget[],
    preCalculatedMaxWidths: number[]
): RenderResult {
    const line = renderStatusLine(widgets, settings, context, preRenderedWidgets, preCalculatedMaxWidths);
    const wasTruncated = getVisibleText(line).includes('...');
    return { line, wasTruncated };
}

export function renderStatusLine(
    widgets: WidgetItem[],
    settings: Settings,
    context: RenderContext,
    preRenderedWidgets: PreRenderedWidget[],
    preCalculatedMaxWidths: number[]
): string {
    const colorLevel = getColorLevelString(settings.colorLevel);

    const powerlineSettings = settings.powerline as Record<string, unknown> | undefined;
    const isPowerlineMode = Boolean(powerlineSettings?.enabled);

    if (isPowerlineMode)
        return renderPowerlineStatusLine(
            widgets,
            settings,
            context,
            context.lineIndex ?? 0,
            context.globalSeparatorIndex ?? 0,
            context.globalPowerlineThemeIndex ?? 0,
            preRenderedWidgets,
            preCalculatedMaxWidths
        );

    const applyColorsWithOverride = (text: string, foregroundColor?: string, backgroundColor?: string, bold?: boolean, dim?: boolean | 'parens'): string => {
        let fgColor = foregroundColor;
        const fgOverride = settings.overrideForegroundColor;
        if (fgOverride && fgOverride !== 'none') {
            if (!isGradientSpec(fgOverride)) {
                fgColor = fgOverride;
            } else if (colorLevel !== 'ansi16') {
                fgColor = undefined;
            }
        }

        let bgColor = backgroundColor;
        if (settings.overrideBackgroundColor && settings.overrideBackgroundColor !== 'none') {
            bgColor = settings.overrideBackgroundColor;
        }

        const shouldBold = (settings.globalBold) || bold;
        return applyColors(text, fgColor, bgColor, shouldBold, colorLevel, dim);
    };

    const detectedWidth = context.terminalWidth ?? getTerminalWidth();

    const terminalWidth = resolveEffectiveTerminalWidth(detectedWidth, settings, context);

    const elements: { content: string; type: string; widget?: WidgetItem }[] = [];
    let hasFlexSeparator = false;

    for (let i = 0; i < widgets.length; i++) {
        const widget = widgets[i];
        if (!widget)
            continue;

        if (widget.type === 'separator') {
            let contentBeforeIndex: number | null = null;
            let replacesSpacingSeparator = false;
            let crossedEmptyWidget = false;
            for (let j = i - 1; j >= 0; j--) {
                const prevWidget = widgets[j];
                if (!prevWidget)
                    continue;
                if (prevWidget.type === 'separator') {
                    if (!isSpacingSeparator(prevWidget, settings.defaultSeparator))
                        break;
                    replacesSpacingSeparator = true;
                    continue;
                }
                if (prevWidget.type === 'flex-separator')
                    break;
                if (preRenderedWidgets[j]?.content) {
                    if (!prevWidget.merge || !crossedEmptyWidget)
                        contentBeforeIndex = j;
                    break;
                }
                crossedEmptyWidget = true;
            }
            if (contentBeforeIndex === null)
                continue;

            if (replacesSpacingSeparator) {
                while (isSpacingSeparator(elements[elements.length - 1]?.widget, settings.defaultSeparator)) {
                    elements.pop();
                }
            }

            const sepChar = widget.character ?? (settings.defaultSeparator ?? '|');
            const formattedSep = formatSeparator(sepChar);

            let separatorColor = widget.color ?? 'gray';
            let separatorBg = widget.backgroundColor;
            let separatorBold = widget.bold;
            let separatorDim = widget.dim;

            if (settings.inheritSeparatorColors && !widget.color && !widget.backgroundColor) {
                const prevWidget = widgets[contentBeforeIndex];
                if (prevWidget) {
                    let widgetColor = prevWidget.color;
                    if (!widgetColor) {
                        const widgetImpl = getWidget(prevWidget.type);
                        widgetColor = widgetImpl ? widgetImpl.getDefaultColor() : 'white';
                    }
                    separatorColor = widgetColor;
                    separatorBg = prevWidget.backgroundColor;
                    separatorBold = prevWidget.bold;
                    separatorDim = prevWidget.dim;
                }
            }

            elements.push({ content: applyColorsWithOverride(formattedSep, separatorColor, separatorBg, separatorBold, separatorDim), type: 'separator', widget });
            continue;
        }

        if (widget.type === 'flex-separator') {
            elements.push({ content: 'FLEX', type: 'flex-separator', widget });
            hasFlexSeparator = true;
            continue;
        }

        try {
            let widgetText: string | undefined;
            let defaultColor = 'white';

            const preRendered = preRenderedWidgets[i];
            if (preRendered?.content) {
                widgetText = preRendered.content;
                const widgetImpl = getWidget(widget.type);
                if (widgetImpl) {
                    defaultColor = widgetImpl.getDefaultColor();
                }
            }

            if (widgetText) {
                if (widgetPreservesColors(widget)) {
                    let finalOutput = widgetText;
                    if (widget.maxWidth && widget.maxWidth > 0) {
                        const plainLength = getVisibleWidth(widgetText);
                        if (plainLength > widget.maxWidth) {
                            finalOutput = truncateStyledText(widgetText, widget.maxWidth, { ellipsis: false });
                        }
                    }
                    if (hasForegroundOverride(settings)) {
                        finalOutput = stripSgrCodes(finalOutput);
                    }
                    elements.push({
                        content: applyColorsWithOverride(finalOutput, undefined, widget.backgroundColor, widget.bold, widget.dim),
                        type: widget.type,
                        widget
                    });
                } else {
                    elements.push({
                        content: applyColorsWithOverride(widgetText, widget.color ?? defaultColor, widget.backgroundColor, widget.bold, widget.dim),
                        type: widget.type,
                        widget
                    });
                }
            }
        } catch {
            continue;
        }
    }

    if (elements.length === 0)
        return '';

    while (elements.length > 0 && elements[elements.length - 1]?.type === 'separator') {
        elements.pop();
    }

    if (!terminalWidth) {
        for (let i = elements.length - 1; i >= 0; i--) {
            if (elements[i]?.type !== 'separator'
                || !isSpacingSeparator(elements[i]?.widget, settings.defaultSeparator)) {
                continue;
            }
            if (elements[i - 1]?.type === 'flex-separator' || elements[i + 1]?.type === 'flex-separator') {
                elements.splice(i, 1);
            }
        }
    }

    const finalElements: string[] = [];
    const padding = settings.defaultPadding ?? '';
    const { leading: sideLeadingPadding, trailing: sideTrailingPadding } = resolvePaddingSides(padding, settings.defaultPaddingSide);
    const defaultSep = settings.defaultSeparator ? formatSeparator(settings.defaultSeparator) : '';

    elements.forEach((elem, index) => {
        const prevElem = index > 0 ? elements[index - 1] : null;
        const shouldAddSeparator = defaultSep && index > 0
            && elem.type !== 'flex-separator'
            && prevElem?.type !== 'flex-separator'
            && !prevElem?.widget?.merge;

        if (shouldAddSeparator) {
            if (settings.inheritSeparatorColors && index > 0) {
                const prevElem = elements[index - 1];
                if (prevElem?.widget) {
                    let widgetColor = prevElem.widget.color;
                    if (!widgetColor && prevElem.widget.type !== 'separator' && prevElem.widget.type !== 'flex-separator') {
                        const widgetImpl = getWidget(prevElem.widget.type);
                        widgetColor = widgetImpl ? widgetImpl.getDefaultColor() : 'white';
                    }
                    const coloredSep = applyColorsWithOverride(defaultSep, widgetColor, prevElem.widget.backgroundColor, prevElem.widget.bold, prevElem.widget.dim);
                    finalElements.push(coloredSep);
                } else {
                    finalElements.push(defaultSep);
                }
            } else if ((settings.overrideBackgroundColor && settings.overrideBackgroundColor !== 'none')
                || (settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none')) {
                const coloredSep = applyColorsWithOverride(defaultSep, undefined, undefined);
                finalElements.push(coloredSep);
            } else {
                finalElements.push(defaultSep);
            }
        }

        if (elem.type === 'separator' || elem.type === 'flex-separator') {
            finalElements.push(elem.content);
        } else {
            const nextElem = index < elements.length - 1 ? elements[index + 1] : null;
            const omitLeadingPadding = prevElem?.widget?.merge === 'no-padding';
            const omitTrailingPadding = elem.widget?.merge === 'no-padding'
                && nextElem
                && nextElem.type !== 'separator'
                && nextElem.type !== 'flex-separator';

            const hasColorOverride = Boolean(settings.overrideBackgroundColor && settings.overrideBackgroundColor !== 'none')
                || Boolean(settings.overrideForegroundColor && settings.overrideForegroundColor !== 'none');

            if (padding && (elem.widget?.backgroundColor || hasColorOverride)) {
                const leadingPadding = omitLeadingPadding || !sideLeadingPadding ? '' : applyColorsWithOverride(sideLeadingPadding, undefined, elem.widget?.backgroundColor);
                const trailingPadding = omitTrailingPadding || !sideTrailingPadding ? '' : applyColorsWithOverride(sideTrailingPadding, undefined, elem.widget?.backgroundColor);
                const paddedContent = leadingPadding + elem.content + trailingPadding;
                finalElements.push(paddedContent);
            } else if (padding) {
                const leadingPadding = omitLeadingPadding || !sideLeadingPadding ? '' : chalk.reset(sideLeadingPadding);
                const trailingPadding = omitTrailingPadding || !sideTrailingPadding ? '' : chalk.reset(sideTrailingPadding);
                finalElements.push(leadingPadding + elem.content + trailingPadding);
            } else {
                finalElements.push(elem.content);
            }
        }
    });

    let statusLine: string;

    if (hasFlexSeparator && terminalWidth) {
        const parts: string[][] = [[]];
        let currentPart = 0;

        for (const elem of finalElements) {
            if (elem === 'FLEX') {
                currentPart++;
                parts[currentPart] = [];
            } else {
                parts[currentPart]?.push(elem);
            }
        }

        const partLengths = parts.map((part) => {
            const joined = part.join('');
            return getVisibleWidth(joined);
        });
        const totalContentLength = partLengths.reduce((sum, len) => sum + len, 0);

        const flexCount = parts.length - 1;
        const totalSpace = Math.max(0, terminalWidth - totalContentLength);
        const spacePerFlex = flexCount > 0 ? Math.floor(totalSpace / flexCount) : 0;
        const extraSpace = flexCount > 0 ? totalSpace % flexCount : 0;

        statusLine = '';
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part) {
                statusLine += part.join('');
            }
            if (i < parts.length - 1) {
                const spaces = spacePerFlex + (i < extraSpace ? 1 : 0);
                statusLine += ' '.repeat(spaces);
            }
        }
    } else {
        if (hasFlexSeparator && !terminalWidth) {
            statusLine = finalElements.map(e => e === 'FLEX' ? chalk.gray(' | ') : e).join('');
        } else {
            statusLine = finalElements.join('');
        }
    }

    const maxWidth = terminalWidth ?? detectedWidth;
    if (maxWidth && maxWidth > 0) {
        const plainLength = getVisibleWidth(statusLine);

        if (plainLength > maxWidth) {
            statusLine = truncateStyledText(statusLine, maxWidth, { ellipsis: true });
        }
    }

    statusLine = maybeApplyForegroundGradient(statusLine, settings, colorLevel);

    return statusLine;
}
