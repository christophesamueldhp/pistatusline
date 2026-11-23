import type { RenderContext } from '../types/RenderContext';

import {
    runGit,
    runGitArgs
} from './git';

export interface RemoteInfo {
    name: string;
    url: string;
    host: string;
    owner: string;
    repo: string;
}

export interface ForkStatus {
    isFork: boolean;
    origin: RemoteInfo | null;
    upstream: RemoteInfo | null;
}

export function parseRemoteUrl(url: string): { host: string; owner: string; repo: string } | null {
    const trimmed = url.trim();
    if (trimmed.length === 0) {
        return null;
    }

    const sshMatch = !trimmed.includes('://')
        ? /^(?:[^@]+@)?([^:]+):(.+?)(?:\.git)?\/?$/.exec(trimmed)
        : null;
    if (sshMatch?.[1] && sshMatch[2]) {
        const pathSegments = sshMatch[2].split('/').filter(Boolean);
        const repo = pathSegments.at(-1);
        const owner = pathSegments.slice(0, -1).join('/');

        if (!owner || !repo) {
            return null;
        }

        return {
            host: sshMatch[1],
            owner,
            repo
        };
    }

    try {
        const parsedUrl = new URL(trimmed);
        const supportedProtocols = new Set(['http:', 'https:', 'ssh:', 'git:']);

        if (!supportedProtocols.has(parsedUrl.protocol)) {
            return null;
        }

        const pathname = parsedUrl.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
        const segments = pathname.split('/').filter(Boolean);

        const repo = segments.at(-1);
        const owner = segments.slice(0, -1).join('/');

        if (!owner || !repo) {
            return null;
        }

        return {
            host: parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
                ? parsedUrl.host
                : parsedUrl.hostname,
            owner,
            repo
        };
    } catch {
        return null;
    }
}

export function getRemoteInfo(remoteName: string, context: RenderContext): RemoteInfo | null {
    const url = runGitArgs(['remote', 'get-url', '--', remoteName], context, `remote get-url -- ${remoteName}`);
    if (!url) {
        return null;
    }

    const parsed = parseRemoteUrl(url);
    if (!parsed) {
        return null;
    }

    return {
        name: remoteName,
        url,
        host: parsed.host,
        owner: parsed.owner,
        repo: parsed.repo
    };
}

function getTrackingRemoteName(context: RenderContext): string | null {
    const upstreamRef = runGit('rev-parse --abbrev-ref --symbolic-full-name @{upstream}', context);
    if (!upstreamRef) {
        return null;
    }

    const remotes = listRemotes(context)
        .slice()
        .sort((left, right) => right.length - left.length);

    return remotes.find(remote => upstreamRef === remote || upstreamRef.startsWith(`${remote}/`)) ?? null;
}

export function getUpstreamRemoteInfo(context: RenderContext): RemoteInfo | null {
    const namedUpstream = getRemoteInfo('upstream', context);
    if (namedUpstream) {
        return namedUpstream;
    }

    const trackingRemoteName = getTrackingRemoteName(context);
    if (!trackingRemoteName) {
        return null;
    }

    return getRemoteInfo(trackingRemoteName, context);
}

export function getForkStatus(context: RenderContext): ForkStatus {
    const origin = getRemoteInfo('origin', context);
    const upstream = getRemoteInfo('upstream', context);

    const isFork = Boolean(
        origin
        && upstream
        && (origin.owner !== upstream.owner || origin.repo !== upstream.repo)
    );

    return {
        isFork,
        origin,
        upstream
    };
}

export function listRemotes(context: RenderContext): string[] {
    const output = runGit('remote', context);
    if (!output) {
        return [];
    }

    return output.split('\n').filter(Boolean);
}

export function buildRepoWebUrl(remote: RemoteInfo): string {
    return `https://${remote.host}/${remote.owner}/${remote.repo}`;
}

// GitLab redirects /tree/<branch> to its canonical /-/tree/<branch>, so one
// suffix works for both GitHub and GitLab.
export function buildBranchWebUrl(remote: RemoteInfo, encodedBranch: string): string {
    return `${buildRepoWebUrl(remote)}/tree/${encodedBranch}`;
}
