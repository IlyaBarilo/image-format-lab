// The build supplies validated, text-only Markdown blocks. No page text is HTML.
export function createKnowledge() {
  let data, current = '', opener = null;
  const backStack = [];
  const $ = id => document.getElementById(id);

  function readData() {
    if (!data) data = JSON.parse($('embedded-knowledge').textContent);
    return data;
  }
  function targetParts(target) {
    const [id, section = 'overview'] = String(target || '').split('#');
    const page = readData().pages.find(item => item.id === id);
    if (!page || !page.sections.some(item => item.id === section)) throw new Error('Раздел справки не найден: ' + target);
    return { page, section };
  }
  function partsElement(parts) {
    const span = document.createElement('span');
    for (const part of parts) {
      if (part.url) {
        const link = document.createElement('a');
        link.textContent = part.text; link.href = part.url;
        link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', part.text + ' — внешний сайт, нужен интернет');
        span.append(link);
      } else if (part.target) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'knowledge-inline-link';
        button.textContent = part.text;
        button.addEventListener('click', () => navigate(part.target));
        span.append(button);
      } else span.append(document.createTextNode(part.text));
    }
    return span;
  }
  function renderPage(target) {
    const { page, section } = targetParts(target), article = $('knowledgeContent');
    const heading = document.createElement('h3'); heading.textContent = page.title;
    article.replaceChildren(heading);
    for (const item of page.sections) {
      const sectionEl = document.createElement('section');
      sectionEl.id = 'knowledge-' + page.id.replace('/', '-') + '-' + item.id;
      const title = document.createElement('h4'); title.textContent = item.title;
      sectionEl.append(title);
      for (const block of item.blocks) {
        if (block.type === 'paragraph') {
          const p = document.createElement('p'); p.append(partsElement(block.parts)); sectionEl.append(p);
        } else {
          const ul = document.createElement('ul');
          for (const parts of block.items) { const li = document.createElement('li'); li.append(partsElement(parts)); ul.append(li); }
          sectionEl.append(ul);
        }
      }
      article.append(sectionEl);
    }
    $('knowledgeCurrent').textContent = page.group + ' / ' + page.title;
    $('knowledgeBack').disabled = !backStack.length;
    renderIndex();
    const active = article.querySelector('#knowledge-' + page.id.replace('/', '-') + '-' + section);
    requestAnimationFrame(() => active?.scrollIntoView({ block: 'start' }));
  }
  function renderIndex() {
    const query = $('knowledgeSearch').value.trim().toLocaleLowerCase('ru');
    const list = $('knowledgeIndex'); list.replaceChildren();
    let count = 0, group = '';
    for (const page of readData().pages) {
      const text = [page.title, ...page.sections.flatMap(section => [section.title, ...section.blocks.flatMap(block => block.type === 'paragraph'
        ? block.parts.map(part => part.text) : block.items.flatMap(items => items.map(part => part.text)))])].join(' ').toLocaleLowerCase('ru');
      if (query && !text.includes(query)) continue;
      if (page.group !== group) {
        group = page.group;
        const heading = document.createElement('li');
        heading.className = 'knowledge-index-group'; heading.textContent = group;
        list.append(heading);
      }
      const item = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'knowledge-index-link';
      button.textContent = page.title;
      button.title = page.group;
      if (current.split('#')[0] === page.id) button.setAttribute('aria-current', 'page');
      button.addEventListener('click', () => navigate(page.id + '#overview'));
      item.append(button); list.append(item); count++;
    }
    $('knowledgeSearchStatus').textContent = query ? `Найдено тем: ${count}` : '';
  }
  function navigate(target, record = true) {
    targetParts(target);
    if (record && current && current !== target) backStack.push(current);
    current = target;
    renderPage(target);
  }
  function openKnowledge(target = 'concepts/compression#overview', trigger = document.activeElement) {
    const dialog = $('knowledgeDialog');
    if (!dialog.open) {
      opener = trigger;
      backStack.length = 0;
      $('knowledgeSearch').value = '';
      current = '';
      navigate(target, false);
      dialog.showModal();
      $('knowledgeCurrent').focus();
    } else navigate(target);
  }
  function attachKnowledgeEvents() {
    $('knowledgeBack').addEventListener('click', () => { if (backStack.length) navigate(backStack.pop(), false); });
    $('knowledgeSearch').addEventListener('input', renderIndex);
    $('knowledgeDialog').addEventListener('close', () => {
      if (opener?.isConnected) opener.focus();
      opener = null;
    });
    document.addEventListener('click', event => {
      const formatButton = event.target.closest?.('[data-knowledge-format-select]');
      if (formatButton) {
        event.preventDefault();
        const format = $(formatButton.dataset.knowledgeFormatSelect)?.value;
        openKnowledge(readData().formatKnowledge[format] + '#overview', formatButton);
        return;
      }
      const link = event.target.closest?.('[data-knowledge-target]');
      if (!link || !link.matches('button, a') || link.disabled) return;
      event.preventDefault();
      openKnowledge(link.dataset.knowledgeTarget, link);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'F1') return;
      const field = document.activeElement?.closest?.('[data-knowledge-target]');
      if (!field || field.disabled) return;
      event.preventDefault();
      const target = field.id === 'batchFormat'
        ? readData().formatKnowledge[field.value] + '#overview'
        : field.dataset.knowledgeTarget;
      openKnowledge(target, field);
    });
    for (const [id, target] of Object.entries({
      batchFormat: 'concepts/compression#overview', batchJpegSubsampling: 'concepts/chroma#overview',
      batchPngDepth: 'concepts/bit-depth#overview', batchPngMode: 'formats/png#parameters',
      batchBmpDepth: 'formats/bmp#parameters', batchTiffCompression: 'formats/tiff#parameters',
      batchQuality: 'concepts/quality#overview', tiffDepth: 'concepts/bit-depth#overview',
      tiffCompression: 'formats/tiff#parameters', tiffPredictor: 'formats/tiff#parameters'
    })) {
      const field = $(id);
      if (field) field.dataset.knowledgeTarget = target;
    }
  }
  return { attachKnowledgeEvents, openKnowledge };
}
