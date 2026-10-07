// The build supplies validated, text-only Markdown blocks. No page text is HTML.
import { renderKnowledgeDiagram } from './knowledge-diagrams.mjs';
import { HELP_OPERATIONS, helpCodeFromHash } from '../core/knowledge-targets.mjs';
export function createKnowledge() {
  let data, current = '', opener = null;
  let openTerm = null;
  let highlighted = null, highlightTimer = null, pendingCode = null, guideGeneration = 0;
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
      } else if (part.term) {
        const hint = readData().hints.terms.find(item => item.id === part.term);
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'knowledge-term';
        button.setAttribute('aria-label', `${part.text}: ${hint.text}`);
        button.setAttribute('aria-expanded', 'false');
        button.append(document.createTextNode(part.text));
        const bubble = document.createElement('span');
        bubble.className = 'knowledge-term-tooltip'; bubble.textContent = hint.text;
        bubble.setAttribute('aria-hidden', 'true');
        button.append(bubble);
        const place = () => {
          const box = button.getBoundingClientRect?.();
          if (!box) return;
          bubble.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - 310))}px`;
          bubble.style.top = `${box.bottom + 7 > window.innerHeight - 90 ? Math.max(8, box.top - 86) : box.bottom + 7}px`;
        };
        button.addEventListener('mouseenter', place);
        button.addEventListener('focus', place);
        button.addEventListener('click', event => {
          event.stopPropagation?.();
          const expanded = button.getAttribute('aria-expanded') === 'true';
          closeTerm();
          if (!expanded) { place(); button.setAttribute('aria-expanded', 'true'); openTerm = button; }
        });
        span.append(button);
      } else span.append(document.createTextNode(part.text));
    }
    return span;
  }
  function closeTerm() {
    openTerm?.setAttribute('aria-expanded', 'false');
    openTerm = null;
  }
  function renderPage(target) {
    closeTerm();
    const { page, section } = targetParts(target), article = $('knowledgeContent');
    const heading = document.createElement('h3'); heading.textContent = page.title;
    article.replaceChildren(heading);
    for (const item of page.sections) {
      const sectionEl = document.createElement('section');
      sectionEl.id = 'knowledge-' + page.id.replace('/', '-') + '-' + item.id;
      const title = document.createElement('h4'); title.textContent = item.title;
      sectionEl.append(title);
      const operation = page.id === 'workflow/operations' && HELP_OPERATIONS[item.id];
      if (operation) {
        const show = document.createElement('button');
        show.type = 'button'; show.className = 'text-btn knowledge-show';
        show.textContent = 'Показать в интерфейсе';
        show.setAttribute('aria-label', 'Показать в интерфейсе: ' + operation.title);
        show.addEventListener('click', () => showOperation(item.id));
        sectionEl.append(show);
      }
      for (const block of item.blocks) {
        if (block.type === 'paragraph') {
          const p = document.createElement('p'); p.append(partsElement(block.parts)); sectionEl.append(p);
        } else if (block.type === 'diagram') sectionEl.append(renderKnowledgeDiagram(block.id));
        else {
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
        ? block.parts.map(part => part.text) : block.type === 'list'
          ? block.items.flatMap(items => items.map(part => part.text)) : [])])].join(' ').toLocaleLowerCase('ru');
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
      const code = Object.hasOwn(HELP_OPERATIONS, query) ? query : null;
      button.addEventListener('click', () => navigate(page.id + '#' + (page.id === 'workflow/operations' && code ? code : 'overview')));
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
  function openKnowledge(target = 'workflow/start#overview', trigger = document.activeElement) {
    clearHighlight();
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
  function clearHighlight() {
    guideGeneration++;
    if (highlightTimer !== null) clearTimeout(highlightTimer);
    highlighted?.classList.remove('knowledge-highlight');
    highlighted = null; highlightTimer = null;
    const notice = $('knowledgeGuide');
    if (notice) notice.hidden = true;
  }
  function otherDialogOpen() {
    return document.querySelector('dialog[open]:not(#knowledgeDialog)');
  }
  function showOperation(code) {
    const operation = HELP_OPERATIONS[code];
    if (!operation) return;
    if (otherDialogOpen()) {
      $('knowledgeActionStatus').textContent = 'Сначала закройте другое окно приложения, затем повторите переход из справки.';
      return;
    }
    clearHighlight();
    $('knowledgeDialog').close();
    // Only reveal the layout. Never select a format, change a region or start a download.
    if (operation.analysis && $('analysisBody').hidden) $('analysisBalance').click();
    const generation = guideGeneration;
    requestAnimationFrame(() => {
      if (generation !== guideGeneration || $('knowledgeDialog').open) return;
      const visible = element => element && !element.closest('[hidden], .hidden') && element.getBoundingClientRect().width > 0;
      let target = operation.control ? $(operation.control) : document.querySelector(operation.selector);
      let message = operation.title;
      if (!visible(target)) {
        target = $(operation.fallback || 'analysisType');
        message += '. ' + (operation.prerequisite || 'Верните отдельные окна кнопкой 2 в группе «Вид»; при скрытых изображениях выберите размер анализа «Баланс».');
      } else if (target.disabled) message += '. ' + (operation.prerequisite || 'Сначала откройте изображение и дождитесь готовности.');
      else message += '. Настройки изменяйте самостоятельно; Escape убирает подсказку.';
      if (visible(target)) {
        highlighted = target;
        target.classList.add('knowledge-highlight');
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (!target.disabled) target.focus({ preventScroll: true });
      }
      $('knowledgeGuideText').textContent = message;
      $('knowledgeGuide').hidden = false;
      highlightTimer = setTimeout(clearHighlight, 12000);
    });
  }
  function openAddressHelp() {
    pendingCode = helpCodeFromHash(globalThis.location?.hash);
    if (pendingCode && !otherDialogOpen()) {
      const code = pendingCode; pendingCode = null;
      openKnowledge('workflow/operations#' + code);
    }
  }
  function attachKnowledgeEvents() {
    for (const hint of readData().hints.controls) {
      const control = $(hint.id);
      if (control) {
        control.title = hint.text;
        control.setAttribute('aria-description', hint.text);
      }
    }
    $('knowledgeBack').addEventListener('click', () => { if (backStack.length) navigate(backStack.pop(), false); });
    $('knowledgeSearch').addEventListener('input', renderIndex);
    $('knowledgeGuideClose').addEventListener('click', clearHighlight);
    $('knowledgeDialog').addEventListener('close', () => {
      closeTerm();
      if (opener?.isConnected) opener.focus();
      opener = null;
      $('knowledgeActionStatus').textContent = '';
    });
    document.addEventListener('click', event => {
      if (!event.target.closest?.('.knowledge-term')) closeTerm();
      const analysisButton = event.target.closest?.('[data-knowledge-analysis-select]');
      if (analysisButton) {
        event.preventDefault();
        const mode = $(analysisButton.dataset.knowledgeAnalysisSelect)?.value;
        openKnowledge(readData().analysisKnowledge[mode], analysisButton);
        return;
      }
      const formatButton = event.target.closest?.('[data-knowledge-format-select]');
      if (formatButton) {
        event.preventDefault();
        const format = $(formatButton.dataset.knowledgeFormatSelect)?.value;
        openKnowledge(readData().formatKnowledge[format] + '#overview', formatButton);
        return;
      }
      const link = event.target.closest?.('[data-knowledge-target]');
      if (!link || !link.matches('button, a') || link.disabled || link.hasAttribute('data-knowledge-keyboard-only')) return;
      event.preventDefault();
      openKnowledge(link.dataset.knowledgeTarget, link);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('knowledgeGuide').hidden) { clearHighlight(); return; }
      if (event.key === 'Escape' && (openTerm || document.activeElement?.classList?.contains?.('knowledge-term'))) {
        event.preventDefault(); event.stopPropagation?.(); closeTerm(); document.activeElement?.blur?.(); return;
      }
      if (event.key !== 'F1') return;
      const field = document.activeElement?.closest?.('[data-knowledge-target]');
      if (!field || field.disabled) return;
      event.preventDefault();
      const target = field.id === 'analysisType' || field.id === 'analysisVariant'
        ? readData().analysisKnowledge[field.value]
        : field.id === 'batchFormat'
        ? readData().formatKnowledge[field.value] + '#overview'
        : field.dataset.knowledgeTarget;
      openKnowledge(target, field);
    });
    for (const [id, target] of Object.entries({
      batchFormat: 'concepts/compression#overview', batchJpegSubsampling: 'concepts/chroma#overview',
      batchPngDepth: 'concepts/bit-depth#overview', batchPngMode: 'formats/png#parameters',
      batchBmpDepth: 'formats/bmp#parameters', batchTiffCompression: 'formats/tiff#parameters',
      batchQuality: 'concepts/quality#overview', tiffDepth: 'concepts/bit-depth#overview',
      tiffCompression: 'formats/tiff#parameters', tiffPredictor: 'formats/tiff#parameters',
      analysisType: 'analysis/histograms#rgb', analysisVariant: 'analysis/histograms#rgb'
    })) {
      const field = $(id);
      if (field) field.dataset.knowledgeTarget = target;
    }
    globalThis.addEventListener?.('hashchange', openAddressHelp);
    document.addEventListener('close', () => {
      if (pendingCode && !otherDialogOpen()) openAddressHelp();
    }, true);
    requestAnimationFrame(openAddressHelp);
  }
  return { attachKnowledgeEvents, openKnowledge };
}
