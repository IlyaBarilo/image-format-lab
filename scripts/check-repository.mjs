import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function checkTrackedPaths(names) {
  const forbidden = /^(?:local(?:\/|$)|AGENTS\.md$|\.gitignore$|debug\.log$|node_modules\/|dist\/|test-results\/|playwright-report\/|photo\/|360\/|vnv\/|pexels\/|bg\.svg$|image-format-converter\.html$|web-image-formats-lecture[^/]*$|docs\/(?:ARTICLE_SOURCE_MESSAGES|ANALYSIS_PLAN|REPOSITORY)\.md$|docs\/verification(?:\/|$))/i;
  const excluded = names.filter(name => forbidden.test(name) || /(?:^|\/)node_modules(?:\/|$)/i.test(name));
  if (excluded.length) throw new Error('Excluded paths are tracked: ' + excluded.join(', '));
}

export function checkRepository(cwd, { allowBuiltHtml = false } = {}) {
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean);
  // Inspect names first. Never read contents of an excluded tracked path.
  checkTrackedPaths(git(['ls-files', '-z']));
  const changed = git(['diff', '--name-only', '-z', 'HEAD', '--']);
  if (changed.some(name => !allowBuiltHtml || name !== 'image-format-lab.html')) throw new Error('Tracked release inputs have changed: ' + changed.join(', '));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--built-html')) throw new Error('Unknown repository check option');
    checkRepository(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), { allowBuiltHtml: args.includes('--built-html') });
    console.log('PASS tracked publication paths and unchanged inputs');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
