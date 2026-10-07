import fs from 'node:fs';
import path from 'node:path';
import { FORMAT_KNOWLEDGE, ANALYSIS_KNOWLEDGE, HELP_OPERATIONS } from '../src/core/knowledge-targets.mjs';

// Explicit inputs keep local/ and unrelated documents outside the build.
export const knowledgeFiles = [
  'docs/knowledge/formats/jpeg.md',
  'docs/knowledge/formats/png.md',
  'docs/knowledge/formats/webp.md',
  'docs/knowledge/formats/avif.md',
  'docs/knowledge/formats/heic.md',
  'docs/knowledge/formats/jpeg-xl.md',
  'docs/knowledge/formats/jpeg-2000.md',
  'docs/knowledge/formats/tiff.md',
  'docs/knowledge/formats/gif.md',
  'docs/knowledge/formats/bmp.md',
  'docs/knowledge/formats/ico.md',
  'docs/knowledge/concepts/compression.md',
  'docs/knowledge/concepts/quality.md',
  'docs/knowledge/concepts/chroma.md',
  'docs/knowledge/concepts/bit-depth.md',
  'docs/knowledge/concepts/alpha.md',
  'docs/knowledge/concepts/color-profile.md',
  'docs/knowledge/concepts/metrics.md',
  'docs/knowledge/analysis/histograms.md',
  'docs/knowledge/analysis/spatial.md',
  'docs/knowledge/analysis/color.md',
  'docs/knowledge/analysis/differences.md',
  'docs/knowledge/analysis/tradeoff.md',
  'docs/knowledge/workflow/start.md',
  'docs/knowledge/workflow/operations.md',
  'docs/knowledge/workflow/comparison.md',
  'docs/knowledge/workflow/inspection.md',
  'docs/knowledge/workflow/experiments.md',
  'docs/knowledge/workflow/batch.md'
];

export const formatKnowledge = FORMAT_KNOWLEDGE;
export const analysisKnowledge = ANALYSIS_KNOWLEDGE;

const diagramIds = new Set(['chroma', 'histogram-waveform', 'analysis-area']);
export const hintsFile = 'docs/knowledge/hints.json';

const fileById = new Map(knowledgeFiles.map(file => [file.slice('docs/knowledge/'.length, -3), file]));
const idByFile = new Map([...fileById].map(([id, file]) => [file, id]));
const heading = /^## (.+) \{#([a-z][a-z0-9-]*)\}$/;
const linkPattern = /\[([^\]\n]+)\]\(([^()\s]+)\)|\[\[([a-z][a-z0-9-]*)\|([^\]\n]+)\]\]/g;

function inline(text, source, targets, termIds) {
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(linkPattern)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    const [, label, href, termId, termLabel] = match;
    if (termId) {
      if (!termIds.has(termId)) throw new Error(`Unknown knowledge term in ${source}: ${termId}`);
      parts.push({ text: termLabel, term: termId });
    } else if (href.startsWith('https://')) {
      const url = new URL(href);
      if (url.username || url.password) throw new Error(`Invalid knowledge URL in ${source}: ${href}`);
      parts.push({ text: label, url: url.href });
    } else {
      const [file, anchor = 'overview', extra] = href.split('#');
      if (extra || !file.endsWith('.md')) throw new Error(`Invalid knowledge link in ${source}: ${href}`);
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), file));
      const id = idByFile.get(resolved);
      if (!id) throw new Error(`Unknown knowledge page in ${source}: ${href}`);
      const target = `${id}#${anchor}`;
      targets.push({ source, target });
      parts.push({ text: label, target });
    }
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  if (parts.some(part => /\[|\]\(/.test(part.text))) throw new Error(`Unsupported Markdown link in ${source}`);
  return parts;
}

function parsePage(source, markdown, targets, termIds) {
  const id = idByFile.get(source), lines = markdown.replace(/\r\n?/g, '\n').trim().split('\n');
  if (!id || !/^# [^#]/.test(lines[0])) throw new Error(`Missing knowledge title: ${source}`);
  const group = id.startsWith('formats/') ? 'Форматы' : id.startsWith('concepts/') ? 'Понятия'
    : id.startsWith('analysis/') ? 'Анализ' : 'Работа в программе';
  const page = { id, title: lines[0].slice(2).trim(), group, sections: [] };
  let section = null, paragraph = [], list = [];
  function flush() {
    if (paragraph.length) { section.blocks.push({ type: 'paragraph', parts: inline(paragraph.join(' '), source, targets, termIds) }); paragraph = []; }
    if (list.length) { section.blocks.push({ type: 'list', items: list.map(item => inline(item, source, targets, termIds)) }); list = []; }
  }
  for (const line of lines.slice(1).concat('')) {
    const match = heading.exec(line);
    if (match) {
      if (section) flush();
      if (page.sections.some(item => item.id === match[2])) throw new Error(`Duplicate knowledge section in ${source}: ${match[2]}`);
      section = { id: match[2], title: match[1], blocks: [] };
      page.sections.push(section);
    } else if (!line.trim()) {
      if (section) flush();
    } else if (!section) throw new Error(`Knowledge text before first section: ${source}`);
    else if (line.startsWith('::diagram ')) {
      flush();
      const diagram = line.slice('::diagram '.length);
      if (!diagramIds.has(diagram)) throw new Error(`Unknown knowledge diagram in ${source}: ${diagram}`);
      section.blocks.push({ type: 'diagram', id: diagram });
    }
    else if (line.startsWith('- ')) {
      if (paragraph.length) flush();
      list.push(line.slice(2));
    } else if (/^#|^\s|<|>|^::/.test(line)) throw new Error(`Unsupported Markdown syntax in ${source}: ${line}`);
    else {
      if (list.length) flush();
      paragraph.push(line);
    }
  }
  if (!page.sections.length || page.sections[0].id !== 'overview') throw new Error(`Knowledge page needs #overview: ${source}`);
  return page;
}

export function buildKnowledge(root) {
  const targets = [];
  const hints = JSON.parse(fs.readFileSync(path.join(root, hintsFile), 'utf8'));
  for (const category of ['terms', 'controls']) {
    if (!Array.isArray(hints[category])) throw new Error(`Missing knowledge hints: ${category}`);
    const ids = new Set();
    for (const item of hints[category]) {
      if (!/^[a-z][a-z0-9-]*$/.test(item.id) && !(category === 'controls' && /^[a-z][A-Za-z0-9]*$/.test(item.id)))
        throw new Error(`Invalid knowledge hint ID: ${item.id}`);
      if (ids.has(item.id) || !item.text?.trim()) throw new Error(`Duplicate or empty knowledge hint: ${item.id}`);
      ids.add(item.id);
    }
  }
  const termIds = new Set(hints.terms.map(item => item.id));
  const pages = knowledgeFiles.map(source => parsePage(source, fs.readFileSync(path.join(root, source), 'utf8'), targets, termIds));
  const pageById = new Map(pages.map(page => [page.id, page]));
  for (const { source, target } of targets) {
    const [id, anchor] = target.split('#');
    if (!pageById.get(id)?.sections.some(section => section.id === anchor)) throw new Error(`Broken knowledge link in ${source}: ${target}`);
  }
  for (const [format, id] of Object.entries(formatKnowledge)) {
    if (!pageById.has(id)) throw new Error(`Missing format knowledge for ${format}`);
  }
  const topics = new Set(pages.flatMap(page => page.sections.map(section => `${page.id}#${section.id}`)));
  for (const code of Object.keys(HELP_OPERATIONS)) {
    if (!topics.has(`workflow/operations#${code}`)) throw new Error(`Missing help operation: ${code}`);
  }
  for (const term of hints.terms) if (term.target && !topics.has(term.target)) throw new Error(`Broken knowledge hint target: ${term.id}`);
  for (const [mode, target] of Object.entries(analysisKnowledge)) {
    if (!topics.has(target)) throw new Error(`Missing analysis knowledge for ${mode}: ${target}`);
  }
  return { pages, formatKnowledge, analysisKnowledge, hints };
}

export function validateKnowledgeTargets(data, sources) {
  const topics = new Set(data.pages.flatMap(page => page.sections.map(section => `${page.id}#${section.id}`)));
  for (const [name, source] of Object.entries(sources)) {
    const targets = [
      ...[...source.matchAll(/data-knowledge-target="([^"]+)"/g)].map(match => match[1]),
      ...[...source.matchAll(/['"]((?:formats|concepts|analysis|workflow)\/[a-z0-9/-]+#[a-z0-9-]+)['"]/g)].map(match => match[1])
    ];
    for (const target of targets) if (!topics.has(target)) throw new Error(`Broken context help target in ${name}: ${target}`);
  }
  if (sources['src/index.html']) for (const hint of data.hints.controls) {
    if (!sources['src/index.html'].includes(`id="${hint.id}"`)) throw new Error(`Missing hinted control: ${hint.id}`);
  }
  if (sources['src/index.html']) for (const operation of Object.values(HELP_OPERATIONS)) {
    for (const id of [operation.control, operation.fallback].filter(Boolean)) {
      if (!sources['src/index.html'].includes(`id="${id}"`)) throw new Error(`Missing operation control: ${id}`);
    }
  }
}
