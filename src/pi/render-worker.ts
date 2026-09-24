import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parentPort } from 'node:worker_threads';

import {
    getConfigLoadError,
    initConfigPath,
    loadSettings
} from '../utils/config';
import { setGitReviewRefreshScript } from '../utils/git-review-cache';
import { hasUsageDependentWidgets } from '../utils/usage-prefetch';

import type {
    RenderRequest,
    RenderResponse
} from './protocol';
import { renderLines } from './render-core';

setGitReviewRefreshScript(path.join(path.dirname(fileURLToPath(import.meta.url)), 'git-review-refresh.js'));

// Claude Code runs ccstatusline as a separate process; this worker is pi's equivalent, so the
// widgets' synchronous git/jj/custom-command calls never block pi's input loop. Worker stdio is
// piped into pi's terminal, so ccstatusline's diagnostics must not reach it.
const silent = () => undefined;
console.log = silent;
console.error = silent;
console.warn = silent;
console.info = silent;

parentPort?.on('message', (request: RenderRequest) => {
    void (async () => {
        let response: RenderResponse;
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
