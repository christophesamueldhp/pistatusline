import { createRequire as __pistatuslineCreateRequire } from 'node:module';
import { fileURLToPath as __pistatuslineFileURLToPath } from 'node:url';
import { dirname as __pistatuslineDirname } from 'node:path';
const require = __pistatuslineCreateRequire(import.meta.url);
const __filename = __pistatuslineFileURLToPath(import.meta.url);
const __dirname = __pistatuslineDirname(__filename);

// src/utils/git-review-cache.ts
import {
  execFileSync as execFileSync2,
  spawn
} from "child_process";
import {
  closeSync,
  existsSync,
  mkdirSync as mkdirSync2,
  openSync,
  readFileSync as readFileSync2,
  statSync as statSync2,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync2
} from "fs";
import { createHash as createHash2 } from "node:crypto";
import os2 from "node:os";
import path2 from "node:path";

// src/utils/git.ts
import { execFileSync } from "child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
var DEFAULT_GIT_CACHE_TTL_SECONDS = 5;
var GIT_CACHE_SCHEMA_VERSION = 1;
var GIT_COMMAND_TIMEOUT_MS = 5e3;
var gitCommandCache = /* @__PURE__ */ new Map();
function getCacheDir() {
  return path.join(os.homedir(), ".cache", "ccstatusline");
}
function getCachePath(gitDir) {
  const repoHash = createHash("sha256").update(gitDir).digest("hex").slice(0, 16);
  return path.join(getCacheDir(), "git-cache", `git-${repoHash}.json`);
}
function getMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}
function normalizeDirectory(candidate) {
  try {
    const resolved = path.resolve(candidate);
    const stats = fs.statSync(resolved);
    return stats.isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return null;
  }
}
function readGitDirFile(gitFilePath) {
  try {
    const content = fs.readFileSync(gitFilePath, "utf-8").trim();
    const match = /^gitdir:\s*(.+)$/i.exec(content);
    if (!match?.[1]) {
      return null;
    }
    return path.resolve(path.dirname(gitFilePath), match[1]);
  } catch {
    return null;
  }
}
function discoverGitDir(startDir) {
  let current = startDir;
  for (; ; ) {
    const gitPath = path.join(current, ".git");
    try {
      const stats = fs.statSync(gitPath);
      if (stats.isDirectory()) {
        return gitPath;
      }
      if (stats.isFile()) {
        return readGitDirFile(gitPath);
      }
    } catch {
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
function getGitRepoMetadata(cwd) {
  if (!cwd) {
    return null;
  }
  const startDir = normalizeDirectory(cwd);
  if (!startDir) {
    return null;
  }
  const gitDir = discoverGitDir(startDir);
  if (!gitDir) {
    return null;
  }
  return {
    cachePath: getCachePath(gitDir),
    headMtimeMs: getMtimeMs(path.join(gitDir, "HEAD")),
    indexMtimeMs: getMtimeMs(path.join(gitDir, "index"))
  };
}
function getGitCacheTtlMs(context) {
  const ttlSeconds = context.gitCacheTtlSeconds;
  if (typeof ttlSeconds !== "number" || !Number.isFinite(ttlSeconds)) {
    return DEFAULT_GIT_CACHE_TTL_SECONDS * 1e3;
  }
  return Math.min(60, Math.max(0, ttlSeconds)) * 1e3;
}
function isCacheEntry(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value;
  return (typeof entry.output === "string" || entry.output === null) && typeof entry.createdAt === "number" && (typeof entry.headMtimeMs === "number" || entry.headMtimeMs === null) && (typeof entry.indexMtimeMs === "number" || entry.indexMtimeMs === null);
}
function isCacheEntryFresh(entry, metadata, ttlMs, now) {
  if (metadata) {
    if (entry.headMtimeMs !== metadata.headMtimeMs || entry.indexMtimeMs !== metadata.indexMtimeMs) {
      return false;
    }
  }
  return ttlMs === 0 || now - entry.createdAt <= ttlMs;
}
function readPersistentCache(cachePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const data = parsed;
    if (data.version !== GIT_CACHE_SCHEMA_VERSION || typeof data.cwd !== "string" && data.cwd !== null || typeof data.entries !== "object" || data.entries === null) {
      return null;
    }
    const entries = {};
    for (const [key, value] of Object.entries(data.entries)) {
      if (isCacheEntry(value)) {
        entries[key] = value;
      }
    }
    return {
      version: GIT_CACHE_SCHEMA_VERSION,
      cwd: data.cwd,
      entries
    };
  } catch {
    return null;
  }
}
function writePersistentCache(cachePath, cache) {
  const tempPath = `${cachePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(cache), "utf-8");
    fs.renameSync(tempPath, cachePath);
  } catch {
    try {
      fs.unlinkSync(tempPath);
    } catch {
    }
  }
}
function readPersistentCacheEntry(metadata, cacheKey, cwd, ttlMs, now) {
  if (!metadata) {
    return null;
  }
  const cache = readPersistentCache(metadata.cachePath);
  if (cache?.cwd !== (cwd ?? null)) {
    return null;
  }
  const entry = cache.entries[cacheKey];
  if (!entry || !isCacheEntryFresh(entry, metadata, ttlMs, now)) {
    return null;
  }
  return entry;
}
function writePersistentCacheEntry(metadata, cacheKey, cwd, entry) {
  if (!metadata) {
    return;
  }
  const cacheCwd = cwd ?? null;
  const existingCache = readPersistentCache(metadata.cachePath);
  const cache = existingCache?.cwd === cacheCwd ? existingCache : {
    version: GIT_CACHE_SCHEMA_VERSION,
    cwd: cacheCwd,
    entries: {}
  };
  cache.entries[cacheKey] = entry;
  writePersistentCache(metadata.cachePath, cache);
}
function createCacheEntry(output, metadata, now) {
  return {
    output,
    createdAt: now,
    headMtimeMs: metadata?.headMtimeMs ?? null,
    indexMtimeMs: metadata?.indexMtimeMs ?? null
  };
}
function resolveGitCwd(context) {
  const candidates = [
    context.data?.cwd,
    context.data?.workspace?.current_dir,
    context.data?.workspace?.project_dir
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return void 0;
}
function runGit(command, context) {
  const args = command.trim().split(/\s+/).filter(Boolean);
  return runGitArgs(args, context, command);
}
function runGitArgs(args, context, cacheCommand) {
  const cwd = resolveGitCwd(context);
  const cacheToken = cacheCommand ?? args.join("\0");
  const memoryCacheKey = `${cacheToken}|${cwd ?? ""}`;
  const persistentCacheKey = cacheToken;
  const metadata = getGitRepoMetadata(cwd);
  const ttlMs = getGitCacheTtlMs(context);
  const now = Date.now();
  const memoryEntry = gitCommandCache.get(memoryCacheKey);
  if (memoryEntry && isCacheEntryFresh(memoryEntry, metadata, ttlMs, now)) {
    return memoryEntry.output;
  }
  const persistentEntry = readPersistentCacheEntry(metadata, persistentCacheKey, cwd, ttlMs, now);
  if (persistentEntry) {
    gitCommandCache.set(memoryCacheKey, persistentEntry);
    return persistentEntry.output;
  }
  try {
    const output = execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      timeout: GIT_COMMAND_TIMEOUT_MS,
      windowsHide: true,
      ...cwd ? { cwd } : {}
    }).trimEnd();
    const result = output.length > 0 ? output : null;
    const entry = createCacheEntry(result, metadata, now);
    gitCommandCache.set(memoryCacheKey, entry);
    writePersistentCacheEntry(metadata, persistentCacheKey, cwd, entry);
    return result;
  } catch {
    const entry = createCacheEntry(null, metadata, now);
    gitCommandCache.set(memoryCacheKey, entry);
    writePersistentCacheEntry(metadata, persistentCacheKey, cwd, entry);
    return null;
  }
}
function isInsideGitWorkTree(context) {
  return runGit("rev-parse --is-inside-work-tree", context) === "true";
}
function parseDiffShortStat(stat) {
  const insertMatch = /(\d+)\s+insertions?/.exec(stat);
  const deleteMatch = /(\d+)\s+deletions?/.exec(stat);
  return {
    insertions: insertMatch?.[1] ? parseInt(insertMatch[1], 10) : 0,
    deletions: deleteMatch?.[1] ? parseInt(deleteMatch[1], 10) : 0
  };
}
function getGitChangeCounts(context) {
  const unstagedStat = runGit("diff --shortstat", context) ?? "";
  const stagedStat = runGit("diff --cached --shortstat", context) ?? "";
  const unstagedCounts = parseDiffShortStat(unstagedStat);
  const stagedCounts = parseDiffShortStat(stagedStat);
  return {
    insertions: unstagedCounts.insertions + stagedCounts.insertions,
    deletions: unstagedCounts.deletions + stagedCounts.deletions
  };
}
function hasRenameOrCopyStatus(line) {
  return line.startsWith("R") || line.startsWith("C") || line[1] === "R" || line[1] === "C";
}
function getGitStatus(context) {
  const output = runGit("status --porcelain -z", context);
  if (!output) {
    return { staged: false, unstaged: false, untracked: false, conflicts: false };
  }
  let staged = false;
  let unstaged = false;
  let untracked = false;
  let conflicts = false;
  const entries = output.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const line = entries[index];
    if (typeof line !== "string" || line.length < 2)
      continue;
    if (!conflicts && /^(DD|AU|UD|UA|DU|AA|UU)/.test(line))
      conflicts = true;
    if (!staged && /^[MADRCTU]/.test(line))
      staged = true;
    if (!unstaged && /^.[MADRCTU]/.test(line))
      unstaged = true;
    if (!untracked && line.startsWith("??"))
      untracked = true;
    if (staged && unstaged && untracked && conflicts)
      break;
    if (hasRenameOrCopyStatus(line)) {
      index += 1;
    }
  }
  return { staged, unstaged, untracked, conflicts };
}
function getGitFileStatusCounts(context) {
  const output = runGit("status --porcelain -z", context);
  if (!output) {
    return { staged: 0, unstaged: 0, untracked: 0 };
  }
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  const entries = output.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const line = entries[index];
    if (typeof line !== "string" || line.length < 2)
      continue;
    if (line.startsWith("??")) {
      untracked += 1;
    } else {
      if (/^[MADRCTU]/.test(line))
        staged += 1;
      if (/^.[MADRCTU]/.test(line))
        unstaged += 1;
    }
    if (hasRenameOrCopyStatus(line)) {
      index += 1;
    }
  }
  return { staged, unstaged, untracked };
}
function getGitAheadBehind(context) {
  const output = runGit("rev-list --left-right --count HEAD...@{upstream}", context);
  if (!output)
    return null;
  const parts = output.split(/\s+/);
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return null;
  const ahead = parseInt(parts[0], 10);
  const behind = parseInt(parts[1], 10);
  if (isNaN(ahead) || isNaN(behind))
    return null;
  return { ahead, behind };
}
function getGitConflictCount(context) {
  const output = runGit("ls-files --unmerged", context);
  if (!output)
    return 0;
  const files = new Set(output.split("\n").map((line) => {
    const parts = line.split(/\s+/).slice(3);
    return parts.join(" ");
  }).filter((path3) => path3.length > 0));
  return files.size;
}
function getGitShortSha(context) {
  return runGit("rev-parse --short HEAD", context);
}

// src/utils/git-remote.ts
function parseRemoteUrl(url) {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const sshMatch = !trimmed.includes("://") ? /^(?:[^@]+@)?([^:]+):(.+?)(?:\.git)?\/?$/.exec(trimmed) : null;
  if (sshMatch?.[1] && sshMatch[2]) {
    const pathSegments = sshMatch[2].split("/").filter(Boolean);
    const repo = pathSegments.at(-1);
    const owner = pathSegments.slice(0, -1).join("/");
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
    const supportedProtocols = /* @__PURE__ */ new Set(["http:", "https:", "ssh:", "git:"]);
    if (!supportedProtocols.has(parsedUrl.protocol)) {
      return null;
    }
    const pathname = parsedUrl.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    const segments = pathname.split("/").filter(Boolean);
    const repo = segments.at(-1);
    const owner = segments.slice(0, -1).join("/");
    if (!owner || !repo) {
      return null;
    }
    return {
      host: parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:" ? parsedUrl.host : parsedUrl.hostname,
      owner,
      repo
    };
  } catch {
    return null;
  }
}
function getRemoteInfo(remoteName, context) {
  const url = runGitArgs(["remote", "get-url", "--", remoteName], context, `remote get-url -- ${remoteName}`);
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
function getTrackingRemoteName(context) {
  const upstreamRef = runGit("rev-parse --abbrev-ref --symbolic-full-name @{upstream}", context);
  if (!upstreamRef) {
    return null;
  }
  const remotes = listRemotes(context).slice().sort((left, right) => right.length - left.length);
  return remotes.find((remote) => upstreamRef === remote || upstreamRef.startsWith(`${remote}/`)) ?? null;
}
function getUpstreamRemoteInfo(context) {
  const namedUpstream = getRemoteInfo("upstream", context);
  if (namedUpstream) {
    return namedUpstream;
  }
  const trackingRemoteName = getTrackingRemoteName(context);
  if (!trackingRemoteName) {
    return null;
  }
  return getRemoteInfo(trackingRemoteName, context);
}
function getForkStatus(context) {
  const origin = getRemoteInfo("origin", context);
  const upstream = getRemoteInfo("upstream", context);
  const isFork = Boolean(
    origin && upstream && (origin.owner !== upstream.owner || origin.repo !== upstream.repo)
  );
  return {
    isFork,
    origin,
    upstream
  };
}
function listRemotes(context) {
  const output = runGit("remote", context);
  if (!output) {
    return [];
  }
  return output.split("\n").filter(Boolean);
}
function buildRepoWebUrl(remote) {
  return `https://${remote.host}/${remote.owner}/${remote.repo}`;
}
function buildBranchWebUrl(remote, encodedBranch) {
  return `${buildRepoWebUrl(remote)}/tree/${encodedBranch}`;
}

// src/utils/git-review-cache.ts
function readField(entry, key) {
  const value = entry[key];
  return typeof value === "string" ? value.toUpperCase() : "";
}
function classifyCheck(entry) {
  if (typeof entry.status === "string") {
    if (entry.status.toUpperCase() !== "COMPLETED")
      return "pending";
    const conclusion = readField(entry, "conclusion");
    if (conclusion === "SUCCESS")
      return "success";
    if (conclusion === "NEUTRAL" || conclusion === "SKIPPED")
      return "ignored";
    return "failed";
  }
  const state = readField(entry, "state");
  if (state === "SUCCESS")
    return "success";
  if (state === "PENDING" || state === "EXPECTED")
    return "pending";
  return "failed";
}
function computeCiRollup(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0)
    return null;
  let failing = 0;
  let pending = 0;
  let success = 0;
  let seen = 0;
  for (const entry of rollup) {
    if (typeof entry !== "object" || entry === null)
      continue;
    seen++;
    const kind = classifyCheck(entry);
    if (kind === "failed")
      failing++;
    else if (kind === "pending")
      pending++;
    else if (kind === "success")
      success++;
  }
  if (seen === 0)
    return null;
  const state = failing > 0 ? "failing" : pending > 0 ? "pending" : "passing";
  return { state, failing, pending, success };
}
var GIT_REVIEW_CACHE_TTL = 3e4;
var CLI_TIMEOUT = 5e3;
var REFRESH_LOCK_STALE_MS = 3e4;
var DEFAULT_TITLE_MAX_WIDTH = 30;
var GH_PR_METADATA_FIELDS = "url,number,title,state,reviewDecision";
var GH_PR_WITH_CHECKS_FIELDS = `${GH_PR_METADATA_FIELDS},statusCheckRollup`;
var GIT_REVIEW_REFRESH_FLAG = "--internal-refresh-git-review-cache";
var refreshScriptPath;
function setGitReviewRefreshScript(scriptPath) {
  refreshScriptPath = scriptPath;
}
var DEFAULT_GIT_REVIEW_CACHE_DEPS = {
  closeSync,
  execFileSync: execFileSync2,
  existsSync,
  getExecPath: () => process.execPath,
  mkdirSync: mkdirSync2,
  openSync,
  readFileSync: readFileSync2,
  getScriptPath: () => refreshScriptPath,
  spawn,
  statSync: statSync2,
  unlinkSync: unlinkSync2,
  writeFileSync: writeFileSync2,
  getHomedir: os2.homedir,
  now: Date.now
};
function getCacheDir2(deps) {
  return path2.join(deps.getHomedir(), ".cache", "ccstatusline");
}
function getGitReviewCacheDir(deps) {
  return path2.join(getCacheDir2(deps), "git-review");
}
function runGitForCache(args, cwd, deps) {
  try {
    return deps.execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      cwd,
      timeout: CLI_TIMEOUT,
      windowsHide: true
    }).trim();
  } catch {
    return "";
  }
}
function getCurrentBranch(cwd, deps) {
  const branch = runGitForCache(["symbolic-ref", "--short", "HEAD"], cwd, deps);
  return branch.length > 0 ? branch : null;
}
function getCacheRef(cwd, deps) {
  const branch = getCurrentBranch(cwd, deps);
  if (branch) {
    return `branch:${branch}`;
  }
  const head = runGitForCache(["rev-parse", "--short", "HEAD"], cwd, deps);
  if (head.length > 0) {
    return `head:${head}`;
  }
  return "unknown";
}
function getCachePath2(cwd, ref, deps) {
  const hash = createHash2("sha256").update(cwd).update("\0").update(ref).digest("hex").slice(0, 16);
  return path2.join(getGitReviewCacheDir(deps), `git-review-${hash}.json`);
}
function isGitReviewData(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value;
  return typeof candidate.number === "number" && typeof candidate.url === "string";
}
function decodeCache(content) {
  if (content.length === 0) {
    return { data: null, checksQueried: true };
  }
  const parsed = JSON.parse(content);
  if (typeof parsed === "object" && parsed !== null) {
    const stored = parsed;
    if (stored.version === 1 && typeof stored.checksQueried === "boolean" && (stored.data === null || isGitReviewData(stored.data))) {
      return {
        data: stored.data,
        checksQueried: stored.data === null || stored.checksQueried
      };
    }
  }
  if (isGitReviewData(parsed)) {
    return {
      data: parsed,
      checksQueried: parsed.checks !== void 0
    };
  }
  return "miss";
}
function readCache(cachePath, deps) {
  try {
    if (!deps.existsSync(cachePath)) {
      return "miss";
    }
    const age = deps.now() - deps.statSync(cachePath).mtimeMs;
    const content = deps.readFileSync(cachePath, "utf-8").trim();
    const decoded = decodeCache(content);
    if (decoded === "miss") {
      return "miss";
    }
    return {
      ...decoded,
      stale: age > GIT_REVIEW_CACHE_TTL
    };
  } catch {
    return "miss";
  }
}
function writeCache(cachePath, data, checksQueried, deps) {
  try {
    const cacheDir = getGitReviewCacheDir(deps);
    if (!deps.existsSync(cacheDir)) {
      deps.mkdirSync(cacheDir, { recursive: true });
    }
    const stored = {
      version: 1,
      data,
      checksQueried: data === null || checksQueried
    };
    deps.writeFileSync(cachePath, JSON.stringify(stored), "utf-8");
  } catch {
  }
}
function getOriginUrl(cwd, deps) {
  const url = runGitForCache(["remote", "get-url", "--", "origin"], cwd, deps);
  return url.length > 0 ? url : null;
}
function isSshRemoteUrl(url) {
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith("ssh://") || !trimmed.includes("://");
}
function resolveSshHostAlias(host, deps) {
  try {
    const output = deps.execFileSync("ssh", ["-G", host], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: CLI_TIMEOUT,
      windowsHide: true
    }).trim();
    for (const line of output.split(/\r?\n/)) {
      const match = /^hostname\s+(.+)$/i.exec(line.trim());
      if (match?.[1]) {
        return match[1].toLowerCase();
      }
    }
  } catch {
  }
  return host.toLowerCase();
}
function getNamedForgeProvider(host) {
  if (host.includes("github")) {
    return "gh";
  }
  if (host.includes("gitlab")) {
    return "glab";
  }
  return null;
}
function getEffectiveRemoteHost(url, host, deps) {
  const normalizedHost = host.toLowerCase();
  if (!isSshRemoteUrl(url) || getNamedForgeProvider(normalizedHost)) {
    return normalizedHost;
  }
  return resolveSshHostAlias(normalizedHost, deps);
}
function getOriginHost(cwd, deps) {
  const url = getOriginUrl(cwd, deps);
  if (!url) {
    return null;
  }
  const parsed = parseRemoteUrl(url);
  return parsed ? getEffectiveRemoteHost(url, parsed.host, deps) : null;
}
function toHttpsRepoRef(url, deps) {
  const parsed = parseRemoteUrl(url);
  if (!parsed) {
    return null;
  }
  return `https://${getEffectiveRemoteHost(url, parsed.host, deps)}/${parsed.owner}/${parsed.repo}`;
}
function getOriginRepoRef(cwd, deps) {
  const url = getOriginUrl(cwd, deps);
  return url ? toHttpsRepoRef(url, deps) : null;
}
function getProviderCandidates(cwd, deps) {
  const host = getOriginHost(cwd, deps);
  if (!host) {
    return ["gh", "glab"];
  }
  const namedForgeProvider = getNamedForgeProvider(host);
  if (namedForgeProvider) {
    return [namedForgeProvider];
  }
  const authed = [];
  if (isCliAuthedForHost("glab", host, deps)) {
    authed.push("glab");
  }
  if (isCliAuthedForHost("gh", host, deps)) {
    authed.push("gh");
  }
  return authed;
}
var GitReviewDeadlineError = class extends Error {
};
function getRemainingTimeout(deadline, deps) {
  const remaining = deadline - deps.now();
  if (remaining <= 0) {
    throw new GitReviewDeadlineError("Git review lookup deadline exceeded");
  }
  return Math.max(1, Math.min(CLI_TIMEOUT, remaining));
}
function isCliAvailable(cli, deadline, deps) {
  try {
    deps.execFileSync(cli, ["--version"], {
      stdio: ["pipe", "pipe", "ignore"],
      timeout: getRemainingTimeout(deadline, deps),
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}
function isCliAuthedForHost(cli, host, deps) {
  try {
    deps.execFileSync(cli, ["auth", "status", "--hostname", host], {
      stdio: ["pipe", "pipe", "ignore"],
      timeout: CLI_TIMEOUT,
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}
function mapGlabState(state) {
  if (state === "opened")
    return "OPEN";
  if (state === "closed")
    return "CLOSED";
  if (state === "merged")
    return "MERGED";
  if (state === "locked")
    return "LOCKED";
  return state.toUpperCase();
}
function errorText(error) {
  if (!(error instanceof Error)) {
    return "";
  }
  const stderr = "stderr" in error ? error.stderr : void 0;
  const stderrText = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : stderr ?? "";
  return `${error.message}
${stderrText}`.toLowerCase();
}
function isCiFieldUnavailableError(error) {
  const text = errorText(error);
  return text.includes("statuscheckrollup") || text.includes("resource not accessible by integration");
}
function queryGhPr(cwd, args, fields, deadline, deps) {
  const output = deps.execFileSync(
    "gh",
    [...args, "--json", fields],
    {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      timeout: getRemainingTimeout(deadline, deps),
      windowsHide: true
    }
  ).trim();
  if (output.length === 0) {
    return null;
  }
  return JSON.parse(output);
}
function fetchFromGh(cwd, repoRef, includeChecks, deadline, deps) {
  const args = ["pr", "view"];
  if (repoRef) {
    const branch = getCurrentBranch(cwd, deps);
    if (!branch) {
      return null;
    }
    args.push(branch, "--repo", repoRef);
  }
  let parsed;
  if (includeChecks) {
    try {
      parsed = queryGhPr(cwd, args, GH_PR_WITH_CHECKS_FIELDS, deadline, deps);
    } catch (error) {
      if (!isCiFieldUnavailableError(error)) {
        throw error;
      }
      parsed = queryGhPr(cwd, args, GH_PR_METADATA_FIELDS, deadline, deps);
    }
  } else {
    parsed = queryGhPr(cwd, args, GH_PR_METADATA_FIELDS, deadline, deps);
  }
  if (!parsed) {
    return null;
  }
  if (typeof parsed.number !== "number" || typeof parsed.url !== "string") {
    return null;
  }
  return {
    number: parsed.number,
    url: parsed.url,
    title: typeof parsed.title === "string" ? parsed.title : "",
    state: typeof parsed.state === "string" ? parsed.state : "",
    reviewDecision: typeof parsed.reviewDecision === "string" ? parsed.reviewDecision : "",
    provider: "gh",
    checks: computeCiRollup(parsed.statusCheckRollup) ?? void 0
  };
}
function fetchFromGlab(cwd, repoRef, deadline, deps) {
  const args = ["mr", "view"];
  if (repoRef) {
    const branch = getCurrentBranch(cwd, deps);
    if (!branch) {
      return null;
    }
    args.push(branch, "--repo", repoRef);
  }
  args.push("--output", "json");
  const output = deps.execFileSync(
    "glab",
    args,
    {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      cwd,
      timeout: getRemainingTimeout(deadline, deps),
      windowsHide: true
    }
  ).trim();
  if (output.length === 0) {
    return null;
  }
  const parsed = JSON.parse(output);
  if (typeof parsed.iid !== "number" || typeof parsed.web_url !== "string") {
    return null;
  }
  return {
    number: parsed.iid,
    url: parsed.web_url,
    title: typeof parsed.title === "string" ? parsed.title : "",
    state: typeof parsed.state === "string" ? mapGlabState(parsed.state) : "",
    reviewDecision: "",
    provider: "glab"
  };
}
function fetchFromProvider(provider, cwd, repoRef, includeChecks, deadline, deps) {
  const fetch = (targetRepoRef) => provider === "gh" ? fetchFromGh(cwd, targetRepoRef, includeChecks, deadline, deps) : fetchFromGlab(cwd, targetRepoRef, deadline, deps);
  try {
    const unpinned = fetch(null);
    if (unpinned) {
      return unpinned;
    }
  } catch {
  }
  if (repoRef) {
    return fetch(repoRef);
  }
  return null;
}
function fetchGitReviewData(cwd, deps = DEFAULT_GIT_REVIEW_CACHE_DEPS, options = {}) {
  const includeChecks = options.includeChecks ?? false;
  const cachePath = getCachePath2(cwd, getCacheRef(cwd, deps), deps);
  const cached = readCache(cachePath, deps);
  if (cached !== "miss" && !cached.stale && (!includeChecks || cached.checksQueried)) {
    return cached.data;
  }
  const repoRef = getOriginRepoRef(cwd, deps);
  const deadline = deps.now() + CLI_TIMEOUT;
  for (const provider of getProviderCandidates(cwd, deps)) {
    if (!isCliAvailable(provider, deadline, deps)) {
      continue;
    }
    try {
      const data = fetchFromProvider(provider, cwd, repoRef, includeChecks, deadline, deps);
      if (data) {
        writeCache(cachePath, data, includeChecks, deps);
        return data;
      }
    } catch {
    }
  }
  if (cached !== "miss" && cached.data !== null) {
    return cached.data;
  }
  writeCache(cachePath, null, true, deps);
  return null;
}
function getRefreshLockPath(cachePath) {
  return `${cachePath}.lock`;
}
function releaseRefreshLock(lockPath, deps) {
  try {
    deps.unlinkSync(lockPath);
  } catch {
  }
}
function createRefreshLock(cachePath, deps) {
  const cacheDir = getGitReviewCacheDir(deps);
  try {
    if (!deps.existsSync(cacheDir)) {
      deps.mkdirSync(cacheDir, { recursive: true });
    }
  } catch {
    return null;
  }
  const lockPath = getRefreshLockPath(cachePath);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const descriptor = deps.openSync(lockPath, "wx");
      deps.closeSync(descriptor);
      return lockPath;
    } catch {
      try {
        const age = deps.now() - deps.statSync(lockPath).mtimeMs;
        if (age <= REFRESH_LOCK_STALE_MS) {
          return null;
        }
        deps.unlinkSync(lockPath);
      } catch {
        return null;
      }
    }
  }
  return null;
}
function scheduleRefresh(cwd, cachePath, includeChecks, deps) {
  const scriptPath = deps.getScriptPath();
  if (!scriptPath) {
    return;
  }
  const lockPath = createRefreshLock(cachePath, deps);
  if (!lockPath) {
    return;
  }
  try {
    const child = deps.spawn(
      deps.getExecPath(),
      [
        scriptPath,
        GIT_REVIEW_REFRESH_FLAG,
        cwd,
        includeChecks ? "checks" : "metadata",
        lockPath
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      }
    );
    child.unref();
  } catch {
    releaseRefreshLock(lockPath, deps);
  }
}
function getCachedGitReviewData(cwd, options = {}, deps = DEFAULT_GIT_REVIEW_CACHE_DEPS) {
  const includeChecks = options.includeChecks ?? false;
  const cachePath = getCachePath2(cwd, getCacheRef(cwd, deps), deps);
  const cached = readCache(cachePath, deps);
  const needsRefresh = cached === "miss" || cached.stale || includeChecks && !cached.checksQueried;
  if (needsRefresh) {
    scheduleRefresh(cwd, cachePath, includeChecks, deps);
  }
  return cached === "miss" ? null : cached.data;
}
function refreshGitReviewCacheFromCli(cwd, options, lockPath, deps = DEFAULT_GIT_REVIEW_CACHE_DEPS) {
  const expectedLockPath = getRefreshLockPath(
    getCachePath2(cwd, getCacheRef(cwd, deps), deps)
  );
  try {
    fetchGitReviewData(cwd, deps, options);
  } finally {
    if (lockPath === expectedLockPath) {
      releaseRefreshLock(lockPath, deps);
    }
  }
}
function getGitReviewStatusLabel(state, reviewDecision) {
  if (state === "MERGED")
    return "MERGED";
  if (state === "CLOSED")
    return "CLOSED";
  if (reviewDecision === "APPROVED")
    return "APPROVED";
  if (reviewDecision === "CHANGES_REQUESTED")
    return "CHANGES_REQ";
  if (state === "OPEN")
    return "OPEN";
  return state;
}
function truncateTitle(title, maxWidth) {
  const limit = maxWidth ?? DEFAULT_TITLE_MAX_WIDTH;
  if (title.length <= limit)
    return title;
  return `${title.slice(0, limit - 1)}\u2026`;
}

export {
  resolveGitCwd,
  runGit,
  isInsideGitWorkTree,
  getGitChangeCounts,
  getGitStatus,
  getGitFileStatusCounts,
  getGitAheadBehind,
  getGitConflictCount,
  getGitShortSha,
  getRemoteInfo,
  getUpstreamRemoteInfo,
  getForkStatus,
  buildRepoWebUrl,
  buildBranchWebUrl,
  GIT_REVIEW_REFRESH_FLAG,
  setGitReviewRefreshScript,
  getCachedGitReviewData,
  refreshGitReviewCacheFromCli,
  getGitReviewStatusLabel,
  truncateTitle
};
