import { createRequire as __pistatuslineCreateRequire } from 'node:module';
import { fileURLToPath as __pistatuslineFileURLToPath } from 'node:url';
import { dirname as __pistatuslineDirname } from 'node:path';
const require = __pistatuslineCreateRequire(import.meta.url);
const __filename = __pistatuslineFileURLToPath(import.meta.url);
const __dirname = __pistatuslineDirname(__filename);
import {
  GIT_REVIEW_REFRESH_FLAG,
  refreshGitReviewCacheFromCli
} from "./chunks/chunk-O45YDVGT.js";
import "./chunks/chunk-LJD3VXDT.js";

// src/pi/git-review-refresh.ts
var flagIndex = process.argv.indexOf(GIT_REVIEW_REFRESH_FLAG);
var [cwd, mode, lockPath] = process.argv.slice(flagIndex + 1);
if (flagIndex !== -1 && cwd && (mode === "metadata" || mode === "checks") && lockPath) {
  refreshGitReviewCacheFromCli(cwd, { includeChecks: mode === "checks" }, lockPath);
}
