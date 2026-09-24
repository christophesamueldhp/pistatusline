import chalk from 'chalk';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { StatusJSON } from '../types/StatusJSON';
import { getVisibleText } from '../utils/ansi';
import { updateColorMap } from '../utils/colors';
import { ZERO_COMPACTION_STATS } from '../utils/compaction';
import { getTranscriptAnalysisFromRecords } from '../utils/jsonl-metrics';
import { advanceGlobalPowerlineThemeIndex } from '../utils/powerline-theme-index';
import {
    buildConfigWarningBadge,
    calculateMaxWidthsFromPreRendered,
    countPowerlineStartCapSlots,
    preRenderAllWidgets,
    renderStatusLine
} from '../utils/renderer';
import { advanceGlobalSeparatorIndex } from '../utils/separator-index';
import {
    getWidgetSpeedWindowSeconds,
    isWidgetSpeedWindowEnabled
} from '../utils/speed-window';
import { parseUsageApiResponse } from '../utils/usage-fetch';
import { hasUsageDependentWidgets } from '../utils/usage-prefetch';
import type { UsageData } from '../utils/usage-types';

import type { PlanUsageData } from './usage';

export interface RenderInput {
    settings: Settings;
    configError: string | null;
    status: StatusJSON;
    /** pi session entries converted to Claude transcript records (see adapter.ts). */
    records: readonly unknown[];
    sessionName: string | null;
    /** Plan usage from the provider-neutral sources; null when no source has data. */
    usage: PlanUsageData | null;
    width: number;
}

export function resolvePlanUsage(usage: PlanUsageData | null): UsageData | null {
    if (usage?.anthropicJson === undefined) {
        return usage;
    }
    return parseUsageApiResponse(usage.anthropicJson) ?? { error: 'parse-error' };
}

const SPEED_WIDGET_TYPES = new Set(['output-speed', 'input-speed', 'total-speed']);

/**
 * ccstatusline's renderMultipleLines (src/ccstatusline.ts in upstream) minus its Claude Code
 * specifics: data comes from pi instead of stdin + transcript file, and lines are returned
 * instead of printed (no nbsp substitution — that works around VS Code, not pi).
 */
export async function renderLines(input: RenderInput): Promise<string[]> {
    const { settings, configError, status } = input;
    chalk.level = settings.colorLevel;
    updateColorMap();

    const lines = settings.lines;
    const has = (type: string) => lines.some(line => line.some(item => item.type === type));
    const hasSpeedItems = lines.some(line => line.some(item => SPEED_WIDGET_TYPES.has(item.type)));
    const hasCompactionWidget = has('compaction-counter');
    const requestedSpeedWindows = new Set<number>();
    for (const line of lines) {
        for (const item of line) {
            if (SPEED_WIDGET_TYPES.has(item.type) && isWidgetSpeedWindowEnabled(item)) {
                requestedSpeedWindows.add(getWidgetSpeedWindowSeconds(item));
            }
        }
    }

    const analysis = await getTranscriptAnalysisFromRecords(input.records, {
        includeSessionDuration: has('session-clock') && status.cost?.total_duration_ms === undefined,
        includeSpeedMetrics: hasSpeedItems,
        speedWindowSeconds: Array.from(requestedSpeedWindows),
        includeCompactionStats: hasCompactionWidget
    });

    const context: RenderContext = {
        data: status,
        tokenMetrics: analysis.tokenMetrics,
        speedMetrics: analysis.speedMetricsCollection?.sessionAverage ?? null,
        windowedSpeedMetrics: analysis.speedMetricsCollection?.windowed ?? null,
        usageData: hasUsageDependentWidgets(lines) ? (resolvePlanUsage(input.usage) ?? { error: 'no-credentials' }) : null,
        claudeStatusData: null,
        sessionDuration: analysis.sessionDuration,
        transcriptSessionName: has('session-name') ? input.sessionName : undefined,
        skillsMetrics: null,
        compactionData: hasCompactionWidget ? (analysis.compactionData ?? ZERO_COMPACTION_STATS) : null,
        terminalWidth: input.width,
        isPreview: false,
        minimalist: settings.minimalistMode,
        gitCacheTtlSeconds: settings.gitCacheTtlSeconds,
        customCommandCacheTtlSeconds: settings.customCommandCacheTtlSeconds,
        gitReviewNeedsChecks: has('git-ci-status')
    };

    const preRenderedLines = preRenderAllWidgets(lines, settings, context);
    const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);

    const output: string[] = [];
    let globalSeparatorIndex = 0;
    let globalPowerlineThemeIndex = 0;
    let globalPowerlineStartCapIndex = 0;
    let configBadgePrepended = false;
    for (let i = 0; i < lines.length; i++) {
        const lineItems = lines[i];
        if (!lineItems || lineItems.length === 0) {
            continue;
        }
        const preRenderedWidgets = preRenderedLines[i] ?? [];
        let line = renderStatusLine(lineItems, settings, {
            ...context,
            lineIndex: i,
            globalSeparatorIndex,
            globalPowerlineThemeIndex,
            globalPowerlineStartCapIndex
        }, preRenderedWidgets, preCalculatedMaxWidths);

        if (getVisibleText(line).trim().length === 0) {
            continue;
        }
        if (configError && !configBadgePrepended) {
            line = `${buildConfigWarningBadge(settings.colorLevel)} | ${line}`;
            configBadgePrepended = true;
        }
        output.push(`\x1b[0m${line}\x1b[0m`);

        globalSeparatorIndex = advanceGlobalSeparatorIndex(globalSeparatorIndex, lineItems, preRenderedWidgets);
        if (settings.powerline.enabled) {
            globalPowerlineStartCapIndex += countPowerlineStartCapSlots(lineItems, preRenderedWidgets);
        }
        if (settings.powerline.enabled && settings.powerline.continueThemeAcrossLines) {
            globalPowerlineThemeIndex = advanceGlobalPowerlineThemeIndex(globalPowerlineThemeIndex, preRenderedWidgets);
        }
    }

    if (configError && !configBadgePrepended) {
        output.push(`\x1b[0m${buildConfigWarningBadge(settings.colorLevel)}`);
    }
    return output;
}
