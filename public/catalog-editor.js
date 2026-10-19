export function normalizeCatalog(catalog) {
  return {
    spus: Array.isArray(catalog?.spus) ? catalog.spus : [],
    sizeMappings: catalog?.sizeMappings && typeof catalog.sizeMappings === 'object' ? catalog.sizeMappings : {},
    colorMappings: catalog?.colorMappings || {},
    variantMappings: catalog?.variantMappings || {}
  };
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const uniqueDraftKey = (prefix) => `__new_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export function createCatalogEditor({ catalog, spuRoot, sizeRoot }) {
  let current = normalizeCatalog(catalog);
  const spuNode = document.querySelector(spuRoot);
  const sizeNode = document.querySelector(sizeRoot);

  function render() {
    const spus = current.spus || [];
    spuNode.innerHTML = spus.length ? spus.map((entry, index) => `<div class="editor-card" data-spu-card="${index}">
      <div class="editor-card-head"><strong>Product ${index + 1}</strong><button class="text-button" type="button" data-action="remove-spu" data-index="${index}">Remove</button></div>
      <div class="editor-grid">
        <div class="editor-field"><label>Display name</label><input data-field="spu-name" value="${escapeHtml(entry.name)}" placeholder="Example: Notebook" /></div>
        <div class="editor-field"><label>Printbelle SPU</label><input data-field="spu-code" value="${escapeHtml(entry.spu)}" placeholder="Example: ULCNP" /></div>
        <div class="editor-field"><label>SKU prefix</label><input data-field="spu-prefixes" value="${escapeHtml((entry.skuPrefixes || []).join(', '))}" placeholder="Example: GF, JS" /><div class="editor-help">GF matches GF-10, GF-20…</div></div>
        <div class="editor-field"><label>PDF keywords</label><input data-field="spu-aliases" value="${escapeHtml((entry.aliases || []).join(', '))}" placeholder="notebook, journal, ej-7" /><div class="editor-help">Separate values with commas.</div></div>
      </div>
    </div>`).join('') : '<div class="empty-editor">No SPUs yet. Click “+ Add SPU” to create one.</div>';

    const sizeGroups = Object.entries(current.sizeMappings || {});
    sizeNode.innerHTML = sizeGroups.length ? sizeGroups.map(([productCode, rules], groupIndex) => {
      const rows = Object.entries(rules || {});
      if (!rows.length) rows.push([uniqueDraftKey('size'), '']);
      return `<div class="editor-card size-group" data-size-group="${groupIndex}">
        <div class="size-header"><div class="editor-field"><label>Product code in PDF</label><input data-field="size-product" value="${escapeHtml(productCode.startsWith('__new_product_') ? '' : productCode)}" placeholder="Example: GF-10" /><div class="editor-help">This must match the product code read from the packing slip.</div></div><button class="text-button" type="button" data-action="remove-size-group" data-index="${groupIndex}">Remove product</button></div>
        <div class="size-rows">${rows.map(([source, target], rowIndex) => `<div class="size-row" data-size-row="${rowIndex}"><div class="editor-field"><label>Size in PDF</label><input data-field="size-source" value="${escapeHtml(source.startsWith('__new_size_') ? '' : source)}" placeholder="Example: 4.5x4.5x2.7" /></div><div class="editor-field"><label>Printbelle size</label><input data-field="size-target" value="${escapeHtml(target)}" placeholder="Example: Large" /></div><button class="text-button" type="button" data-action="remove-size-row" data-group="${groupIndex}" data-index="${rowIndex}">Remove</button></div>`).join('')}</div>
        <button class="button secondary compact size-add-row" type="button" data-action="add-size-row" data-group="${groupIndex}">+ Add size</button>
      </div>`;
    }).join('') : '<div class="empty-editor">No size mappings yet. Click “+ Add product” to create one.</div>';
  }

  function sync() {
    const next = normalizeCatalog(current);
    next.spus = [...spuNode.querySelectorAll('[data-spu-card]')].map((card) => ({
      name: card.querySelector('[data-field="spu-name"]')?.value.trim() || '',
      spu: card.querySelector('[data-field="spu-code"]')?.value.trim() || '',
      skuPrefixes: (card.querySelector('[data-field="spu-prefixes"]')?.value || '').split(',').map((prefix) => prefix.trim()).filter(Boolean),
      aliases: (card.querySelector('[data-field="spu-aliases"]')?.value || '').split(',').map((alias) => alias.trim()).filter(Boolean)
    })).filter((entry) => entry.name || entry.spu || entry.skuPrefixes.length || entry.aliases.length);
    next.sizeMappings = {};
    sizeNode.querySelectorAll('[data-size-group]').forEach((group) => {
      const productCode = group.querySelector('[data-field="size-product"]')?.value.trim();
      if (!productCode) return;
      const rules = {};
      group.querySelectorAll('.size-row').forEach((row) => {
        const source = row.querySelector('[data-field="size-source"]')?.value.trim();
        const target = row.querySelector('[data-field="size-target"]')?.value.trim();
        if (source && target) rules[source] = target;
      });
      next.sizeMappings[productCode] = rules;
    });
    current = next;
    return current;
  }

  function setCatalog(next) { current = normalizeCatalog(next); render(); }
  function addSpu() { sync(); current.spus.push({ name: '', spu: '', skuPrefixes: [], aliases: [] }); render(); }
  function removeSpu(index) { sync(); current.spus.splice(index, 1); render(); }
  function addSizeMapping() { sync(); current.sizeMappings[uniqueDraftKey('product')] = { [uniqueDraftKey('size')]: '' }; render(); }
  function removeSizeGroup(index) { sync(); const key = Object.keys(current.sizeMappings)[index]; delete current.sizeMappings[key]; render(); }
  function addSizeRow(groupIndex) { sync(); const key = Object.keys(current.sizeMappings)[groupIndex]; if (key) current.sizeMappings[key][uniqueDraftKey('size')] = ''; render(); }
  function removeSizeRow(groupIndex, rowIndex) { sync(); const key = Object.keys(current.sizeMappings)[groupIndex]; const sizeKey = Object.keys(current.sizeMappings[key] || {})[rowIndex]; if (key && sizeKey) delete current.sizeMappings[key][sizeKey]; render(); }

  render();
  return { render, sync, setCatalog, addSpu, removeSpu, addSizeMapping, removeSizeGroup, addSizeRow, removeSizeRow, get catalog() { return current; } };
}
