import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Mock } from 'vitest';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import type {
    RenderContext,
    StatusJSON,
    WidgetItem
} from '../../types';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import { loadClaudeSettingsSync } from '../../utils/claude-settings';
import { ThinkingEffortWidget } from '../ThinkingEffort';

// Mock claude-settings to avoid filesystem reads in tests
vi.mock('../../utils/claude-settings', () => ({ loadClaudeSettingsSync: vi.fn() }));

const mockedLoadSettings = loadClaudeSettingsSync as Mock;
const MODEL_WITH_HIGH_EFFORT = '<local-command-stdout>Set model to \u001b[1mopus (claude-opus-4-6)\u001b[22m with \u001b[1mhigh\u001b[22m effort</local-command-stdout>';
const MODEL_WITH_LOW_EFFORT = '<local-command-stdout>Set model to \u001b[1msonnet (claude-sonnet-4-5)\u001b[22m with \u001b[1mlow\u001b[22m effort</local-command-stdout>';
const MODEL_WITH_MAX_EFFORT = '<local-command-stdout>Set model to \u001b[1mopus (claude-opus-4-6)\u001b[22m with \u001b[1mmax\u001b[22m effort</local-command-stdout>';
const MODEL_WITH_XHIGH_EFFORT = '<local-command-stdout>Set model to \u001b[1mopus (claude-opus-4-7)\u001b[22m with \u001b[1mxhigh\u001b[22m effort</local-command-stdout>';
const MODEL_WITH_XHIGH_MIXED_CASE_EFFORT = '<local-command-stdout>Set model to \u001b[1mopus (claude-opus-4-7)\u001b[22m with \u001b[1mxHigh\u001b[22m effort</local-command-stdout>';
const MODEL_WITH_SUPER_MAX_EFFORT = '<local-command-stdout>Set model to \u001b[1mopus (claude-opus-4-8)\u001b[22m with \u001b[1msuper-max\u001b[22m effort</local-command-stdout>';
const MODEL_WITH_SUPER_MAX_MIXED_CASE_EFFORT = '<local-command-stdout>Set model to \u001b[1mopus (claude-opus-4-8)\u001b[22m with \u001b[1mSuper-Max\u001b[22m effort</local-command-stdout>';
const MODEL_WITHOUT_EFFORT = '<local-command-stdout>Set model to \u001b[1msonnet (claude-sonnet-4-5)\u001b[22m</local-command-stdout>';
const EFFORT_HIGH = '<local-command-stdout>Set effort level to \u001b[1mhigh\u001b[22m: Comprehensive implementation with extensive testing and documentation</local-command-stdout>';
const EFFORT_LOW = '<local-command-stdout>Set effort level to \u001b[1mlow\u001b[22m: Quick, minimal-effort response</local-command-stdout>';
const EFFORT_MEDIUM = '<local-command-stdout>Set effort level to \u001b[1mmedium\u001b[22m: Balanced response with good coverage</local-command-stdout>';
const EFFORT_MAX = '<local-command-stdout>Set effort level to \u001b[1mmax\u001b[22m (this session only): Maximum capability with deepest reasoning (Opus 4.6 only)</local-command-stdout>';

let tempDir: string;

function makeTranscriptEntry(content: string): string {
    return JSON.stringify({
        type: 'user',
        message: {
            role: 'user',
            content
        }
    });
}

function render(options: {
    transcriptPath?: string;
    fileContent?: string | null | undefined;
    rawValue?: boolean;
    isPreview?: boolean;
    statusData?: Partial<StatusJSON>;
    settingsValue?: unknown;
    transcriptThinkingEffort?: RenderContext['transcriptThinkingEffort'];
} = {}): string | null {
    const {
        transcriptPath = options.fileContent !== undefined ? path.join(tempDir, 'session.jsonl') : undefined,
        fileContent,
        rawValue = false,
        isPreview = false,
        statusData = {},
        settingsValue = {},
        transcriptThinkingEffort
    } = options;

    const widget = new ThinkingEffortWidget();
    const data: Partial<StatusJSON> = {
        ...statusData,
        ...(transcriptPath ? { transcript_path: transcriptPath } : {})
    };
    const context: RenderContext = {
        data: Object.keys(data).length > 0 ? data : undefined,
        isPreview,
        transcriptThinkingEffort
    };
    const item: WidgetItem = {
        id: 'thinking-effort',
        type: 'thinking-effort',
        rawValue
    };

    mockedLoadSettings.mockReturnValue(settingsValue);

    if (transcriptPath && fileContent !== undefined && fileContent !== null) {
        fs.writeFileSync(transcriptPath, fileContent, 'utf-8');
    }

    return widget.render(item, context, DEFAULT_SETTINGS);
}

describe('ThinkingEffortWidget', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-thinking-effort-'));
        mockedLoadSettings.mockReturnValue({});
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('metadata', () => {
        it('has correct display name', () => {
            const widget = new ThinkingEffortWidget();
            expect(widget.getDisplayName()).toBe('Thinking Effort');
        });

        it('has correct category', () => {
            const widget = new ThinkingEffortWidget();
            expect(widget.getCategory()).toBe('Core');
        });

        it('supports raw value', () => {
            const widget = new ThinkingEffortWidget();
            expect(widget.supportsRawValue()).toBe(true);
        });

        it('supports colors', () => {
            const widget = new ThinkingEffortWidget();
            expect(widget.supportsColors({ type: 'thinking-effort' } as never)).toBe(true);
        });
    });

    describe('preview mode', () => {
        it('returns labelled preview', () => {
            const result = render({ isPreview: true });
            expect(result).toBe('Thinking: high');
        });

        it('returns raw preview', () => {
            const result = render({ isPreview: true, rawValue: true });
            expect(result).toBe('high');
        });
    });

    describe('status JSON source', () => {
        it('reads max effort from status JSON', () => {
            const result = render({ statusData: { effort: { level: 'max' } } });
            expect(result).toBe('Thinking: max');
        });

        it('returns raw status JSON effort when requested', () => {
            const result = render({
                rawValue: true,
                statusData: { effort: { level: 'max' } }
            });
            expect(result).toBe('max');
        });

        it('prefers status JSON effort over transcript and settings fallbacks', () => {
            const result = render({
                fileContent: makeTranscriptEntry(MODEL_WITH_HIGH_EFFORT),
                settingsValue: { effortLevel: 'low' },
                statusData: { effort: { level: 'max' } }
            });
            expect(result).toBe('Thinking: max');
        });

        it('supports xhigh effort from status JSON', () => {
            const result = render({ statusData: { effort: { level: 'xhigh' } } });
            expect(result).toBe('Thinking: xhigh');
        });

        it('shows unknown-but-valid status JSON effort with trailing "?" marker', () => {
            const result = render({ statusData: { effort: { level: 'ultra' } } });
            expect(result).toBe('Thinking: ultra?');
        });

        it('treats null status JSON effort as explicit default', () => {
            const result = render({
                fileContent: makeTranscriptEntry(MODEL_WITH_HIGH_EFFORT),
                settingsValue: { effortLevel: 'low' },
                statusData: { effort: { level: null } }
            });
            expect(result).toBe('Thinking: default');
        });
    });

    describe('transcript source', () => {
        it('reads effort from the latest /model transcript stdout', () => {
            const result = render({
                fileContent: makeTranscriptEntry(MODEL_WITH_HIGH_EFFORT),
                settingsValue: { effortLevel: 'low' }
            });
            expect(result).toBe('Thinking: high');
        });

        it('returns raw transcript effort when requested', () => {
            const result = render({
                fileContent: makeTranscriptEntry(MODEL_WITH_LOW_EFFORT),
                rawValue: true
            });
            expect(result).toBe('low');
        });

        it('supports max effort from transcript output', () => {
            const result = render({ fileContent: makeTranscriptEntry(MODEL_WITH_MAX_EFFORT) });
            expect(result).toBe('Thinking: max');
        });

        it('supports xhigh effort from transcript output', () => {
            const result = render({ fileContent: makeTranscriptEntry(MODEL_WITH_XHIGH_EFFORT) });
            expect(result).toBe('Thinking: xhigh');
        });

        it('supports mixed-case xHigh effort from transcript output', () => {
            const result = render({ fileContent: makeTranscriptEntry(MODEL_WITH_XHIGH_MIXED_CASE_EFFORT) });
            expect(result).toBe('Thinking: xhigh');
        });

        it('shows unknown-but-valid effort with trailing "?" marker', () => {
            const result = render({ fileContent: makeTranscriptEntry(MODEL_WITH_SUPER_MAX_EFFORT) });
            expect(result).toBe('Thinking: super-max?');
        });

        it('lowercases and marks mixed-case unknown effort', () => {
            const result = render({ fileContent: makeTranscriptEntry(MODEL_WITH_SUPER_MAX_MIXED_CASE_EFFORT) });
            expect(result).toBe('Thinking: super-max?');
        });

        it('does not keep stale transcript effort when a newer /model output has no effort', () => {
            const result = render({
                fileContent: [
                    makeTranscriptEntry(MODEL_WITH_HIGH_EFFORT),
                    makeTranscriptEntry('<local-command-stdout>Bye!</local-command-stdout>'),
                    makeTranscriptEntry(MODEL_WITHOUT_EFFORT)
                ].join('\n'),
                settingsValue: { effortLevel: 'medium' }
            });
            // pistatusline: Claude Code's settings.json effortLevel is not a fallback in pi.
            expect(result).toBe('Thinking: default');
        });

        it('uses effort precomputed by the shared transcript analysis', () => {
            const result = render({
                transcriptPath: path.join(tempDir, 'missing.jsonl'),
                transcriptThinkingEffort: { value: 'high', known: true },
                settingsValue: { effortLevel: 'low' }
            });

            expect(result).toBe('Thinking: high');
        });
    });

    describe('/effort command source', () => {
        it('reads effort from /effort transcript stdout', () => {
            const result = render({ fileContent: makeTranscriptEntry(EFFORT_HIGH) });
            expect(result).toBe('Thinking: high');
        });

        it('supports low effort from /effort command', () => {
            const result = render({ fileContent: makeTranscriptEntry(EFFORT_LOW) });
            expect(result).toBe('Thinking: low');
        });

        it('supports medium effort from /effort command', () => {
            const result = render({ fileContent: makeTranscriptEntry(EFFORT_MEDIUM) });
            expect(result).toBe('Thinking: medium');
        });

        it('supports max effort from /effort command', () => {
            const result = render({ fileContent: makeTranscriptEntry(EFFORT_MAX) });
            expect(result).toBe('Thinking: max');
        });

        it('returns raw effort from /effort command', () => {
            const result = render({ fileContent: makeTranscriptEntry(EFFORT_HIGH), rawValue: true });
            expect(result).toBe('high');
        });

        it('/effort overrides earlier /model when it is newer', () => {
            const result = render({
                fileContent: [
                    makeTranscriptEntry(MODEL_WITH_LOW_EFFORT),
                    makeTranscriptEntry(EFFORT_MAX)
                ].join('\n')
            });
            expect(result).toBe('Thinking: max');
        });

        it('/model overrides earlier /effort when it is newer', () => {
            const result = render({
                fileContent: [
                    makeTranscriptEntry(EFFORT_MAX),
                    makeTranscriptEntry(MODEL_WITH_LOW_EFFORT)
                ].join('\n')
            });
            expect(result).toBe('Thinking: low');
        });

        it('/effort overrides settings fallback', () => {
            const result = render({
                fileContent: makeTranscriptEntry(EFFORT_HIGH),
                settingsValue: { effortLevel: 'low' }
            });
            expect(result).toBe('Thinking: high');
        });
    });

});
