import chalk from 'chalk';
import {
    Box,
    Text,
    render,
    useApp,
    useInput
} from 'ink';
import Gradient from 'ink-gradient';
import React, {
    useCallback,
    useEffect,
    useState
} from 'react';

import type { Settings } from '../types/Settings';
import type { WidgetItem } from '../types/Widget';
import { cloneSettings } from '../utils/clone-settings';
import {
    applyImport,
    exportConfig,
    getConfigLoadError,
    getConfigPath,
    isCustomConfigPath,
    loadSettings,
    saveSettings,
    validateImportFile,
    type ImportValidationResult
} from '../utils/config';
import { openExternalUrl } from '../utils/open-url';
import {
    checkPowerlineFonts,
    checkPowerlineFontsAsync,
    installPowerlineFonts,
    type PowerlineFontStatus
} from '../utils/powerline';
import { getPackageVersion } from '../utils/terminal';

import {
    ColorMenu,
    ConfirmDialog,
    ExportConfigDialog,
    GlobalOverridesMenu,
    ImportConfigDialog,
    ImportPreviewDialog,
    ItemsEditor,
    LineSelector,
    MainMenu,
    PowerlineSetup,
    RefreshIntervalMenu,
    StatusLinePreview,
    TerminalOptionsMenu,
    TerminalWidthMenu,
    type MainMenuOption
} from './components';
import {
    List,
    type ListEntry
} from './components/List';

const GITHUB_REPO_URL = 'https://github.com/sirmalloc/ccstatusline';

// pistatusline: pi owns what ccstatusline keeps in Claude Code's settings.json — whether the
// statusline is active and how often it refreshes.
export interface PiStatuslineHost {
    isEnabled(): boolean;
    setEnabled(enabled: boolean): Promise<void>;
    getRefreshInterval(): number | null;
    setRefreshInterval(seconds: number | null): Promise<void>;
}

interface FlashMessage {
    text: string;
    color: 'green' | 'red' | 'yellow';
}

type AppScreen = 'main'
    | 'lines'
    | 'items'
    | 'colorLines'
    | 'colors'
    | 'terminalWidth'
    | 'terminalConfig'
    | 'globalOverrides'
    | 'confirm'
    | 'powerline'
    | 'flowNotice'
    | 'refreshInterval'
    | 'exportConfig'
    | 'importConfig'
    | 'importPreview';

export interface ConfirmDialogState {
    message: string;
    action: () => Promise<void>;
    cancelScreen?: Exclude<AppScreen, 'confirm'>;
}

interface FlowNoticeState {
    title: string;
    message: string;
    color: 'green' | 'red' | 'yellow';
    continueScreen: Exclude<AppScreen, 'confirm' | 'flowNotice'>;
}

type FlowNoticeProps = FlowNoticeState & { onContinue: () => void };

const NOTICE_ITEMS: ListEntry<string>[] = [
    {
        label: 'Continue',
        value: 'continue'
    }
];

const FlowNotice: React.FC<FlowNoticeProps> = ({
    title,
    message,
    color,
    onContinue
}) => {
    useInput((_, key) => {
        if (key.escape) {
            onContinue();
        }
    });

    return (
        <Box flexDirection='column'>
            <Text bold>{title}</Text>
            <Box marginTop={1}>
                <Text color={color} wrap='wrap'>{message}</Text>
            </Box>
            <List
                marginTop={1}
                items={NOTICE_ITEMS}
                onSelect={() => { onContinue(); }}
                color='cyan'
            />
        </Box>
    );
};

export function getConfirmCancelScreen(confirmDialog: ConfirmDialogState | null): Exclude<AppScreen, 'confirm'> {
    return confirmDialog?.cancelScreen ?? 'main';
}

export function applyTuiImport(
    current: Settings,
    imported: Settings,
    mode: 'replace' | 'merge',
    presentKeys: readonly (keyof Settings)[]
): Settings {
    const nextSettings = applyImport(current, imported, mode, presentKeys);
    chalk.level = nextSettings.colorLevel;
    return nextSettings;
}

export function buildConfigLoadWarning(configLoadError: string | null): string | null {
    if (!configLoadError) {
        return null;
    }

    return `⚠ ${configLoadError} — showing defaults; saving here overwrites the file.`;
}

export function buildInvalidConfigSaveConfirm(
    configLoadError: string | null,
    onConfirm: () => void
): ConfirmDialogState | null {
    if (!configLoadError) {
        return null;
    }

    return {
        message: `${configLoadError} and is preserved on disk. Saving replaces it with the current configuration. Continue?`,
        action: () => {
            onConfirm();
            return Promise.resolve();
        },
        cancelScreen: 'main'
    };
}

export const App: React.FC<{ host: PiStatuslineHost }> = ({ host }) => {
    const { exit } = useApp();
    const [settings, setSettings] = useState<Settings | null>(null);
    const [originalSettings, setOriginalSettings] = useState<Settings | null>(null);
    const [hasChanges, setHasChanges] = useState(false);
    const [configLoadError, setConfigLoadError] = useState<string | null>(null);
    const [screen, setScreen] = useState<AppScreen>('main');
    const [selectedLine, setSelectedLine] = useState(0);
    const [menuSelections, setMenuSelections] = useState<Record<string, number>>({});
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const [isClaudeInstalled, setIsClaudeInstalled] = useState(() => host.isEnabled());
    const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns || 80);
    const [powerlineFontStatus, setPowerlineFontStatus] = useState<PowerlineFontStatus>({ installed: false });
    const [installingFonts, setInstallingFonts] = useState(false);
    const [fontInstallMessage, setFontInstallMessage] = useState<string | null>(null);
    const [flashMessage, setFlashMessage] = useState<FlashMessage | null>(null);
    const [previewIsTruncated, setPreviewIsTruncated] = useState(false);
    const [currentRefreshInterval, setCurrentRefreshInterval] = useState<number | null>(() => host.getRefreshInterval());
    const [flowNotice, setFlowNotice] = useState<FlowNoticeState | null>(null);
    const [importValidation, setImportValidation] = useState<ImportValidationResult | null>(null);

    useEffect(() => {
                void loadSettings().then((loadedSettings) => {
            // Set global chalk level based on settings (default to 256 colors for compatibility)
            chalk.level = loadedSettings.colorLevel;
            setSettings(loadedSettings);
            setOriginalSettings(cloneSettings(loadedSettings));
            // Capture why settings.json was rejected (if at all) so the TUI can warn and
            // guard saves. Read it here, in the load callback: the module-scoped signal is
            // reset by any later loadSettings/saveInstallationMetadata call.
            setConfigLoadError(getConfigLoadError());
        });
                // Check for Powerline fonts on startup (use sync version that doesn't call execSync)
        const fontStatus = checkPowerlineFonts();
        setPowerlineFontStatus(fontStatus);

        // Optionally do the async check later (but not blocking React)
        void checkPowerlineFontsAsync().then((asyncStatus) => {
            setPowerlineFontStatus(asyncStatus);
        });

        const handleResize = () => {
            setTerminalWidth(process.stdout.columns || 80);
        };

        process.stdout.on('resize', handleResize);
        return () => {
            process.stdout.off('resize', handleResize);
        };
    }, []);

    // Check for changes whenever settings update
    useEffect(() => {
        if (originalSettings) {
            const hasAnyChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);
            setHasChanges(hasAnyChanges);
        }
    }, [settings, originalSettings]);

    // Clear header message after 2 seconds
    useEffect(() => {
        if (flashMessage) {
            const timer = setTimeout(() => {
                setFlashMessage(null);
            }, 2000);
            return () => { clearTimeout(timer); };
        }
    }, [flashMessage]);

    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            exit();
        }
        // Global save shortcut
        if (key.ctrl && input === 's' && settings && screen !== 'confirm') {
            const performSave = () => {
                void (async () => {
                    try {
                        await saveSettings(settings);
                        setOriginalSettings(cloneSettings(settings));
                        setHasChanges(false);
                        // File is valid again after an explicit save → clear the banner + guard.
                        setConfigLoadError(null);
                        setFlashMessage({
                            text: '✓ Configuration saved',
                            color: 'green'
                        });
                    } catch {
                        setFlashMessage({
                            text: '✗ Could not save configuration',
                            color: 'red'
                        });
                    }
                })();
            };

            const saveGuard = buildInvalidConfigSaveConfirm(configLoadError, () => {
                // The confirm dialog doesn't self-dismiss; its action must navigate away
                // (matching the other confirm flows in this file). Return to the main menu
                // before saving so the success flash isn't hidden behind the dialog.
                setConfirmDialog(null);
                setScreen('main');
                performSave();
            });
            if (saveGuard) {
                setConfirmDialog(saveGuard);
                setScreen('confirm');
            } else {
                performSave();
            }
        }
    });

    const handleExportConfig = useCallback(async (filePath: string) => {
        try {
            if (!settings) {
                return;
            }
            await exportConfig(settings, filePath);
            setFlashMessage({ text: `Config exported to ${filePath}`, color: 'green' });
        } catch (err) {
            setFlowNotice({
                title: 'Export Failed',
                message: err instanceof Error ? err.message : String(err),
                color: 'red',
                continueScreen: 'main'
            });
            setScreen('flowNotice');
            return;
        }
        setScreen('main');
    }, [settings]);

    const handleImportFileChosen = useCallback(async (filePath: string) => {
        const result = await validateImportFile(filePath);
        if (result.status === 'invalid') {
            setFlowNotice({
                title: 'Import Failed',
                message: result.reason,
                color: 'red',
                continueScreen: 'main'
            });
            setScreen('flowNotice');
        } else {
            setImportValidation(result);
            setScreen('importPreview');
        }
    }, []);

    const handleImportApply = useCallback((mode: 'replace' | 'merge') => {
        if (!settings || importValidation?.status !== 'valid') {
            return;
        }
        const importedSettings = applyTuiImport(
            settings,
            importValidation.data,
            mode,
            importValidation.presentKeys
        );
        setSettings(importedSettings);
        setHasChanges(true);
        setImportValidation(null);
        setFlashMessage({ text: 'Config imported — review and save', color: 'green' });
        setScreen('main');
    }, [importValidation, settings]);

    if (!settings) {
        return <Text>Loading settings...</Text>;
    }

    const runningVersion = getPackageVersion();
    const handleInstallUninstall = () => {
        const next = !isClaudeInstalled;
        void host.setEnabled(next)
            .then(() => {
                setIsClaudeInstalled(next);
                setFlashMessage({
                    text: next ? '✓ Enabled in pi' : '✓ Disabled in pi',
                    color: 'green'
                });
            })
            .catch(() => {
                setFlashMessage({
                    text: '✗ Could not update pi statusline state',
                    color: 'red'
                });
            });
    };

    const handleMainMenuSelect = async (value: MainMenuOption) => {
        switch (value) {
            case 'lines':
                setScreen('lines');
                break;
            case 'colors':
                setScreen('colorLines');
                break;
            case 'terminalConfig':
                setScreen('terminalConfig');
                break;
            case 'globalOverrides':
                setScreen('globalOverrides');
                break;
            case 'powerline':
                setScreen('powerline');
                break;
            case 'install':
                handleInstallUninstall();
                break;
            case 'configureStatusLine':
                setScreen('refreshInterval');
                break;
            case 'exportConfig':
                setScreen('exportConfig');
                break;
            case 'importConfig':
                setScreen('importConfig');
                break;
            case 'starGithub':
                setConfirmDialog({
                    message: `Open the ccstatusline GitHub repository in your browser?\n\n${GITHUB_REPO_URL}`,
                    action: () => {
                        const result = openExternalUrl(GITHUB_REPO_URL);
                        if (result.success) {
                            setFlashMessage({
                                text: '✓ Opened GitHub repository in browser',
                                color: 'green'
                            });
                        } else {
                            setFlashMessage({
                                text: `✗ Could not open browser. Visit: ${GITHUB_REPO_URL}`,
                                color: 'red'
                            });
                        }
                        setScreen('main');
                        setConfirmDialog(null);
                        return Promise.resolve();
                    }
                });
                setScreen('confirm');
                break;
            case 'save': {
                const saveAndExit = async () => {
                    try {
                        await saveSettings(settings);
                        setOriginalSettings(cloneSettings(settings));
                        setHasChanges(false);
                        exit();
                    } catch {
                        setFlashMessage({
                            text: '✗ Could not save configuration',
                            color: 'red'
                        });
                    }
                };

                // Save & Exit is the second explicit-save route (besides Ctrl+S); guard it
                // the same way so an invalid settings.json isn't overwritten without consent.
                const saveGuard = buildInvalidConfigSaveConfirm(configLoadError, () => {
                    setConfirmDialog(null);
                    setScreen('main');
                    void saveAndExit();
                });
                if (saveGuard) {
                    setConfirmDialog(saveGuard);
                    setScreen('confirm');
                } else {
                    await saveAndExit();
                }
                break;
            }
            case 'exit':
                exit();
                break;
        }
    };

    const updateLine = (lineIndex: number, widgets: WidgetItem[]) => {
        const newLines = [...settings.lines];
        newLines[lineIndex] = widgets;
        setSettings({ ...settings, lines: newLines });
    };

    const updateLines = (newLines: WidgetItem[][]) => {
        setSettings({ ...settings, lines: newLines });
    };

    const handleLineSelect = (lineIndex: number) => {
        setSelectedLine(lineIndex);
        setScreen('items');
    };

    const configWarning = buildConfigLoadWarning(configLoadError);

    return (
        <Box flexDirection='column'>
            <Box marginBottom={1}>
                <Text bold>
                    <Gradient name='retro'>
                        PiStatusline Configuration
                    </Gradient>
                </Text>
                <Text bold>
                    {` | ${runningVersion && `v${runningVersion}`}`}
                </Text>
                {flashMessage && (
                    <Text color={flashMessage.color} bold>
                        {`  ${flashMessage.text}`}
                    </Text>
                )}
            </Box>
            {configWarning && (
                <Text color='red' wrap='wrap'>{configWarning}</Text>
            )}
            {isCustomConfigPath() && (
                <Text dimColor>{`Config: ${getConfigPath()}`}</Text>
            )}

            <StatusLinePreview
                lines={settings.lines}
                terminalWidth={terminalWidth}
                settings={settings}
                onTruncationChange={setPreviewIsTruncated}
            />

            <Box marginTop={1}>
                {screen === 'main' && (
                    <MainMenu
                        onSelect={(value, index) => {
                            // Only persist menu selection if not exiting
                            if (value !== 'save' && value !== 'exit') {
                                setMenuSelections(prev => ({ ...prev, main: index }));
                            }

                            void handleMainMenuSelect(value);
                        }}
                        isClaudeInstalled={isClaudeInstalled}
                        hasChanges={hasChanges}
                        initialSelection={menuSelections.main}
                        powerlineFontStatus={powerlineFontStatus}
                        settings={settings}
                        previewIsTruncated={previewIsTruncated}
                    />
                )}
                {screen === 'lines' && (
                    <LineSelector
                        lines={settings.lines}
                        onSelect={(line) => {
                            setMenuSelections(prev => ({ ...prev, lines: line }));
                            handleLineSelect(line);
                        }}
                        onLinesUpdate={updateLines}
                        onBack={() => {
                            // Save that we came from 'lines' menu (index 0)
                            // Clear the line selection so it resets next time we enter
                            setMenuSelections(prev => ({ ...prev, main: 0 }));
                            setScreen('main');
                        }}
                        initialSelection={menuSelections.lines}
                        title='Select Line to Edit Items'
                        allowEditing={true}
                    />
                )}
                {screen === 'items' && (
                    <ItemsEditor
                        widgets={settings.lines[selectedLine] ?? []}
                        onUpdate={(widgets) => { updateLine(selectedLine, widgets); }}
                        onBack={() => {
                            // When going back to lines menu, preserve which line was selected
                            setMenuSelections(prev => ({ ...prev, lines: selectedLine }));
                            setScreen('lines');
                        }}
                        lineNumber={selectedLine + 1}
                        settings={settings}
                    />
                )}
                {screen === 'colorLines' && (
                    <LineSelector
                        lines={settings.lines}
                        onLinesUpdate={updateLines}
                        onSelect={(line) => {
                            setMenuSelections(prev => ({ ...prev, lines: line }));
                            setSelectedLine(line);
                            setScreen('colors');
                        }}
                        onBack={() => {
                            // Save that we came from 'colors' menu (index 1)
                            setMenuSelections(prev => ({ ...prev, main: 1 }));
                            setScreen('main');
                        }}
                        initialSelection={menuSelections.lines}
                        title='Select Line to Edit Colors'
                        blockIfPowerlineActive={true}
                        settings={settings}
                        allowEditing={false}
                    />
                )}
                {screen === 'colors' && (
                    <ColorMenu
                        widgets={settings.lines[selectedLine] ?? []}
                        lineIndex={selectedLine}
                        settings={settings}
                        onUpdate={(updatedWidgets) => {
                            // Update only the selected line
                            const newLines = [...settings.lines];
                            newLines[selectedLine] = updatedWidgets;
                            setSettings({ ...settings, lines: newLines });
                        }}
                        onBack={() => {
                            // Go back to line selection for colors
                            setScreen('colorLines');
                        }}
                    />
                )}
                {screen === 'terminalConfig' && (
                    <TerminalOptionsMenu
                        settings={settings}
                        onUpdate={(updatedSettings) => {
                            setSettings(updatedSettings);
                        }}
                        onBack={(target?: string) => {
                            if (target === 'width') {
                                setScreen('terminalWidth');
                            } else {
                                // Save that we came from 'terminalConfig' menu (index 3)
                                setMenuSelections(prev => ({ ...prev, main: 3 }));
                                setScreen('main');
                            }
                        }}
                    />
                )}
                {screen === 'terminalWidth' && (
                    <TerminalWidthMenu
                        settings={settings}
                        onUpdate={(updatedSettings) => {
                            setSettings(updatedSettings);
                        }}
                        onBack={() => {
                            setScreen('terminalConfig');
                        }}
                    />
                )}
                {screen === 'globalOverrides' && (
                    <GlobalOverridesMenu
                        settings={settings}
                        onUpdate={(updatedSettings) => {
                            setSettings(updatedSettings);
                        }}
                        onBack={() => {
                            // Save that we came from 'globalOverrides' menu (index 4)
                            setMenuSelections(prev => ({ ...prev, main: 4 }));
                            setScreen('main');
                        }}
                    />
                )}
                {screen === 'confirm' && confirmDialog && (
                    <ConfirmDialog
                        message={confirmDialog.message}
                        onConfirm={() => void confirmDialog.action()}
                        onCancel={() => {
                            setScreen(getConfirmCancelScreen(confirmDialog));
                            setConfirmDialog(null);
                        }}
                    />
                )}
                {screen === 'flowNotice' && flowNotice && (
                    <FlowNotice
                        {...flowNotice}
                        onContinue={() => {
                            setScreen(flowNotice.continueScreen);
                            setFlowNotice(null);
                        }}
                    />
                )}
                {screen === 'refreshInterval' && (
                    <RefreshIntervalMenu
                        currentInterval={currentRefreshInterval}
                        supportsRefreshInterval={true}
                        gitCacheTtlSeconds={settings.gitCacheTtlSeconds}
                        terminalWidthCacheTtlSeconds={settings.terminalWidthCacheTtlSeconds}
                        customCommandCacheTtlSeconds={settings.customCommandCacheTtlSeconds}
                        onUpdate={(interval) => {
                            const previous = currentRefreshInterval;
                            setCurrentRefreshInterval(interval);
                            void host.setRefreshInterval(interval)
                                .then(() => {
                                    setFlashMessage({
                                        text: '✓ Refresh interval updated',
                                        color: 'green'
                                    });
                                })
                                .catch(() => {
                                    setCurrentRefreshInterval(previous);
                                    setFlashMessage({
                                        text: '✗ Failed to save refresh interval',
                                        color: 'red'
                                    });
                                });
                            setScreen('main');
                        }}
                        onGitCacheTtlUpdate={(ttlSeconds) => {
                            setSettings({
                                ...settings,
                                gitCacheTtlSeconds: ttlSeconds
                            });
                            setFlashMessage({
                                text: '✓ Git cache TTL updated',
                                color: 'green'
                            });
                            setScreen('main');
                        }}
                        onTerminalWidthCacheTtlUpdate={(ttlSeconds) => {
                            setSettings({
                                ...settings,
                                terminalWidthCacheTtlSeconds: ttlSeconds
                            });
                            setFlashMessage({
                                text: '✓ Terminal Width cache TTL updated',
                                color: 'green'
                            });
                            setScreen('main');
                        }}
                        onCustomCommandCacheTtlUpdate={(ttlSeconds) => {
                            setSettings({
                                ...settings,
                                customCommandCacheTtlSeconds: ttlSeconds
                            });
                            setFlashMessage({
                                text: '✓ Custom command cache TTL updated',
                                color: 'green'
                            });
                            setScreen('main');
                        }}
                        onBack={() => {
                            setScreen('main');
                        }}
                    />
                )}
                {screen === 'powerline' && (
                    <PowerlineSetup
                        settings={settings}
                        powerlineFontStatus={powerlineFontStatus}
                        onUpdate={(updatedSettings) => {
                            setSettings(updatedSettings);
                        }}
                        onBack={() => {
                            setScreen('main');
                        }}
                        onInstallFonts={() => {
                            setInstallingFonts(true);
                            // Add a small delay to allow React to render the "Installing..." message
                            // before the blocking execSync calls in installPowerlineFonts
                            setTimeout(() => {
                                void installPowerlineFonts().then((result) => {
                                    setInstallingFonts(false);
                                    setFontInstallMessage(result.message);
                                    // Refresh font status
                                    void checkPowerlineFontsAsync().then((asyncStatus) => {
                                        setPowerlineFontStatus(asyncStatus);
                                    });
                                });
                            }, 50);
                        }}
                        installingFonts={installingFonts}
                        fontInstallMessage={fontInstallMessage}
                        onClearMessage={() => { setFontInstallMessage(null); }}
                    />
                )}

                {screen === 'exportConfig' && (
                    <ExportConfigDialog
                        onExport={(filePath) => { void handleExportConfig(filePath); }}
                        onCancel={() => { setScreen('main'); }}
                    />
                )}

                {screen === 'importConfig' && (
                    <ImportConfigDialog
                        onFileChosen={(filePath) => { void handleImportFileChosen(filePath); }}
                        onCancel={() => { setScreen('main'); }}
                    />
                )}

                {screen === 'importPreview' && importValidation?.status === 'valid' && (
                    <ImportPreviewDialog
                        validation={importValidation}
                        currentSettings={settings}
                        onApply={(mode) => { handleImportApply(mode); }}
                        onCancel={() => {
                            setImportValidation(null);
                            setScreen('main');
                        }}
                    />
                )}
            </Box>
        </Box>
    );
};

export async function runTUI(host: PiStatuslineHost): Promise<void> {
    // Clear the terminal before starting the TUI
    process.stdout.write('\x1b[2J\x1b[H');
    // pistatusline: resolve on exit so pi can take the terminal back.
    await render(<App host={host} />).waitUntilExit();
}
