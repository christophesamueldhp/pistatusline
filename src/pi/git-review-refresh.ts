// Detached background refresh for the git-review / git-ci-status widgets: the entry point
// ccstatusline reaches by re-running its own CLI with this flag.
import {
    GIT_REVIEW_REFRESH_FLAG,
    refreshGitReviewCacheFromCli
} from '../utils/git-review-cache';

const flagIndex = process.argv.indexOf(GIT_REVIEW_REFRESH_FLAG);
const [cwd, mode, lockPath] = process.argv.slice(flagIndex + 1);
if (flagIndex !== -1 && cwd && (mode === 'metadata' || mode === 'checks') && lockPath) {
    refreshGitReviewCacheFromCli(cwd, { includeChecks: mode === 'checks' }, lockPath);
}
