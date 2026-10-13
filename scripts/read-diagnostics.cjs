const fs = require('node:fs');
(async () => {
  const { unpackDiagnostics } = await import('../src/core/diagnostic-transport.mjs');
  const file = process.argv[2];
  if (!file) throw new Error('Укажите путь к диагностическому TXT-файлу.');
  process.stdout.write(unpackDiagnostics(fs.readFileSync(file, 'utf8')));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
