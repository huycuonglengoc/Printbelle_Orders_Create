const state = { config: null, orders: [], preview: [], catalog: null };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const setStatus = (selector, message, type = '') => { const node = $(selector); node.textContent = message; node.className = `status ${type}`; };
async function getConfig() {
  const response = await fetch('/api/config');
  state.config = await response.json();
  state.catalog = state.config.catalog;
  $('#modeBadge').textContent = state.config.dryRun ? 'DRY-RUN · API not called' : 'LIVE · API enabled';
}

function refreshOrderSpuOptions() { if (state.orders.length) { readFormState(); renderOrders(); } }

function renderOrders() {
  const spus = state.catalog?.spus || [];
  $('#ordersRoot').innerHTML = state.orders.map((order, orderIndex) => `
    <article class="order-card" data-order-index="${orderIndex}">
      <div class="order-head"><div><h3>${escapeHtml(order.shippingName || 'Unnamed customer')} <span class="muted">· #${escapeHtml(order.orderNumber)}</span></h3><small>${escapeHtml(order.city)}, ${escapeHtml(order.province)} ${escapeHtml(order.zip)} · User ${escapeHtml(order.userId)}</small></div><span class="order-state ${order.errors?.length ? 'error-state' : ''}">${order.errors?.length ? 'SKIPPED' : `ORDER ${String(orderIndex + 1).padStart(2,'0')}`}</span></div>
      <div class="order-body">
        <div class="order-grid">
          ${field('shippingAddress1','Address',order.shippingAddress1, orderIndex)}
          ${field('shippingAddress2','Address 2',order.shippingAddress2, orderIndex)}
          ${field('city','City',order.city, orderIndex)}
          ${field('province','State',order.province, orderIndex)}
          ${field('zip','ZIP',order.zip, orderIndex)}
          ${field('countryCode','Country',order.countryCode || 'US', orderIndex)}
        </div>
        ${(order.items || []).map((item, itemIndex) => itemMarkup(item, orderIndex, itemIndex, spus)).join('')}
        <div class="artwork-list">Artwork: ${(order.artworks || []).map((file) => `<span class="artwork-chip">${escapeHtml(file.filename)}</span>`).join('') || '<span class="warning-field">no matching files</span>'}${order.items?.length === 1 && order.artworks?.length > 1 ? `<div class="bulk-note">One item · ${order.artworks.length} artworks · quantity ${order.items[0].quantity}</div>` : ''}${order.errors?.length ? `<div class="error-list">${order.errors.map((error) => escapeHtml(error.message || error)).join('<br>')}</div>` : ''}</div>
      </div>
    </article>`).join('');
}
function field(key, label, value, orderIndex) { return `<div class="field"><label>${label}</label><input data-order="${orderIndex}" data-key="${key}" value="${escapeHtml(value)}" /></div>`; }
function itemMarkup(item, orderIndex, itemIndex, spus) {
  const options = spus.map((entry) => `<option value="${escapeHtml(entry.spu)}" ${entry.spu === (item.spu || '') ? 'selected' : ''}>${escapeHtml(entry.name)}${entry.spu ? ` — ${escapeHtml(entry.spu)}` : ''}</option>`).join('');
  return `<div class="item-row" data-order="${orderIndex}" data-item="${itemIndex}">
    <div class="field wide"><label>Product / source</label><input data-item-key="title" value="${escapeHtml(item.title)}" /><small>${escapeHtml(item.productCodeSource)} · qty ${item.quantity}</small></div>
    <div class="field"><label>SPU</label><select data-item-key="spu"><option value="">— select —</option>${options}<option value="__custom__">Other SPU…</option></select></div>
    <div class="field"><label>Target size</label><input data-item-key="sizeTarget" class="${item.sizeRaw && !item.sizeTarget ? 'warning-field' : ''}" placeholder="${escapeHtml(item.sizeRaw || 'None')}" value="${escapeHtml(item.sizeTarget || '')}" /></div>
    <div class="field"><label>Color</label><input data-item-key="colorTarget" value="${escapeHtml(item.colorTarget || item.color || '')}" /></div>
    <div class="field"><label>Artwork qty</label><input data-item-key="quantity" type="number" min="1" value="${item.quantity}" /></div>
  </div>`;
}

function readFormState() {
  document.querySelectorAll('[data-order][data-key]').forEach((input) => { state.orders[Number(input.dataset.order)][input.dataset.key] = input.value; });
  document.querySelectorAll('.item-row').forEach((row) => {
    const item = state.orders[Number(row.dataset.order)].items[Number(row.dataset.item)];
    row.querySelectorAll('[data-item-key]').forEach((input) => { item[input.dataset.itemKey] = input.value; });
    if (item.spu === '__custom__') item.spu = prompt('Enter Printbelle SPU:', '') || '';
  });
}

function renderPreview() {
  $('#previewRoot').innerHTML = state.preview.map((entry) => `<article class="payload-card ${entry.skipped ? 'payload-error' : ''}"><header><span>${escapeHtml(entry.order.shippingName)} · ${escapeHtml(entry.order.orderNumber)}</span><span>${entry.skipped ? 'SKIPPED' : (entry.warnings.length ? `${entry.warnings.length} warning(s)` : 'READY')}</span></header><pre>${escapeHtml(JSON.stringify(entry.payload, null, 2))}</pre>${entry.errors?.length ? `<div class="payload-errors">${entry.errors.map((error) => escapeHtml(error.message || error)).join('\n')}</div>` : ''}${entry.warnings.length ? `<div style="padding:0 15px 13px;color:#ffc28f;font:11px 'DM Mono',monospace">${entry.warnings.map(escapeHtml).join('\n')}</div>` : ''}</article>`).join('');
  $('#previewPanel').classList.remove('hidden');
  $('#previewPanel').scrollIntoView({ behavior:'smooth', block:'start' });
}

function renderSubmitResults(data) {
  const rows = [
    ...(data.results || []).map((entry) => ({
      orderId: entry.orderId,
      status: entry.ok ? 'SUBMITTED' : 'FAILED',
      detail: entry.ok ? JSON.stringify(entry.result, null, 2) : `${entry.error}${entry.details ? `\n${JSON.stringify(entry.details, null, 2)}` : ''}`
    })),
    ...(data.duplicates || []).map((entry) => ({ orderId: entry.orderId, status: 'DUPLICATE SKIPPED', detail: entry.message }))
  ];
  $('#submitResults').innerHTML = rows.map((row) => `<article class="submit-result ${row.status === 'SUBMITTED' ? 'result-ok' : 'result-error'}"><header><strong>${escapeHtml(row.orderId)}</strong><span>${escapeHtml(row.status)}</span></header><pre>${escapeHtml(row.detail)}</pre></article>`).join('');
}

$('#pdfInput').addEventListener('change', (event) => { $('#pdfLabel').textContent = event.target.files[0]?.name || 'Choose input.pdf'; });
$('#artworkInput').addEventListener('change', (event) => { $('#artworkLabel').textContent = event.target.files.length ? `${event.target.files.length} artwork files selected` : 'Choose artwork'; });
$('#uploadForm').addEventListener('submit', async (event) => {
  event.preventDefault(); setStatus('#parseStatus', 'Reading PDF and matching artwork…');
  try { const response = await fetch('/api/parse', { method:'POST', body:new FormData(event.currentTarget) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); state.orders=data.orders; renderOrders(); $('#reviewPanel').classList.remove('hidden'); $('#reviewPanel').scrollIntoView({behavior:'smooth'}); setStatus('#parseStatus', `Read ${state.orders.length} order(s).`, 'success'); } catch (error) { setStatus('#parseStatus', error.message, 'error'); }
});
$('#previewButton').addEventListener('click', async () => { readFormState(); setStatus('#reviewStatus','Building payload preview…'); try { const response=await fetch('/api/orders/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orders:state.orders,catalog:state.catalog})}); const data=await response.json(); if(!response.ok) throw new Error(data.error); state.preview=data.orders; renderPreview(); setStatus('#reviewStatus','Payload preview is ready.','success'); } catch(error) { setStatus('#reviewStatus',error.message,'error'); } });
$('#submitButton').addEventListener('click', () => { $('#previewButton').click(); });
$('#exportImportButton').addEventListener('click', async () => { readFormState(); setStatus('#exportStatus','Preparing Excel import file with R2 artwork URLs…'); try { const response=await fetch('/api/orders/export-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orders:state.orders,catalog:state.catalog})}); if(!response.ok) { const data=await response.json().catch(()=>({})); throw new Error(data.error || 'Could not export the import workbook.'); } const blob=await response.blob(); const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download=response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1] || 'printbelle-order-import.xlsx'; link.click(); URL.revokeObjectURL(url); const rows=response.headers.get('x-printbelle-exported-rows') || '0'; const skipped=response.headers.get('x-printbelle-skipped-orders') || '0'; setStatus('#exportStatus',`Excel export complete: ${rows} row(s). Skipped ${skipped} invalid order(s).`,'success'); } catch(error) { setStatus('#exportStatus',error.message,'error'); } });
$('#confirmSubmitButton').addEventListener('click', async () => { if(!$('#confirmInput').checked) { setStatus('#submitStatus','Please confirm the checkbox before submitting.','error'); return; } readFormState(); $('#submitResults').innerHTML = ''; setStatus('#submitStatus',state.config.dryRun?'Running dry-run…':'Checking existing orders, then submitting to Printbelle…'); try { const response=await fetch('/api/orders/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orders:state.orders,catalog:state.catalog,confirm:true})}); const data=await response.json(); if(!response.ok) throw new Error(data.error); renderSubmitResults(data); const skippedText = data.skipped?.length ? ` Skipped ${data.skipped.length} invalid order(s).` : ''; const failedText = data.results?.filter((entry) => entry.ok === false).length ? ` ${data.results.filter((entry) => entry.ok === false).length} API order(s) failed.` : ''; setStatus('#submitStatus',(data.dryRun?'Dry-run complete — no real orders were submitted.':data.duplicates?.length?'Submission finished; duplicate order(s) were skipped.':'Order submission finished.') + skippedText + failedText, failedText ? 'error' : 'success'); } catch(error) { setStatus('#submitStatus',error.message,'error'); } });
getConfig().catch((error) => setStatus('#parseStatus',`Could not load configuration: ${error.message}`,'error'));
