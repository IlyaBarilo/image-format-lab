import { execFileSync } from 'node:child_process';

// Accept one to four numeric parts or SemVer, optionally prefixed with v.
// Keep the selected tag verbatim; never guess from nearby tags or add a patch.
const number = '(?:0|[1-9][0-9]*)';
const prerelease = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
const releaseTagPattern = new RegExp(`^v?${number}\\.${number}\\.${number}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
const numericReleaseTagPattern = new RegExp(`^v?${number}(?:\\.${number}){0,3}$`);

export function releaseVersion({ release = false, tag = null } = {}) {
  if (!release) {
    if (tag !== null) throw new Error('--tag requires --release');
    return null;
  }
  if (typeof tag !== 'string' || !(releaseTagPattern.test(tag) || numericReleaseTagPattern.test(tag))) throw new Error('Release requires an explicit version tag, for example --tag=v1, --tag=v0.1, --tag=v0.1.0 or --tag=v0.1.2.3');
  return tag;
}

// The public CLI validates checkout before bundling. The in-memory build API
// also serves tests and does not require a Git repository.
export function verifyReleaseCheckout(tag, cwd, { runGit = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } = {}) {
  releaseVersion({ release: true, tag });
  const git = revision => runGit(['rev-parse', '--verify', revision]).trim();
  let head, tagged;
  try {
    head = git('HEAD^{commit}');
    tagged = git('refs/tags/' + tag + '^{commit}');
  } catch {
    throw new Error('Release requires a Git checkout with HEAD and the selected tag: ' + tag);
  }
  if (head !== tagged) throw new Error('Selected release tag does not match HEAD: ' + tag);
  let main;
  try { main = git('refs/remotes/origin/main^{commit}'); }
  catch {
    try { main = git('refs/heads/main^{commit}'); }
    catch { throw new Error('Release requires the main branch history'); }
  }
  try { runGit(['merge-base', '--is-ancestor', tagged, main]); }
  catch { throw new Error('Selected release tag does not belong to main: ' + tag); }
}
