import {
    Box,
    Text
} from 'ink';
import React from 'react';

import type {
    InstallationMetadata,
    Settings
} from '../../types/Settings';
import { type PowerlineFontStatus } from '../../utils/powerline';

import { List } from './List';

export type MainMenuOption = 'lines'
    | 'colors'
    | 'powerline'
    | 'terminalConfig'
    | 'globalOverrides'
    | 'install'
    | 'manageInstallation'
    | 'checkUpdates'
    | 'configureStatusLine'
    | 'exportConfig'
    | 'importConfig'
    | 'starGithub'
    | 'save'
    | 'exit';

export interface MainMenuProps {
    onSelect: (value: MainMenuOption, index: number) => void;
    isClaudeInstalled: boolean;
    hasChanges: boolean;
    initialSelection?: number;
    powerlineFontStatus: PowerlineFontStatus;
    settings: Settings | null;
    installation?: InstallationMetadata;
    previewIsTruncated?: boolean;
}

interface MainMenuItem {
    label: string;
    sublabel?: string;
    disabled?: boolean;
    value: MainMenuOption;
    description: string;
}

export type MainMenuEntry = MainMenuItem | '-';

// pistatusline: "installed" means the statusline is enabled as pi's footer.
function getInstallationMenuItem(
    isClaudeInstalled: boolean,
    _installation?: InstallationMetadata
): MainMenuItem {
    if (!isClaudeInstalled) {
        return {
            label: '📦 Enable in pi',
            value: 'install',
            description: 'Replace pi\'s built-in footer with this status line'
        };
    }

    return {
        label: '🔌 Disable in pi',
        value: 'install',
        description: 'Restore pi\'s built-in footer'
    };
}

export function buildMainMenuItems(
    isClaudeInstalled: boolean,
    hasChanges: boolean,
    installation?: InstallationMetadata
): MainMenuEntry[] {
    const menuItems: MainMenuEntry[] = [
        {
            label: '📝 Edit Lines',
            value: 'lines',
            description:
                'Configure any number of status lines with various widgets like model info, git status, and token usage'
        },
        {
            label: '🎨 Edit Colors',
            value: 'colors',
            description:
                'Customize colors for each widget including foreground, background, and bold styling'
        },
        {
            label: '⚡ Powerline Setup',
            value: 'powerline',
            description:
                'Install Powerline fonts for enhanced visual separators and symbols in your status line'
        },
        '-',
        {
            label: '💻 Terminal Options',
            value: 'terminalConfig',
            description: 'Configure terminal-specific settings for optimal display'
        },
        {
            label: '🌐 Global Overrides',
            value: 'globalOverrides',
            description:
                'Set global padding, separators, and color overrides that apply to all widgets'
        },
        {
            label: '🔧 Configure Status Line',
            value: 'configureStatusLine',
            description: 'Configure status line settings like refresh interval'
        },
        '-',
        {
            label: '📤 Export Config',
            value: 'exportConfig',
            description: 'Save your current configuration to a JSON file for backup or sharing'
        },
        {
            label: '📥 Import Config',
            value: 'importConfig',
            description: 'Load configuration from a previously exported JSON file'
        },
        '-',
        getInstallationMenuItem(isClaudeInstalled, installation)
    ];

    if (hasChanges) {
        menuItems.push(
            '-',
            {
                label: '💾 Save & Exit',
                value: 'save',
                description: 'Save all changes and exit the configuration tool'
            },
            {
                label: '❌ Exit without saving',
                value: 'exit',
                description: 'Exit without saving your changes'
            },
            '-',
            {
                label: '⭐ Like ccstatusline? Star us on GitHub',
                value: 'starGithub',
                description: 'Open the ccstatusline GitHub repository in your browser so you can star the project'
            }
        );
    } else {
        menuItems.push(
            '-',
            {
                label: '🚪 Exit',
                value: 'exit',
                description: 'Exit the configuration tool'
            },
            '-',
            {
                label: '⭐ Like ccstatusline? Star us on GitHub',
                value: 'starGithub',
                description: 'Open the ccstatusline GitHub repository in your browser so you can star the project'
            }
        );
    }

    return menuItems;
}

export function getMainMenuSelectionIndex(items: MainMenuEntry[], option: MainMenuOption): number {
    let selectionIndex = 0;

    for (const item of items) {
        if (item === '-') {
            continue;
        }

        if (item.value === option) {
            return selectionIndex;
        }

        if (!item.disabled) {
            selectionIndex += 1;
        }
    }

    return 0;
}

export const MainMenu: React.FC<MainMenuProps> = ({
    onSelect,
    isClaudeInstalled,
    hasChanges,
    initialSelection = 0,
    powerlineFontStatus,
    settings,
    installation,
    previewIsTruncated
}) => {
    const menuItems = buildMainMenuItems(isClaudeInstalled, hasChanges, installation);

    // Check if we should show the truncation warning
    const showTruncationWarning
        = previewIsTruncated && settings?.flexMode === 'full-minus-40';

    return (
        <Box flexDirection='column'>
            {showTruncationWarning && (
                <Box marginBottom={1}>
                    <Text color='yellow'>
                        ⚠ Some lines are truncated, see Terminal Options → Terminal Width
                        for info
                    </Text>
                </Box>
            )}

            <Text bold>Main Menu</Text>

            <List
                items={menuItems}
                marginTop={1}
                onSelect={(value, index) => {
                    if (value === 'back') {
                        return;
                    }

                    onSelect(value, index);
                }}
                initialSelection={initialSelection}
            />
        </Box>
    );
};
