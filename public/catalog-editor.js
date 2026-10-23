export function normalizeCatalog(catalog) {
  return {
    spus: Array.isArray(catalog?.spus) ? catalog.spus : [],
    sizeMappings: catalog?.sizeMappings && typeof catalog.sizeMappings === 'object' ? catalog.sizeMappings : {},
    colorMappings: catalog?.colorMappings || {},
    variantMappings: catalog?.variantMappings || {},
    variantRules: Array.isArray(catalog?.variantRules) ? catalog.variantRules : [],
    defaultSizeRules: Array.isArray(catalog?.defaultSizeRules) ? catalog.defaultSizeRules : []
  };
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const uniqueDraftKey = (prefix) => `__new_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export function createCatalogEditor({ catalog, spuRoot, sizeRoot, variantRoot, defaultSizeRoot }) {
  let current = normalizeCatalog(catalog);
  const spuNode = document.querySelector(spuRoot);
  const sizeNode = document.querySelector(sizeRoot);
  const variantNode = variantRoot ? document.querySelector(variantRoot) : null;
  const defaultSizeNode = defaultSizeRoot ? document.querySelector(defaultSizeRoot) : null;

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
        <div class="size-header"><div class="editor-field"><label>SKU prefixes or product code in PDF</label><input data-field="size-product" value="${escapeHtml(productCode.startsWith('__new_product_') ? '' : productCode)}" placeholder="Example: GF, JS" /><div class="editor-help">Use GF, JS to share this mapping across prefixes. Exact product codes still work.</div></div><button class="text-button" type="button" data-action="remove-size-group" data-index="${groupIndex}">Remove mapping</button></div>
        <div class="size-rows">${rows.map(([source, target], rowIndex) => `<div class="size-row" data-size-row="${rowIndex}"><div class="editor-field"><label>Size in PDF</label><input data-field="size-source" value="${escapeHtml(source.startsWith('__new_size_') ? '' : source)}" placeholder="Example: 4.5x4.5x2.7" /></div><div class="editor-field"><label>Printbelle size</label><input data-field="size-target" value="${escapeHtml(target)}" placeholder="Example: Large" /></div><button class="text-button" type="button" data-action="remove-size-row" data-group="${groupIndex}" data-index="${rowIndex}">Remove</button></div>`).join('')}</div>
        <button class="button secondary compact size-add-row" type="button" data-action="add-size-row" data-group="${groupIndex}">+ Add size</button>
      </div>`;
    }).join('') : '<div class="empty-editor">No size mappings yet. Click “+ Add product” to create one.</div>';

    if (variantNode) {
      const rules = current.variantRules || [];
      const groups = new Map();
      rules.forEach((rule, index) => {
        const groupKey = rule.spu?.trim() || '__no_spu__';
        const group = groups.get(groupKey) || [];
        group.push({ rule, index });
        groups.set(groupKey, group);
      });
      variantNode.innerHTML = groups.size ? [...groups.entries()].map(([groupKey, group]) => `<details class="variant-spu-group"${groupKey === '__no_spu__' ? ' open' : ''}>
        <summary><span>${escapeHtml(groupKey === '__no_spu__' ? 'SPU not set' : groupKey)}</span><span class="variant-group-count">${group.length} rule${group.length === 1 ? '' : 's'}</span></summary>
        <div class="variant-group-body">${group.map(({ rule, index }) => `<div class="variant-row" data-variant-rule="${index}">
          <div class="editor-field"><label>SPU</label><input data-field="variant-spu" value="${escapeHtml(rule.spu)}" placeholder="ULCNP" /></div>
          <div class="editor-field"><label>SKU prefixes <span class="optional">optional</span></label><input data-field="variant-prefix" value="${escapeHtml(rule.skuPrefix)}" placeholder="GF, JS" /><div class="editor-help">Separate prefixes with commas.</div></div>
          <div class="editor-field"><label>Printbelle size <span class="optional">optional</span></label><input data-field="variant-size" value="${escapeHtml(rule.size)}" placeholder="5.8X8.5INCH" /><div class="editor-help">If the PDF has no size, a unique rule can still supply this size.</div></div>
          <div class="editor-field"><label>Printbelle color <span class="optional">optional</span></label><input data-field="variant-color" value="${escapeHtml(rule.color)}" placeholder="Pink" /></div>
          <div class="editor-field variant-code-field"><label>Output Product_Code</label><input data-field="variant-code" value="${escapeHtml(rule.productCode)}" placeholder="ULCNP-Pink/5.8X8.5INCH" /></div>
          <button class="text-button" type="button" data-action="remove-variant-rule" data-index="${index}">Remove</button>
        </div>`).join('')}</div>
      </details>`).join('') : '<div class="empty-editor">No Product_Code rules yet. Import a successful export or add one manually.</div>';
    }

    if (defaultSizeNode) {
      const rules = current.defaultSizeRules || [];
      defaultSizeNode.innerHTML = rules.length ? rules.map((rule, index) => `<div class="default-size-row" data-default-size-rule="${index}">
        <div class="editor-field"><label>SKU prefixes</label><input data-field="default-size-prefix" value="${escapeHtml(rule.skuPrefix)}" placeholder="EJ-7, GF" /></div>
        <div class="editor-field"><label>Default Printbelle size</label><input data-field="default-size-value" value="${escapeHtml(rule.size)}" placeholder="5.8X8.5INCH" /></div>
        <button class="text-button" type="button" data-action="remove-default-size-rule" data-index="${index}">Remove</button>
      </div>`).join('') : '<div class="empty-editor">No default size rules yet.</div>';
    }
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
    if (variantNode) {
      next.variantRules = [...variantNode.querySelectorAll('[data-variant-rule]')].map((row) => ({
        spu: row.querySelector('[data-field="variant-spu"]')?.value.trim() || '',
        skuPrefix: row.querySelector('[data-field="variant-prefix"]')?.value.trim() || '',
        size: row.querySelector('[data-field="variant-size"]')?.value.trim() || '',
        color: row.querySelector('[data-field="variant-color"]')?.value.trim() || '',
        productCode: row.querySelector('[data-field="variant-code"]')?.value.trim() || ''
      })).filter((rule) => rule.spu || rule.skuPrefix || rule.size || rule.color || rule.productCode);
    }
    if (defaultSizeNode) {
      next.defaultSizeRules = [...defaultSizeNode.querySelectorAll('[data-default-size-rule]')].map((row) => ({
        skuPrefix: row.querySelector('[data-field="default-size-prefix"]')?.value.trim() || '',
        size: row.querySelector('[data-field="default-size-value"]')?.value.trim() || ''
      })).filter((rule) => rule.skuPrefix || rule.size);
    }
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
  function addVariantRule(rule = {}) { sync(); current.variantRules.push({ spu: rule.spu || '', skuPrefix: rule.skuPrefix || '', size: rule.size || '', color: rule.color || '', productCode: rule.productCode || '' }); render(); }
  function removeVariantRule(index) { sync(); current.variantRules.splice(index, 1); render(); }
  function addDefaultSizeRule(rule = {}) { sync(); current.defaultSizeRules.push({ skuPrefix: rule.skuPrefix || '', size: rule.size || '' }); render(); }
  function removeDefaultSizeRule(index) { sync(); current.defaultSizeRules.splice(index, 1); render(); }
  function addVariantRules(rules) {
    sync();
    const existing = new Set(current.variantRules.map((rule) => [rule.spu, rule.skuPrefix, rule.size, rule.color, rule.productCode].map((value) => String(value || '').trim().toLowerCase()).join('|')));
    for (const rule of rules || []) {
      const normalized = { spu: rule.spu || '', skuPrefix: rule.skuPrefix || '', size: rule.size || '', color: rule.color || '', productCode: rule.productCode || '' };
      const key = [normalized.spu, normalized.skuPrefix, normalized.size, normalized.color, normalized.productCode].map((value) => String(value || '').trim().toLowerCase()).join('|');
      if (normalized.spu && normalized.productCode && !existing.has(key)) { current.variantRules.push(normalized); existing.add(key); }
    }
    render();
  }

  render();
  return { render, sync, setCatalog, addSpu, removeSpu, addSizeMapping, removeSizeGroup, addSizeRow, removeSizeRow, addVariantRule, removeVariantRule, addVariantRules, addDefaultSizeRule, removeDefaultSizeRule, get catalog() { return current; } };
}
