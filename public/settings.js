import { createCatalogEditor, normalizeCatalog } from './catalog-editor.js';

const $ = (selector) => document.querySelector(selector);
const state = { config: null, catalog: null, editor: null };
const setStatus = (message, type = '') => { const node = $('#catalogStatus'); node.textContent = message; node.className = `status ${type}`; };

async function loadConfig() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('Could not load server configuration.');
  state.config = await response.json();
  state.catalog = normalizeCatalog(state.config.catalog);
  $('#modeBadge').textContent = state.config.dryRun ? 'DRY-RUN · API not called' : 'LIVE · API enabled';
  state.editor = createCatalogEditor({ catalog: state.catalog, spuRoot: '#spuEditorRoot', sizeRoot: '#sizeEditorRoot', variantRoot: '#variantEditorRoot' });
}

function sync() { state.catalog = state.editor.sync(); return state.catalog; }

$('#addSpuButton').addEventListener('click', () => { state.editor.addSpu(); state.catalog = state.editor.catalog; document.querySelector('#spuEditorRoot [data-spu-card]:last-child input')?.focus(); });
$('#addSizeMappingButton').addEventListener('click', () => { state.editor.addSizeMapping(); state.catalog = state.editor.catalog; document.querySelector('#sizeEditorRoot [data-size-group]:last-child [data-field="size-product"]')?.focus(); });
$('#addVariantRuleButton').addEventListener('click', () => { state.editor.addVariantRule(); state.catalog = state.editor.catalog; document.querySelector('#variantEditorRoot [data-variant-rule]:last-child [data-field="variant-spu"]')?.focus(); });
$('#spuEditorRoot').addEventListener('click', (event) => { const button = event.target.closest('[data-action="remove-spu"]'); if (!button) return; state.editor.removeSpu(Number(button.dataset.index)); state.catalog = state.editor.catalog; });
$('#sizeEditorRoot').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const groupIndex = Number(button.dataset.group ?? button.dataset.index);
  if (button.dataset.action === 'remove-size-group') state.editor.removeSizeGroup(groupIndex);
  if (button.dataset.action === 'add-size-row') state.editor.addSizeRow(groupIndex);
  if (button.dataset.action === 'remove-size-row') state.editor.removeSizeRow(groupIndex, Number(button.dataset.index));
  state.catalog = state.editor.catalog;
});
$('#variantEditorRoot').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="remove-variant-rule"]');
  if (!button) return;
  state.editor.removeVariantRule(Number(button.dataset.index));
  state.catalog = state.editor.catalog;
});
$('#variantImportInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const status = $('#variantImportStatus');
  status.textContent = 'Reading the successful export…';
  status.className = 'editor-help';
  try {
    const form = new FormData();
    form.append('export', file);
    const response = await fetch('/api/catalog/variant-rules/import', { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not read the export file.');
    state.editor.addVariantRules(data.rules);
    state.catalog = state.editor.catalog;
    const skipped = data.skipped?.length ? ` ${data.skipped.length} row(s) could not be read.` : '';
    status.textContent = `Added ${data.rules.length} Product_Code rule(s) as drafts.${skipped} Review them, then click Save configuration.`;
    status.className = `editor-help ${data.skipped?.length ? 'warning-text' : 'success-text'}`;
  } catch (error) {
    status.textContent = error.message;
    status.className = 'editor-help error-text';
  } finally {
    event.target.value = '';
  }
});
$('#saveCatalogButton').addEventListener('click', async () => {
  try {
    sync();
    setStatus('Saving configuration to the server…');
    const response = await fetch('/api/catalog-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalog: state.catalog }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save configuration.');
    state.catalog = normalizeCatalog(data.catalog);
    state.editor.setCatalog(state.catalog);
    setStatus('Saved on the server. This configuration is shared across browsers.', 'success');
  } catch (error) { setStatus(`Could not save configuration: ${error.message}`, 'error'); }
});
$('#resetCatalogButton').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/catalog-config');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load configuration.');
    state.catalog = normalizeCatalog(data.catalog);
    state.editor.setCatalog(state.catalog);
    setStatus('Reloaded the configuration currently stored on the server.', 'success');
  } catch (error) { setStatus(`Could not reload configuration: ${error.message}`, 'error'); }
});

loadConfig().catch((error) => setStatus(error.message, 'error'));
