// Legal text is displayed as plain text; it is never interpreted as HTML.
export function createLicenses(_context, deps) {
  function attachLicenseEvents() {
    const $ = id => document.getElementById(id);
    const dialog = $('licensesDialog'), content = $('licensesContent');
    const sourceLink = $('licensesSources'), heicLink = $('licensesHeicSources'), noticeButton = $('licensesDownload');
    let legal;
    function readLegal() {
      if (legal) return legal;
      const payload = JSON.parse($('embedded-codecs').textContent);
      const notices = JSON.parse($('embedded-notices').textContent);
      if (!payload.components?.components?.length || !payload.licenses || !payload.sourcePackages) throw new Error('В HTML отсутствует комплект уведомлений. Пересоберите приложение.');
      legal = { registry: payload.components, texts: { ...notices, ...payload.licenses }, packages: payload.sourcePackages, releaseTag: payload.releaseTag };
      return legal;
    }
    function element(tag, text, className) {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    }
    function textDetails(title, text) {
      const details = element('details');
      details.append(element('summary', title), element('pre', text));
      return details;
    }
    function render() {
      const data = readLegal();
      content.replaceChildren();
      $('licensesSummary').textContent = data.registry.summary;
      for (const item of data.registry.components) {
        const section = element('section', undefined, 'license-component');
        const version = item.id === 'viewer' ? data.releaseTag : item.version;
        section.append(element('h3', item.name + (version ? ' · ' + version : '')));
        section.append(element('p', item.scope + ' · ' + item.license, 'license-meta'));
        if (item.status === 'review') section.append(element('p', 'Оформление поставки требует уточнения', 'license-review'));
        section.append(element('p', item.notes));
        for (const source of item.sources) {
          // Source URLs are fixed metadata, validated again before creating links.
          if (!/^https:\/\//.test(source.url)) continue;
          const link = element('a', source.label);
          link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
          const paragraph = element('p');
          paragraph.append(link); section.append(paragraph);
        }
        for (const name of item.licenseFiles) {
          if (typeof data.texts[name] !== 'string') throw new Error('Отсутствует текст: ' + name);
          section.append(textDetails(name, data.texts[name]));
        }
        content.append(section);
      }
      content.append(textDetails('NOTICE.md — полный документ о компонентах', data.texts['NOTICE.md']));
      const descriptions = [];
      for (const [id, link] of [['gifenc', sourceLink], ['heic', heicLink]]) {
        const info = data.packages[id];
        if (!info?.name || !/^[a-f0-9]{64}$/.test(info.sha256)) throw new Error('Отсутствуют сведения об исходниках: ' + id);
        if (info.url !== null) {
          const url = new URL(info.url);
          if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Некорректная ссылка на исходники: ' + id);
          link.href = url.href; link.hidden = false;
        }
        descriptions.push(info.name + ' · SHA-256 ' + info.sha256 + (info.url ? '' : ' · адрес публикации не настроен'));
      }
      $('licensesSourceStatus').textContent = Object.values(data.packages).every(info => info.url)
        ? 'Исходники этого выпуска доступны по ссылкам выше. Для скачивания нужен интернет; для работы программы — нет.'
        : 'Локальная сборка: адреса исходников ещё не настроены. Отдельные ZIP подготовлены в vendor/ проекта. Перед публикацией выпуска необходимо разместить их и указать ссылки.';
      content.append(textDetails('Отдельные комплекты исходников: имена и контрольные суммы', descriptions.join('\n\n')));
      noticeButton.disabled = false;
    }
    $('licensesOpen').addEventListener('click', () => {
      $('licensesError').textContent = '';
      sourceLink.hidden = heicLink.hidden = noticeButton.disabled = true;
      sourceLink.removeAttribute('href'); heicLink.removeAttribute('href');
      $('licensesSourceStatus').textContent = '';
      try { render(); } catch (error) {
        sourceLink.hidden = heicLink.hidden = true;
        content.replaceChildren(); $('licensesError').textContent = error.message;
      }
      dialog.showModal();
    });
    noticeButton.addEventListener('click', () => {
      try {
        const data = readLegal();
        const text = Object.entries(data.texts).map(([name, body]) => name + '\n' + '='.repeat(60) + '\n' + body).join('\n\n');
        deps.downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'image-format-lab-licenses.txt');
      } catch (error) { $('licensesError').textContent = error.message; }
    });
  }
  return { attachLicenseEvents };
}
