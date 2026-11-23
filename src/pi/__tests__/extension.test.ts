import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it
} from 'vitest';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { getVisibleWidth } from '../../utils/ansi';
import pistatusline from '../extension';

type Handler = (event: unknown, context: unknown) => unknown;
interface Footer { render(width: number): string[] }
type FooterFactory = (tui: unknown, theme: unknown, footerData: unknown) => Footer;

let agentDir: string;
let previousAgentDir: string | undefined;
let handlers: Map<string, Handler>;
let commands: Map<string, { handler: Handler }>;

beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pistatusline-extension-'));
    previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    handlers = new Map();
    commands = new Map();
    pistatusline({
        on: (event: string, handler: Handler) => { handlers.set(event, handler); },
        registerCommand: (name: string, command: { handler: Handler }) => { commands.set(name, command); },
        getThinkingLevel: () => 'high'
    } as unknown as ExtensionAPI);
});

afterEach(() => {
    handlers.get('session_shutdown')?.({}, undefined);
    if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
    } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    fs.rmSync(agentDir, { recursive: true, force: true });
});

function context(mode: string) {
    const footers: (FooterFactory | undefined)[] = [];
    const notices: [string, string][] = [];
    const value = {
        mode,
        cwd: agentDir,
        model: undefined,
        getContextUsage: () => undefined,
        sessionManager: {
            getEntries: () => [],
            getBranch: () => [],
            getHeader: () => undefined,
            getSessionId: () => 's1',
            getSessionName: () => undefined
        },
        modelRegistry: {
            getApiKeyForProvider: () => Promise.resolve(undefined),
            getProviderAuth: () => Promise.resolve(undefined)
        },
        ui: {
            setFooter: (factory: FooterFactory | undefined) => { footers.push(factory); },
            notify: (message: string, level: string) => { notices.push([level, message]); }
        }
    };
    return { value, footers, notices };
}

function mountFooter(factory: FooterFactory | undefined, statuses: Map<string, string>): Footer {
    if (!factory) {
        throw new Error('no footer installed');
    }
    return factory(
        { requestRender: () => undefined },
        { fg: (_color: string, text: string) => text },
        { getExtensionStatuses: () => statuses }
    );
}

describe('pistatusline extension', () => {
    it('installs a footer that shows other extensions\' statuses when a TUI session starts', () => {
        const ctx = context('tui');
        handlers.get('session_start')?.({}, ctx.value);

        expect(ctx.footers).toHaveLength(1);
        const footer = mountFooter(ctx.footers[0], new Map([['b', 'beta'], ['a', 'alpha']]));
        expect(footer.render(80)).toEqual(['alpha · beta']);
    });

    it('never hands pi a line wider than the footer', () => {
        const ctx = context('tui');
        handlers.get('session_start')?.({}, ctx.value);

        const footer = mountFooter(ctx.footers[0], new Map([['a', 'x'.repeat(50)], ['b', 'line one\nline two that is long']]));
        const rows = footer.render(12);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(getVisibleWidth(row)).toBeLessThanOrEqual(12);
        }
    });

    it('leaves pi\'s footer alone outside the TUI', () => {
        const ctx = context('print');
        handlers.get('session_start')?.({}, ctx.value);

        expect(ctx.footers).toEqual([]);
    });

    it('keeps pi\'s footer while the status line is disabled', () => {
        fs.mkdirSync(path.join(agentDir, 'pistatusline'), { recursive: true });
        fs.writeFileSync(path.join(agentDir, 'pistatusline', 'state.json'), JSON.stringify({ enabled: false, refreshInterval: 10 }));
        const ctx = context('tui');
        handlers.get('session_start')?.({}, ctx.value);

        expect(ctx.footers).toEqual([]);
    });

    it('asks for the terminal UI when /pistatusline runs outside it', async () => {
        const ctx = context('rpc');
        await commands.get('pistatusline')?.handler('', ctx.value);

        expect(ctx.notices).toEqual([['warning', '/pistatusline needs the interactive terminal UI']]);
    });
});
