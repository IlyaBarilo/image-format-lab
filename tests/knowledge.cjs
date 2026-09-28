const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const { buildKnowledge, knowledgeFiles, validateKnowledgeTargets } = await import('../scripts/knowledge.mjs');
  const { FORMAT_DEFS } = await import('../src/core/config.mjs');
  const data = buildKnowledge(root);
  const topics = new Set(data.pages.flatMap(page => page.sections.map(section => page.id + '#' + section.id)));
  assert.equal(data.pages.length, 28);
  assert.deepEqual(new Set(Object.keys(FORMAT_DEFS)).difference(new Set(Object.keys(data.formatKnowledge))), new Set());
  for (const [format, page] of Object.entries(data.formatKnowledge)) assert.ok(topics.has(page + '#overview'), format);
  const viewer = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  const analysisOptions = [...viewer.match(/<select[^>]*id="analysisType"[^>]*>([\s\S]*?)<\/select>/)[1]
    .matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(new Set(analysisOptions).difference(new Set(Object.keys(data.analysisKnowledge))), new Set());
  for (const [mode, target] of Object.entries(data.analysisKnowledge)) assert.ok(topics.has(target), mode);
  const diagrams = [];
  for (const page of data.pages) {
    assert.ok(page.sections.length >= 2, page.id);
    const blocks = page.sections.flatMap(section => section.blocks);
    diagrams.push(...blocks.filter(block => block.type === 'diagram').map(block => block.id));
    const parts = blocks.flatMap(block => block.type === 'paragraph' ? block.parts : block.type === 'list' ? block.items.flat() : []);
    if (!page.id.startsWith('workflow/') && page.id !== 'analysis/tradeoff')
      assert.ok(parts.some(part => part.url), page.id + ' needs an external source');
    assert.ok(parts.every(part => !part.url || part.url.startsWith('https://')));
  }
  assert.deepEqual(new Set(diagrams), new Set(['chroma', 'histogram-waveform', 'analysis-area']));
  const sources = Object.fromEntries(['src/index.html', 'src/ui/controls.mjs', 'src/ui/knowledge.mjs'].map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]));
  validateKnowledgeTargets(data, sources);
  assert.throws(() => validateKnowledgeTargets(data, { sample: '<button data-knowledge-target="formats/jpeg#missing">' }), /Broken context help target/);
  for (const file of knowledgeFiles) assert.ok(file.startsWith('docs/knowledge/'));
  const html = fs.readFileSync(path.join(root, 'image-format-lab.html'), 'utf8');
  const embedded = JSON.parse(html.match(/id="embedded-knowledge">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded, data);
  assert.ok(html.includes('id="knowledgeDialog"') && html.includes('id="knowledgeSearch"'));
  console.log('PASS 28 offline knowledge pages, format and analysis coverage, diagrams and context targets');
})().catch(error => { console.error(error); process.exitCode = 1; });
