import * as fs from 'fs';
import * as tty from 'tty';

const MAX_ANCESTOR_DEPTH = 8;
const STDIO_FDS = [0, 1, 2] as const;

export interface NativeProbeDeps {
    readFileSync: (path: string) => string;
    readlinkSync: (path: string) => string;
    openSync: (path: string, flags: number) => number;
    closeSync: (fd: number) => void;
    isatty: (fd: number) => boolean;
    getColumns: (fd: number) => number | null;
    platform: string;
}

const defaultDeps: NativeProbeDeps = {
    readFileSync: (path: string) => fs.readFileSync(path, 'utf-8'),
    readlinkSync: (path: string) => fs.readlinkSync(path, 'utf-8'),
    openSync: (path: string, flags: number) => fs.openSync(path, flags),
    closeSync: (fd: number) => { fs.closeSync(fd); },
    isatty: (fd: number) => tty.isatty(fd),
    getColumns: (fd: number) => {
        const stream = new tty.WriteStream(fd);
        const columns = stream.columns;
        return typeof columns === 'number' && columns > 0 ? columns : null;
    },
    get platform(): string {
        return process.platform;
    }
};

export function parsePpidFromStat(stat: string): number | null {
    const commEnd = stat.lastIndexOf(')');
    if (commEnd === -1) {
        return null;
    }

    const fields = stat.slice(commEnd + 1).trim().split(/\s+/);
    const ppid = parseInt(fields[1] ?? '', 10);
    if (isNaN(ppid) || ppid <= 0) {
        return null;
    }

    return ppid;
}

function findTTYDevice(pid: number, deps: NativeProbeDeps): string | null {
    for (const fd of STDIO_FDS) {
        try {
            const target = deps.readlinkSync(`/proc/${pid}/fd/${fd}`);
            if (target.startsWith('/dev/pts/') || target.startsWith('/dev/tty')) {
                return target;
            }
        } catch {
        }
    }

    return null;
}

function widthOfDevice(device: string, deps: NativeProbeDeps): number | null {
    let fd: number | null = null;
    try {
        fd = deps.openSync(device, fs.constants.O_RDONLY | fs.constants.O_NOCTTY);
        if (!deps.isatty(fd)) {
            return null;
        }

        return deps.getColumns(fd);
    } catch {
        return null;
    } finally {
        if (fd !== null) {
            try {
                deps.closeSync(fd);
            } catch {
            }
        }
    }
}

export function probeWidthNative(deps: NativeProbeDeps = defaultDeps): number | null {
    if (deps.platform !== 'linux') {
        return null;
    }

    let pid = process.pid;
    for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
        let stat: string;
        try {
            stat = deps.readFileSync(`/proc/${pid}/stat`);
        } catch {
            return null;
        }

        const parentPid = parsePpidFromStat(stat);
        if (parentPid === null || parentPid <= 1) {
            return null;
        }

        pid = parentPid;

        const device = findTTYDevice(pid, deps);
        if (device === null) {
            continue;
        }

        const width = widthOfDevice(device, deps);
        if (width !== null) {
            return width;
        }
    }

    return null;
}
