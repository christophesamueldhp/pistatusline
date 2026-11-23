import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { PowerlineFontStatus } from '../types/PowerlineFontStatus';

export type { PowerlineFontStatus };

let fontsInstalledThisSession = false;

export function checkPowerlineFonts(): PowerlineFontStatus {
    if (process.env.DEBUG_FONT_INSTALL === '1' && !fontsInstalledThisSession) {
        return {
            installed: false,
            checkedSymbol: '\uE0B0'
        };
    }

    try {
        const testSymbols = {
            rightArrow: '\uE0B0',
            rightThinArrow: '\uE0B1',
            leftArrow: '\uE0B2',
            leftThinArrow: '\uE0B3'
        };

        const platform = os.platform();
        let fontPaths: string[] = [];

        if (platform === 'darwin') {
            fontPaths = [
                path.join(os.homedir(), 'Library', 'Fonts'),
                '/Library/Fonts',
                '/System/Library/Fonts'
            ];
        } else if (platform === 'linux') {
            fontPaths = [
                path.join(os.homedir(), '.local', 'share', 'fonts'),
                path.join(os.homedir(), '.fonts'),
                '/usr/share/fonts',
                '/usr/local/share/fonts'
            ];
        } else if (platform === 'win32') {
            fontPaths = [
                path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts'),
                'C:\\Windows\\Fonts'
            ];
        }

        const powerlineFontPatterns = [
            /powerline/i,
            /nerd font/i,
            /for powerline/i,
            /meslo.*lg/i,
            /source.*code.*pro.*powerline/i,
            /dejavu.*powerline/i,
            /ubuntu.*mono.*powerline/i,
            /cascadia.*code.*pl/i,
            /fira.*code.*nerd/i
        ];

        for (const fontPath of fontPaths) {
            if (fs.existsSync(fontPath)) {
                try {
                    const files = fs.readdirSync(fontPath);
                    for (const file of files) {
                        for (const pattern of powerlineFontPatterns) {
                            if (pattern.test(file)) {
                                return {
                                    installed: true,
                                    checkedSymbol: testSymbols.rightArrow
                                };
                            }
                        }
                    }
                } catch {
                }
            }
        }

        return {
            installed: false,
            checkedSymbol: testSymbols.rightArrow
        };
    } catch {
        return { installed: false };
    }
}

export async function checkPowerlineFontsAsync(): Promise<PowerlineFontStatus> {
    await Promise.resolve();

    if (process.env.DEBUG_FONT_INSTALL === '1' && !fontsInstalledThisSession) {
        return {
            installed: false,
            checkedSymbol: '\uE0B0'
        };
    }

    try {
        const quickCheck = checkPowerlineFonts();
        if (quickCheck.installed) {
            return quickCheck;
        }

        const platform = os.platform();
        if (platform === 'linux' || platform === 'darwin') {
            try {
                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);

                const { stdout } = await execAsync('fc-list 2>/dev/null | grep -i powerline', {
                    encoding: 'utf8',
                    windowsHide: true
                });

                if (stdout.trim()) {
                    return {
                        installed: true,
                        checkedSymbol: '\uE0B0'
                    };
                }
            } catch {
            }
        }

        return quickCheck;
    } catch {
        return { installed: false };
    }
}

export async function installPowerlineFonts(): Promise<{ success: boolean; message: string }> {
    await Promise.resolve();

    try {
        const platform = os.platform();
        let fontDir: string;

        if (platform === 'darwin') {
            fontDir = path.join(os.homedir(), 'Library', 'Fonts');
        } else if (platform === 'linux') {
            fontDir = path.join(os.homedir(), '.local', 'share', 'fonts');
        } else if (platform === 'win32') {
            fontDir = path.join(
                os.homedir(),
                'AppData',
                'Local',
                'Microsoft',
                'Windows',
                'Fonts'
            );
        } else {
            return {
                success: false,
                message: 'Unsupported platform for font installation'
            };
        }

        if (!fs.existsSync(fontDir)) {
            fs.mkdirSync(fontDir, { recursive: true });
        }

        const tempDir = path.join(os.tmpdir(), `ccstatusline-powerline-fonts-${Date.now()}`);

        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }

            execSync(
                `git clone --depth=1 https://github.com/powerline/fonts.git "${tempDir}"`,
                {
                    stdio: 'pipe',
                    encoding: 'utf8',
                    windowsHide: true
                }
            );

            if (platform === 'darwin' || platform === 'linux') {
                const installScript = path.join(tempDir, 'install.sh');

                if (fs.existsSync(installScript)) {
                    fs.chmodSync(installScript, 0o755);

                    execSync(`cd "${tempDir}" && ./install.sh`, {
                        stdio: 'pipe',
                        encoding: 'utf8',
                        shell: '/bin/bash',
                        windowsHide: true
                    });

                    if (platform === 'linux') {
                        try {
                            execSync('fc-cache -f -v', {
                                stdio: 'pipe',
                                encoding: 'utf8',
                                windowsHide: true
                            });
                        } catch {
                        }
                    }

                    if (process.env.DEBUG_FONT_INSTALL === '1') {
                        fontsInstalledThisSession = true;
                    }

                    return {
                        success: true,
                        message: 'Powerline fonts installed successfully! Please restart your terminal and select a Powerline font (e.g., "Source Code Pro for Powerline", "Meslo LG S for Powerline", etc.)'
                    };
                } else {
                    throw new Error('Install script not found in Powerline fonts repository');
                }
            } else {
                const fontFiles: string[] = [];

                function findFontFiles(dir: string): void {
                    const files = fs.readdirSync(dir);
                    for (const file of files) {
                        const filePath = path.join(dir, file);
                        const stat = fs.statSync(filePath);

                        if (stat.isDirectory() && !file.startsWith('.')) {
                            findFontFiles(filePath);
                        } else if (file.endsWith('.ttf') || file.endsWith('.otf')) {
                            if (filePath.toLowerCase().includes('powerline')) {
                                fontFiles.push(filePath);
                            }
                        }
                    }
                }

                findFontFiles(tempDir);

                let installedCount = 0;
                for (const fontFile of fontFiles) {
                    const fileName = path.basename(fontFile);
                    const destPath = path.join(fontDir, fileName);

                    try {
                        fs.copyFileSync(fontFile, destPath);
                        installedCount++;
                    } catch {
                    }
                }

                if (installedCount > 0) {
                    return {
                        success: true,
                        message: `Installed ${installedCount} Powerline fonts. Please restart your terminal and select a Powerline font from your terminal settings.`
                    };
                } else {
                    throw new Error('No fonts were installed');
                }
            }

            return {
                success: false,
                message: 'Platform-specific installation not implemented'
            };
        } finally {
            if (fs.existsSync(tempDir)) {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch {
                }
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('git')) {
            return {
                success: false,
                message: 'Git is required to install Powerline fonts. Please install Git and try again.'
            };
        }

        return {
            success: false,
            message: `Failed to install Powerline fonts: ${errorMessage}. You can manually install fonts from: https://github.com/powerline/fonts`
        };
    }
}

export function getPowerlineStatusMessage(status: PowerlineFontStatus): string {
    if (status.installed) {
        return `✓ Powerline fonts detected`;
    } else {
        return `✗ Powerline fonts not detected - some symbols may not display correctly`;
    }
}
