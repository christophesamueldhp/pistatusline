import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';

import type { ClaudeSettings } from '../types/ClaudeSettings';
import type { RenderContext } from '../types/RenderContext';
import {
    SettingsSchema,
    type InstallationMetadata,
    type Settings
} from '../types/Settings';

import {
    getConfigPath,
    isCustomConfigPath,
    saveInstallationMetadata
} from './config';

export type { ClaudeSettings };

const readFile = fs.promises.readFile;
const writeFile = fs.promises.writeFile;
const mkdir = fs.promises.mkdir;

export const CCSTATUSLINE_COMMANDS = {
    AUTO_NPX: 'npx -y ccstatusline@latest',
    AUTO_BUNX: 'bunx -y ccstatusline@latest',
    GLOBAL: 'ccstatusline',
    NPM: 'npx -y ccstatusline@latest',
    BUNX: 'bunx -y ccstatusline@latest',
    SELF_MANAGED: 'ccstatusline'
};

export const PINNED_INSTALL_COMMANDS = {
    NPM: (version: string) => `npm install -g ccstatusline@${version}`,
    BUN: (version: string) => `bun add -g ccstatusline@${version}`
};

export type StatusLineCommandMode = 'auto-npx' | 'auto-bunx' | 'global';

export interface InstallStatusLineOptions {
    commandMode: StatusLineCommandMode;
    supportsRefreshInterval?: boolean;
    installationMetadata?: InstallationMetadata;
}

export interface PackageCommandAvailability {
    npm: boolean;
    npx: boolean;
    bun: boolean;
    bunx: boolean;
}

export function isKnownCommand(command: string): boolean {
    const prefixes = [CCSTATUSLINE_COMMANDS.AUTO_NPX, CCSTATUSLINE_COMMANDS.AUTO_BUNX, CCSTATUSLINE_COMMANDS.GLOBAL];
    return prefixes.some(prefix => command === prefix || command.startsWith(`${prefix} --config `))
        || /(?:^|[\s"'\\/])ccstatusline\.ts(?=$|[\s"'])/.test(command);
}

function needsQuoting(filePath: string): boolean {
    if (process.platform === 'win32') {
        return /[\s&()<>|^"]/.test(filePath);
    }

    return /[\s()[\];&#|'"\\$`]/.test(filePath);
}

function quotePathIfNeeded(filePath: string): string {
    if (!needsQuoting(filePath)) {
        return filePath;
    }

    if (process.platform === 'win32') {
        return `"${filePath.replace(/"/g, '""')}"`;
    }

    return `'${filePath.replace(/'/g, '\'\\\'\'')}'`;
}

export function getClaudeConfigDir(): string {
    const envConfigDir = process.env.CLAUDE_CONFIG_DIR;

    if (envConfigDir) {
        try {
            const resolvedPath = path.resolve(envConfigDir);

            if (fs.existsSync(resolvedPath)) {
                const stats = fs.statSync(resolvedPath);
                if (stats.isDirectory()) {
                    return resolvedPath;
                }
            } else {
                return resolvedPath;
            }
        } catch {
        }
    }

    return path.join(os.homedir(), '.claude');
}

export function getClaudeJsonPath(): string {
    const configDir = getClaudeConfigDir();
    const envConfigDir = process.env.CLAUDE_CONFIG_DIR;

    if (envConfigDir && configDir === path.resolve(envConfigDir)) {
        return path.join(configDir, '.claude.json');
    }

    return path.join(path.dirname(configDir), '.claude.json');
}

export function getClaudeSettingsPath(): string {
    return path.join(getClaudeConfigDir(), 'settings.json');
}

async function backupClaudeSettings(suffix = '.bak'): Promise<string | null> {
    const settingsPath = getClaudeSettingsPath();
    const backupPath = settingsPath + suffix;
    try {
        if (fs.existsSync(settingsPath)) {
            const content = await readFile(settingsPath, 'utf-8');
            await writeFile(backupPath, content, 'utf-8');
            return backupPath;
        }
    } catch (error) {
        console.error('Failed to backup Claude settings:', error);
    }

    return null;
}

interface LoadClaudeSettingsOptions { logErrors?: boolean }

export function loadClaudeSettingsSync(options: LoadClaudeSettingsOptions = {}): ClaudeSettings {
    const { logErrors = true } = options;
    const settingsPath = getClaudeSettingsPath();

    if (!fs.existsSync(settingsPath)) {
        return {};
    }

    try {
        const content = fs.readFileSync(settingsPath, 'utf-8');
        return JSON.parse(content) as ClaudeSettings;
    } catch (error) {
        if (logErrors) {
            console.error('Failed to load Claude settings:', error);
        }
        throw error;
    }
}

export async function loadClaudeSettings(options: LoadClaudeSettingsOptions = {}): Promise<ClaudeSettings> {
    const { logErrors = true } = options;
    const settingsPath = getClaudeSettingsPath();

    if (!fs.existsSync(settingsPath)) {
        return {};
    }

    try {
        const content = await readFile(settingsPath, 'utf-8');
        return JSON.parse(content) as ClaudeSettings;
    } catch (error) {
        if (logErrors) {
            console.error('Failed to load Claude settings:', error);
        }
        throw error;
    }
}

export async function saveClaudeSettings(
    settings: ClaudeSettings
): Promise<void> {
    const settingsPath = getClaudeSettingsPath();
    const dir = path.dirname(settingsPath);

    await backupClaudeSettings();

    await mkdir(dir, { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

export async function isInstalled(): Promise<boolean> {
    let settings: ClaudeSettings;

    try {
        settings = await loadClaudeSettings({ logErrors: false });
    } catch {
        return false;
    }
    const command = settings.statusLine?.command ?? '';

    return (
        isKnownCommand(command)
        && (settings.statusLine?.padding === 0
            || settings.statusLine?.padding === undefined)
    );
}

function isExecutableAvailable(executable: string): boolean {
    try {
        const command = process.platform === 'win32' ? `where ${executable}` : `which ${executable}`;
        execSync(command, { stdio: 'ignore', windowsHide: true });
        return true;
    } catch {
        return false;
    }
}

export function isNpmAvailable(): boolean {
    return isExecutableAvailable('npm');
}

export function isNpxAvailable(): boolean {
    return isExecutableAvailable('npx');
}

export function isBunAvailable(): boolean {
    return isExecutableAvailable('bun');
}

export function isBunxAvailable(): boolean {
    return isExecutableAvailable('bunx');
}

export function getPackageCommandAvailability(): PackageCommandAvailability {
    return {
        npm: isNpmAvailable(),
        npx: isNpxAvailable(),
        bun: isBunAvailable(),
        bunx: isBunxAvailable()
    };
}

export function getClaudeCodeVersion(): string | null {
    try {
        const output = execSync('claude --version', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
            timeout: 5000,
            windowsHide: true
        }).trim();
        const match = /^(\d+\.\d+\.\d+)/.exec(output);
        return match?.[1] ?? null;
    } catch {
        return null;
    }
}

export function isClaudeCodeVersionAtLeast(minVersion: string): boolean {
    const version = getClaudeCodeVersion();
    if (!version) {
        return false;
    }

    const current = version.split('.').map(Number);
    const minimum = minVersion.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
        const c = current[i] ?? 0;
        const m = minimum[i] ?? 0;
        if (c > m) {
            return true;
        }
        if (c < m) {
            return false;
        }
    }

    return true;
}

function buildCommand(baseCommand: string): string {
    if (isCustomConfigPath()) {
        return `${baseCommand} --config ${quotePathIfNeeded(getConfigPath())}`;
    }
    return baseCommand;
}

export function getBaseCommandForMode(commandMode: StatusLineCommandMode): string {
    switch (commandMode) {
        case 'auto-npx':
            return CCSTATUSLINE_COMMANDS.AUTO_NPX;
        case 'auto-bunx':
            return CCSTATUSLINE_COMMANDS.AUTO_BUNX;
        case 'global':
            return CCSTATUSLINE_COMMANDS.GLOBAL;
    }
}

export function buildStatusLineCommand(commandMode: StatusLineCommandMode): string {
    return buildCommand(getBaseCommandForMode(commandMode));
}

function matchesCommandBase(command: string, baseCommand: string): boolean {
    return command === baseCommand || command.startsWith(`${baseCommand} --config `);
}

function isLocalDevelopmentCommand(command: string): boolean {
    return /(?:^|[\s"'\\/])ccstatusline\.ts(?=$|[\s"'])/.test(command);
}

export function classifyInstallation(
    command: string | null | undefined,
    metadata?: InstallationMetadata
): InstallationMetadata {
    const statusLineCommand = command ?? '';

    if (matchesCommandBase(statusLineCommand, CCSTATUSLINE_COMMANDS.AUTO_NPX)) {
        return {
            method: 'auto-update',
            packageManager: 'npm'
        };
    }

    if (matchesCommandBase(statusLineCommand, CCSTATUSLINE_COMMANDS.AUTO_BUNX)) {
        return {
            method: 'auto-update',
            packageManager: 'bun'
        };
    }

    if (matchesCommandBase(statusLineCommand, CCSTATUSLINE_COMMANDS.GLOBAL)) {
        if (metadata?.method === 'pinned') {
            return metadata;
        }

        return {
            method: 'self-managed',
            packageManager: 'unknown'
        };
    }

    if (isLocalDevelopmentCommand(statusLineCommand)) {
        return {
            method: 'self-managed',
            packageManager: 'unknown'
        };
    }

    return {
        method: 'unknown',
        packageManager: 'unknown'
    };
}

async function loadSavedSettingsForHookSync(): Promise<Settings | null> {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        return null;
    }

    try {
        const content = await readFile(configPath, 'utf-8');
        const parsed = JSON.parse(content) as unknown;
        const result = SettingsSchema.safeParse(parsed);
        if (!result.success) {
            return null;
        }
        return result.data;
    } catch {
        return null;
    }
}

export async function installStatusLine({
    commandMode,
    supportsRefreshInterval = false,
    installationMetadata
}: InstallStatusLineOptions): Promise<void> {
    let settings: ClaudeSettings;

    const backupPath = await backupClaudeSettings('.orig');
    try {
        settings = await loadClaudeSettings({ logErrors: false });
    } catch {
        const fallbackBackupPath = `${getClaudeSettingsPath()}.orig`;
        console.error(`Warning: Could not read existing Claude settings. A backup exists at ${backupPath ?? fallbackBackupPath}.`);
        settings = {};
    }

    const existingRefreshInterval = settings.statusLine?.refreshInterval;
    settings.statusLine = {
        type: 'command',
        command: buildStatusLineCommand(commandMode),
        padding: 0
    };

    if (supportsRefreshInterval) {
        settings.statusLine.refreshInterval = existingRefreshInterval ?? 10;
    }

    await saveClaudeSettings(settings);
    if (installationMetadata !== undefined) {
        await saveInstallationMetadata(installationMetadata);
    }

    const savedSettings = await loadSavedSettingsForHookSync();
    if (savedSettings) {
        const { syncWidgetHooks } = await import('./hooks');
        await syncWidgetHooks(savedSettings);
    }
}

export async function uninstallStatusLine(): Promise<void> {
    let settings: ClaudeSettings;

    try {
        settings = await loadClaudeSettings({ logErrors: false });
    } catch {
        console.error('Warning: Could not read existing Claude settings.');
        return;
    }

    if (settings.statusLine) {
        delete settings.statusLine;
        await saveClaudeSettings(settings);
    }

    await saveInstallationMetadata(undefined);

    try {
        const { removeManagedHooks } = await import('./hooks');
        await removeManagedHooks();
    } catch {
    }
}

export async function getExistingStatusLine(): Promise<string | null> {
    try {
        const settings = await loadClaudeSettings({ logErrors: false });
        return settings.statusLine?.command ?? null;
    } catch {
        return null;
    }
}

export async function getRefreshInterval(): Promise<number | null> {
    try {
        const settings = await loadClaudeSettings({ logErrors: false });
        return settings.statusLine?.refreshInterval ?? null;
    } catch {
        return null;
    }
}

export async function setRefreshInterval(interval: number | null): Promise<void> {
    let settings: ClaudeSettings;

    try {
        settings = await loadClaudeSettings({ logErrors: false });
    } catch {
        return;
    }

    if (!settings.statusLine) {
        return;
    }

    if (interval === null) {
        delete settings.statusLine.refreshInterval;
    } else {
        settings.statusLine.refreshInterval = interval;
    }

    await saveClaudeSettings(settings);
}

const VoiceConfigSchema = z.object({ enabled: z.boolean().optional() });

function getLayeredSettingsCandidatePathsByPriority(cwd: string): string[] {
    const userDir = getClaudeConfigDir();
    const projectDir = path.join(cwd, '.claude');
    const candidates = [
        path.join(projectDir, 'settings.local.json'),
        path.join(projectDir, 'settings.json'),
        path.join(userDir, 'settings.local.json'),
        path.join(userDir, 'settings.json')
    ];
    return Array.from(new Set(candidates));
}

export function resolveClaudeConfigCwd(context: RenderContext): string | undefined {
    const candidates = [
        context.data?.workspace?.project_dir,
        context.data?.cwd,
        context.data?.workspace?.current_dir
    ];

    return candidates.find(candidate => typeof candidate === 'string' && candidate.trim().length > 0);
}

interface VoiceLayerResult {
    fileExisted: boolean;
    enabled: boolean | undefined;
}

function tryReadVoiceLayer(filePath: string): VoiceLayerResult {
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
        const isMissing = (error as NodeJS.ErrnoException).code === 'ENOENT';
        return { fileExisted: !isMissing, enabled: undefined };
    }

    try {
        const parsed = JSON.parse(content) as { voice?: unknown };
        const voice = parsed.voice;
        if (voice === undefined || voice === null) {
            return { fileExisted: true, enabled: undefined };
        }
        const result = VoiceConfigSchema.safeParse(voice);
        return { fileExisted: true, enabled: result.success ? result.data.enabled : undefined };
    } catch {
        return { fileExisted: true, enabled: undefined };
    }
}

export function getVoiceConfig(cwd: string = process.cwd()): { enabled: boolean } | null {
    let anyFileExisted = false;
    for (const filePath of getLayeredSettingsCandidatePathsByPriority(cwd)) {
        const layer = tryReadVoiceLayer(filePath);
        if (layer.fileExisted) {
            anyFileExisted = true;
        }
        if (layer.enabled !== undefined) {
            return { enabled: layer.enabled };
        }
    }
    return anyFileExisted ? { enabled: false } : null;
}

const SandboxConfigSchema = z.object({ enabled: z.boolean().optional() });

function tryReadSandboxLayer(filePath: string): { fileExisted: boolean; enabled: boolean | undefined } {
    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
        const isMissing = (error as NodeJS.ErrnoException).code === 'ENOENT';
        return { fileExisted: !isMissing, enabled: undefined };
    }

    try {
        const parsed = JSON.parse(content) as { sandbox?: unknown };
        const sandbox = parsed.sandbox;
        if (sandbox === undefined || sandbox === null) {
            return { fileExisted: true, enabled: undefined };
        }
        const result = SandboxConfigSchema.safeParse(sandbox);
        return { fileExisted: true, enabled: result.success ? result.data.enabled : undefined };
    } catch {
        return { fileExisted: true, enabled: undefined };
    }
}

export function getSandboxConfig(cwd: string = process.cwd()): { enabled: boolean } | null {
    let anyFileExisted = false;
    for (const filePath of getLayeredSettingsCandidatePathsByPriority(cwd)) {
        const layer = tryReadSandboxLayer(filePath);
        if (layer.fileExisted) {
            anyFileExisted = true;
        }
        if (layer.enabled !== undefined) {
            return { enabled: layer.enabled };
        }
    }
    return anyFileExisted ? { enabled: false } : null;
}

const RemoteSessionFileSchema = z.object({
    sessionId: z.string().optional(),
    bridgeSessionId: z.string().nullable().optional()
});

export function getRemoteControlStatus(sessionId: string | undefined): { enabled: boolean } | null {
    if (!sessionId) {
        return null;
    }

    const sessionsDir = path.join(getClaudeConfigDir(), 'sessions');
    let entries: string[];
    try {
        entries = fs.readdirSync(sessionsDir);
    } catch {
        return null;
    }

    for (const entry of entries) {
        if (!entry.endsWith('.json')) {
            continue;
        }

        let content: string;
        try {
            content = fs.readFileSync(path.join(sessionsDir, entry), 'utf-8');
        } catch {
            continue;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(content);
        } catch {
            continue;
        }

        const result = RemoteSessionFileSchema.safeParse(parsed);
        if (!result.success || result.data.sessionId !== sessionId) {
            continue;
        }

        const bridge = result.data.bridgeSessionId;
        return { enabled: typeof bridge === 'string' && bridge.length > 0 };
    }

    return null;
}
