const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const runId = process.env.IMAGE_TEST_RUN_ID || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
if (!/^[a-z0-9_-]+$/i.test(runId)) throw new Error('Invalid test run identifier');
function folder(value) {
  const destination = path.resolve(root, value);
  const relative = path.relative(root, destination).replaceAll('\\', '/').toLowerCase();
  if (!/^(?:local\/)?test-results(?:\/|$)/.test(relative)) throw new Error('Test output must be under local/test-results or test-results');
  return destination;
}
module.exports = { runId, folder };
