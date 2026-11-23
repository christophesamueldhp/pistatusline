import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    CURRENT_VERSION,
    SettingsSchema,
    SettingsSchema_v1,
    type InstallationMetadata,
    type Settings
} from '../types/Settings';

import {
    migrateConfig,
    needsMigration
} from './migrations';
import { getPackageVersion } from './terminal';
import { upgradeLegacyWidgetTypes } from './widgets';

const readFile = fs.promises.readFile;
const writeFile = fs.promises.writeFile;
const mkdir = fs.promises.mkdir;
const rename = fs.promises.rename;
const unlink = fs.promises.unlink;
const lstat = fs.promises.lstat;
const readlink = fs.promises.readlink;
const realpath = fs.promises.realpath;

// pistatusline: settings live in pi's agent dir, moved by the same env var that pi's getAgentDir() reads.
function getPiAgentDir(): string {
    const override = process.env.PI_CODING_AGENT_DIR;
    if (!override) {
        return path.join(os.homedir(), '.pi', 'agent');
    }
    return override.startsWith('~') ? path.join(os.homedir(), override.slice(1)) : override;
}

const DEFAULT_SETTINGS_PATH = path.join(getPiAgentDir(), 'pistatusline', 'settings.json');
function getCcstatuslineSettingsPath(): string {
    return path.join(process.env.HOME ?? os.homedir(), '.config', 'ccstatusline', 'settings.json');
}

let settingsPath = DEFAULT_SETTINGS_PATH;
let lastLoadError: string | null = null;

export function getConfigLoadError(): string | null {
    return lastLoadError;
}

export function initConfigPath(filePath?: string): void {
    settingsPath = filePath ? path.resolve(filePath) : DEFAULT_SETTINGS_PATH;
}

export function getConfigPath(): string {
    return settingsPath;
}

export function isCustomConfigPath(): boolean {
    return settingsPath !== DEFAULT_SETTINGS_PATH;
}

interface SettingsPaths {
    configDir: string;
    settingsPath: string;
}

interface AtomicWriteTarget {
    targetPath: string;
    tempDir: string;
}

function getSettingsPaths(): SettingsPaths {
    return {
        configDir: path.dirname(settingsPath),
        settingsPath
    };
}

function getErrorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : undefined;
}

async function resolveSymlinkTarget(linkPath: string): Promise<string> {
    try {
        return await realpath(linkPath);
    } catch (error) {
        if (getErrorCode(error) !== 'ENOENT') {
            throw error;
        }

        const linkTarget = await readlink(linkPath);
        return path.resolve(path.dirname(linkPath), linkTarget);
    }
}

async function resolveAtomicWriteTarget(paths: SettingsPaths): Promise<AtomicWriteTarget> {
    try {
        const stats = await lstat(paths.settingsPath);
        if (!stats.isSymbolicLink()) {
            return {
                targetPath: paths.settingsPath,
                tempDir: paths.configDir
            };
        }

        const targetPath = await resolveSymlinkTarget(paths.settingsPath);
        return {
            targetPath,
            tempDir: path.dirname(targetPath)
        };
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            return {
                targetPath: paths.settingsPath,
                tempDir: paths.configDir
            };
        }

        throw error;
    }
}

async function writeSettingsJson(settings: unknown, paths: SettingsPaths): Promise<void> {
    await mkdir(paths.configDir, { recursive: true });

    const writeTarget = await resolveAtomicWriteTarget(paths);
    const tempPath = path.join(
        writeTarget.tempDir,
        `${path.basename(writeTarget.targetPath)}.${process.pid}.${Date.now()}.tmp`
    );
    try {
        await writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf-8');
        await rename(tempPath, writeTarget.targetPath);
    } catch (error) {
        try {
            await unlink(tempPath);
        } catch { }
        throw error;
    }
}

function inMemoryDefaults(): Settings {
    return SettingsSchema.parse({});
}

async function writeDefaultSettings(paths: SettingsPaths): Promise<Settings> {
    const defaults = inMemoryDefaults();
    try {
        await writeSettingsJson(defaults, paths);
        console.error(`Default settings written to ${paths.settingsPath}`);
    } catch (error) {
        console.error('Failed to write default settings:', error);
    }

    return defaults;
}

export async function loadSettings(): Promise<Settings> {
    lastLoadError = null;
    const paths = getSettingsPaths();

    try {
        if (!fs.existsSync(paths.settingsPath)) {
            // pistatusline: the first run copies an existing ccstatusline config.
            const ccstatuslinePath = getCcstatuslineSettingsPath();
            if (paths.settingsPath !== ccstatuslinePath && fs.existsSync(ccstatuslinePath)) {
                await mkdir(paths.configDir, { recursive: true });
                fs.copyFileSync(ccstatuslinePath, paths.settingsPath);
            } else {
                return await writeDefaultSettings(paths);
            }
        }

        const content = await readFile(paths.settingsPath, 'utf-8');
        let rawData: unknown;

        try {
            rawData = JSON.parse(content);
        } catch {
            console.error('Failed to parse settings.json, using defaults (file left unchanged)');
            lastLoadError = 'settings.json is not valid JSON';
            return inMemoryDefaults();
        }

        const hasVersion = typeof rawData === 'object' && rawData !== null && 'version' in rawData;
        let migrated = false;
        if (!hasVersion) {
            const v1Result = SettingsSchema_v1.safeParse(rawData);
            if (!v1Result.success) {
                console.error('Invalid v1 settings format, using defaults (file left unchanged):', v1Result.error);
                lastLoadError = 'settings.json is not in a valid format';
                return inMemoryDefaults();
            }

            rawData = migrateConfig(rawData, CURRENT_VERSION);
            migrated = true;
        } else if (needsMigration(rawData, CURRENT_VERSION)) {
            rawData = migrateConfig(rawData, CURRENT_VERSION);
            migrated = true;
        }

        const result = SettingsSchema.safeParse(rawData);
        if (!result.success) {
            console.error('Failed to parse settings, using defaults (file left unchanged):', result.error);
            lastLoadError = 'settings.json is not in a valid format';
            return inMemoryDefaults();
        }

        if (migrated) {
            await writeSettingsJson(rawData, paths);
        }

        return {
            ...result.data,
            lines: upgradeLegacyWidgetTypes(result.data.lines)
        };
    } catch (error) {
        console.error('Error loading settings, using defaults:', error);
        lastLoadError = 'settings.json could not be read';
        return inMemoryDefaults();
    }
}

export async function saveSettings(settings: Settings): Promise<void> {
    const paths = getSettingsPaths();

    const settingsWithVersion = {
        ...settings,
        version: CURRENT_VERSION
    };

    await writeSettingsJson(settingsWithVersion, paths);
    // pistatusline: no hook sync, because pi has no Claude Code settings.json to write hooks into.
}

export type ImportValidationResult
    = | { status: 'valid'; data: Settings; presentKeys: (keyof Settings)[] }
        | { status: 'invalid'; reason: string };

function expandPath(filePath: string): string {
    if (filePath.startsWith('~/') || filePath === '~') {
        return path.join(os.homedir(), filePath.slice(2));
    }
    return filePath;
}

export async function exportConfig(settings: Settings, filePath: string): Promise<void> {
    const expanded = expandPath(filePath);
    const exportData = { ...settings, exportedBy: getPackageVersion() };
    await mkdir(path.dirname(expanded), { recursive: true });
    await writeFile(expanded, JSON.stringify(exportData, null, 2), 'utf-8');
}

export async function validateImportFile(filePath: string): Promise<ImportValidationResult> {
    const expanded = expandPath(filePath);
    let raw: string;
    try {
        raw = await readFile(expanded, 'utf-8');
    } catch {
        return { status: 'invalid', reason: `Cannot read file: ${expanded}` };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { status: 'invalid', reason: 'File is not valid JSON' };
    }

    if (
        typeof parsed === 'object'
        && parsed !== null
        && 'version' in parsed
        && typeof parsed.version === 'number'
        && parsed.version > CURRENT_VERSION
    ) {
        return {
            status: 'invalid',
            reason: `Config version ${parsed.version} is newer than supported version ${CURRENT_VERSION}`
        };
    }

    if (needsMigration(parsed, CURRENT_VERSION)) {
        parsed = migrateConfig(parsed, CURRENT_VERSION);
    }

    const result = SettingsSchema.safeParse(parsed);
    if (!result.success) {
        return { status: 'invalid', reason: `Invalid config format: ${result.error.issues[0]?.message ?? 'unknown error'}` };
    }

    const presentKeys = Object.keys(parsed as Record<string, unknown>)
        .filter((key): key is keyof Settings => key in result.data);

    return { status: 'valid', data: result.data, presentKeys };
}

const IMPORT_EXCLUDED_KEYS = ['installation', 'version', 'updatemessage', 'exportedBy'] as const;
type ImportExcludedKey = typeof IMPORT_EXCLUDED_KEYS[number];

export function applyImport(
    current: Settings,
    imported: Settings,
    mode: 'replace' | 'merge',
    presentKeys: readonly (keyof Settings)[] = Object.keys(imported) as (keyof Settings)[]
): Settings {
    const mergeKeys = new Set(presentKeys);
    const importedClean = Object.fromEntries(
        Object.entries(imported).filter(([k]) => !IMPORT_EXCLUDED_KEYS.includes(k as ImportExcludedKey)
            && (mode === 'replace' || mergeKeys.has(k as keyof Settings))
        )
    ) as Partial<Settings>;

    if (mode === 'replace') {
        return SettingsSchema.parse({
            ...importedClean,
            installation: current.installation
        });
    }
    return { ...current, ...importedClean };
}

export async function saveInstallationMetadata(metadata: InstallationMetadata | undefined): Promise<void> {
    const paths = getSettingsPaths();
    if (!metadata && !fs.existsSync(paths.settingsPath)) {
        return;
    }

    const settings = await loadSettings();

    if (getConfigLoadError() !== null) {
        console.error('Skipping installation-metadata write: settings.json is unreadable (left unchanged).');
        return;
    }

    const settingsWithVersion: Settings & { version: number } = {
        ...settings,
        version: CURRENT_VERSION
    };

    if (metadata) {
        settingsWithVersion.installation = metadata;
    } else {
        delete settingsWithVersion.installation;
    }

    await writeSettingsJson(settingsWithVersion, paths);
}
