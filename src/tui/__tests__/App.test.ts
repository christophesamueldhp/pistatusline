import chalk from 'chalk';
import {
    describe,
    expect,
    it,
    vi
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../types/Settings';
import {
    applyTuiImport,
    buildConfigLoadWarning,
    buildInvalidConfigSaveConfirm,
    getConfirmCancelScreen
} from '../App';
import { buildMainMenuItems } from '../components/MainMenu';

function getMenuValues(isEnabled: boolean, hasChanges: boolean): string[] {
    return buildMainMenuItems(isEnabled, hasChanges)
        .map(item => item === '-' ? '-' : item.value);
}

describe('App confirm navigation helpers', () => {
    it('defaults confirmation cancel navigation to the main menu', () => {
        expect(getConfirmCancelScreen(null)).toBe('main');
        expect(getConfirmCancelScreen({
            message: 'Confirm?',
            action: () => Promise.resolve()
        })).toBe('main');
    });
});

describe('Main menu structure (pi)', () => {
    it('keeps the ccstatusline layout with the pi enable/disable item', () => {
        const expected = [
            'lines',
            'colors',
            'powerline',
            '-',
            'terminalConfig',
            'globalOverrides',
            'configureStatusLine',
            '-',
            'exportConfig',
            'importConfig',
            '-',
            'install',
            '-',
            'exit',
            '-',
            'starGithub'
        ];
        expect(getMenuValues(true, false)).toEqual(expected);
        expect(getMenuValues(false, false)).toEqual(expected);
    });

    it('labels the install item for pi and never disables Configure Status Line', () => {
        const find = (enabled: boolean, value: string) => buildMainMenuItems(enabled, false)
            .find(item => item !== '-' && item.value === value);

        expect(find(false, 'install')).toEqual(expect.objectContaining({ label: '📦 Enable in pi' }));
        expect(find(true, 'install')).toEqual(expect.objectContaining({ label: '🔌 Disable in pi' }));
        expect(find(false, 'configureStatusLine')).not.toEqual(expect.objectContaining({ disabled: true }));
    });
});

describe('TUI config imports', () => {
    it('synchronizes Chalk with the imported color level', () => {
        const originalLevel = chalk.level;

        try {
            const imported = applyTuiImport(
                { ...DEFAULT_SETTINGS, colorLevel: 2 },
                { ...DEFAULT_SETTINGS, colorLevel: 0 },
                'merge',
                ['colorLevel']
            );

            expect(imported.colorLevel).toBe(0);
            expect(chalk.level).toBe(0);
        } finally {
            chalk.level = originalLevel;
        }
    });
});


describe('Invalid-config TUI guards', () => {
    it('returns null when there is no config load error', () => {
        expect(buildConfigLoadWarning(null)).toBeNull();
        expect(buildInvalidConfigSaveConfirm(null, vi.fn())).toBeNull();
    });

    it('builds a banner that names the reason and warns about overwriting', () => {
        const warning = buildConfigLoadWarning('settings.json is not valid JSON');
        expect(warning).toContain('settings.json is not valid JSON');
        expect(warning).toContain('overwrites the file');
    });

    it('builds a save-guard confirm dialog that returns to main on cancel', () => {
        const guard = buildInvalidConfigSaveConfirm('settings.json could not be read', vi.fn());
        expect(guard).not.toBeNull();
        expect(guard?.cancelScreen).toBe('main');
        expect(guard?.message).toContain('preserved');
        expect(guard?.message).toContain('could not be read');
    });

    it('invokes the provided onConfirm when the guard action runs', async () => {
        const onConfirm = vi.fn();
        const guard = buildInvalidConfigSaveConfirm('settings.json is not valid JSON', onConfirm);
        await guard?.action();
        expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('reflects the specific load-error reason in the save-guard message', () => {
        expect(buildInvalidConfigSaveConfirm('settings.json is not valid JSON', vi.fn())?.message)
            .toContain('settings.json is not valid JSON');
        expect(buildInvalidConfigSaveConfirm('settings.json is not in a valid format', vi.fn())?.message)
            .toContain('not in a valid format');
    });
});
