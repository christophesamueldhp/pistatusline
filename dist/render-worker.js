import { createRequire as __pistatuslineCreateRequire } from 'node:module';
import { fileURLToPath as __pistatuslineFileURLToPath } from 'node:url';
import { dirname as __pistatuslineDirname } from 'node:path';
const require = __pistatuslineCreateRequire(import.meta.url);
const __filename = __pistatuslineFileURLToPath(import.meta.url);
const __dirname = __pistatuslineDirname(__filename);
import {
  advanceGlobalPowerlineThemeIndex,
  advanceGlobalSeparatorIndex
} from "./chunks/chunk-GUDLJAZ2.js";
import {
  WEEKLY_MODEL_USAGE_BUCKETS,
  ZERO_COMPACTION_STATS,
  buildConfigWarningBadge,
  calculateMaxWidthsFromPreRendered,
  countPowerlineStartCapSlots,
  getConfigLoadError,
  getTranscriptAnalysisFromRecords,
  getVisibleText,
  getWidgetSpeedWindowSeconds,
  initConfigPath,
  isWidgetSpeedWindowEnabled,
  loadSettings,
  parseUsageApiResponse,
  preRenderAllWidgets,
  renderStatusLine,
  source_default,
  updateColorMap
} from "./chunks/chunk-HBCUGC77.js";
import {
  setGitReviewRefreshScript
} from "./chunks/chunk-O45YDVGT.js";
import "./chunks/chunk-LJD3VXDT.js";

// src/pi/render-worker.ts
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parentPort } from "node:worker_threads";

// src/utils/usage-prefetch.ts
var BASE_USAGE_WIDGET_TYPES = [
  "session-usage",
  "weekly-usage",
  "block-timer",
  "reset-timer",
  "weekly-reset-timer",
  "extra-usage-utilization",
  "extra-usage-remaining",
  "extra-usage-used"
];
var USAGE_WIDGET_TYPES = /* @__PURE__ */ new Set([
  ...BASE_USAGE_WIDGET_TYPES,
  ...WEEKLY_MODEL_USAGE_BUCKETS.map((bucket) => bucket.widgetType)
]);
var USAGE_DATA_FIELDS = [
  "sessionUsage",
  "sessionResetAt",
  "weeklyUsage",
  "weeklyResetAt",
  ...WEEKLY_MODEL_USAGE_BUCKETS.flatMap((bucket) => [bucket.usageField, bucket.resetField]),
  "extraUsageEnabled",
  "extraUsageLimit",
  "extraUsageUsed",
  "extraUsageUtilization",
  "extraUsageCurrency"
];
var USAGE_WIDGET_REQUIREMENTS = {
  "session-usage": [{ field: "sessionUsage" }],
  "weekly-usage": [{ field: "weeklyUsage" }],
  ...Object.fromEntries(WEEKLY_MODEL_USAGE_BUCKETS.map((bucket) => [bucket.widgetType, [{ field: bucket.usageField }]])),
  "block-timer": [{ field: "sessionResetAt", suppressFetchError: true }],
  "reset-timer": [{ field: "sessionResetAt", suppressFetchError: true }],
  "weekly-reset-timer": [{ field: "weeklyResetAt", suppressFetchError: true }],
  "extra-usage-utilization": [
    { field: "extraUsageEnabled" },
    { field: "extraUsageUtilization" }
  ],
  "extra-usage-remaining": [
    { field: "extraUsageEnabled" },
    { field: "extraUsageLimit" },
    { field: "extraUsageUsed" }
  ],
  "extra-usage-used": [
    { field: "extraUsageEnabled" },
    { field: "extraUsageUsed" }
  ]
};
var USAGE_CURSOR_REQUIREMENTS = {
  "session-usage": { field: "sessionResetAt" },
  "weekly-usage": { field: "weeklyResetAt" },
  ...Object.fromEntries(WEEKLY_MODEL_USAGE_BUCKETS.map((bucket) => [bucket.widgetType, { field: bucket.resetField, alternatives: ["weeklyResetAt"] }]))
};
function hasUsageDependentWidgets(lines) {
  return lines.some((line) => line.some((item) => USAGE_WIDGET_TYPES.has(item.type)));
}

// src/pi/render-core.ts
function resolvePlanUsage(usage) {
  if (usage?.anthropicJson === void 0) {
    return usage;
  }
  return parseUsageApiResponse(usage.anthropicJson) ?? { error: "parse-error" };
}
var SPEED_WIDGET_TYPES = /* @__PURE__ */ new Set(["output-speed", "input-speed", "total-speed"]);
async function renderLines(input) {
  const { settings, configError, status } = input;
  source_default.level = settings.colorLevel;
  updateColorMap();
  const lines = settings.lines;
  const has = (type) => lines.some((line) => line.some((item) => item.type === type));
  const hasSpeedItems = lines.some((line) => line.some((item) => SPEED_WIDGET_TYPES.has(item.type)));
  const hasCompactionWidget = has("compaction-counter");
  const requestedSpeedWindows = /* @__PURE__ */ new Set();
  for (const line of lines) {
    for (const item of line) {
      if (SPEED_WIDGET_TYPES.has(item.type) && isWidgetSpeedWindowEnabled(item)) {
        requestedSpeedWindows.add(getWidgetSpeedWindowSeconds(item));
      }
    }
  }
  const analysis = await getTranscriptAnalysisFromRecords(input.records, {
    includeSessionDuration: has("session-clock") && status.cost?.total_duration_ms === void 0,
    includeSpeedMetrics: hasSpeedItems,
    speedWindowSeconds: Array.from(requestedSpeedWindows),
    includeCompactionStats: hasCompactionWidget
  });
  const context = {
    data: status,
    tokenMetrics: analysis.tokenMetrics,
    speedMetrics: analysis.speedMetricsCollection?.sessionAverage ?? null,
    windowedSpeedMetrics: analysis.speedMetricsCollection?.windowed ?? null,
    usageData: hasUsageDependentWidgets(lines) ? resolvePlanUsage(input.usage) ?? { error: "no-credentials" } : null,
    claudeStatusData: null,
    sessionDuration: analysis.sessionDuration,
    transcriptSessionName: has("session-name") ? input.sessionName : void 0,
    skillsMetrics: null,
    compactionData: hasCompactionWidget ? analysis.compactionData ?? ZERO_COMPACTION_STATS : null,
    terminalWidth: input.width,
    isPreview: false,
    minimalist: settings.minimalistMode,
    gitCacheTtlSeconds: settings.gitCacheTtlSeconds,
    customCommandCacheTtlSeconds: settings.customCommandCacheTtlSeconds,
    gitReviewNeedsChecks: has("git-ci-status")
  };
  const preRenderedLines = preRenderAllWidgets(lines, settings, context);
  const preCalculatedMaxWidths = calculateMaxWidthsFromPreRendered(preRenderedLines, settings);
  const output = [];
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
    output.push(`\x1B[0m${line}\x1B[0m`);
    globalSeparatorIndex = advanceGlobalSeparatorIndex(globalSeparatorIndex, lineItems, preRenderedWidgets);
    if (settings.powerline.enabled) {
      globalPowerlineStartCapIndex += countPowerlineStartCapSlots(lineItems, preRenderedWidgets);
    }
    if (settings.powerline.enabled && settings.powerline.continueThemeAcrossLines) {
      globalPowerlineThemeIndex = advanceGlobalPowerlineThemeIndex(globalPowerlineThemeIndex, preRenderedWidgets);
    }
  }
  if (configError && !configBadgePrepended) {
    output.push(`\x1B[0m${buildConfigWarningBadge(settings.colorLevel)}`);
  }
  return output;
}

// src/pi/render-worker.ts
setGitReviewRefreshScript(path.join(path.dirname(fileURLToPath(import.meta.url)), "git-review-refresh.js"));
var silent = () => void 0;
console.log = silent;
console.error = silent;
console.warn = silent;
console.info = silent;
parentPort?.on("message", (request) => {
  void (async () => {
    let response;
    try {
      initConfigPath(request.configPath);
      const settings = await loadSettings();
      const lines = await renderLines({
        settings,
        configError: getConfigLoadError(),
        status: request.status,
        records: request.records,
        sessionName: request.sessionName,
        usage: request.usage,
        width: request.width
      });
      response = { id: request.id, lines, needsUsage: hasUsageDependentWidgets(settings.lines) };
    } catch (error) {
      response = { id: request.id, lines: [], needsUsage: false, error: error instanceof Error ? error.message : String(error) };
    }
    parentPort?.postMessage(response);
  })();
});
