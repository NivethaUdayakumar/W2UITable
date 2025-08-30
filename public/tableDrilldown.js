import { TableBuilder } from './tableBuilder.js';

export class Drilldown {
  constructor({
    mainCsv,
    container = '#grid',
    name = 'mainGrid',

    // MAIN columns the user can click to open B (1-based indices)
    selectableCols = [14, 15, 16, 17, 18, 19],

    // MAIN columns to combine to form the Level-B filename (1-based)
    mainKeyCols = [1, 2, 3, 4, 5, 6, 7],

    // B table columns to append to form the Level-C filename (1-based)
    bKeyCols = [1, 2, 3, 4, 5],

    // Where Level-B and Level-C CSVs are hosted
    childDir = './dataset',

    // Pass-throughs to your TableBuilder (optional)
    groupByIdx = [],
    statusIdx = 11, // Col12 (0-based)
    colorColsIdx = [],

    // Filename join separator
    sep = '_',

    // If true and a row’s C file is missing, open the FIRST B row’s C
    // If false, show an alert instead. Useful during early dataset stages.
    fallbackToFirstBRow = true,

    // Debug logs
    debug = true
  } = {}) {
    Object.assign(this, {
      mainCsv, container, name,
      selectableCols, mainKeyCols, bKeyCols,
      childDir, groupByIdx, statusIdx, colorColsIdx,
      sep, fallbackToFirstBRow, debug
    });

    this._mainFields = [];
    this._openOnce = false;
    this._busy = false;
    this._clickToken = 0;
    this._stack = [];
    this._idx = -1;
  }

  log(...a){ if(this.debug) console.log('[Drilldown]', ...a); }
  warn(...a){ console.warn('[Drilldown]', ...a); }

  _setPopupTitle(t) {
    if (typeof w2popup.title === 'function') return w2popup.title(t);
    if (typeof w2popup.setTitle === 'function') return w2popup.setTitle(t);
  }

  async init() {
    if (!window.w2ui || !window.w2popup) {
      this.warn('w2ui/w2popup not found; include w2ui before this module.');
      return;
    }

    // Build MAIN via your TableBuilder
    const tb = new TableBuilder({
      dataCsv: this.mainCsv,
      box: this.container,
      name: this.name,
      groupByIdx: this.groupByIdx,
      statusIdx: this.statusIdx,
      colorColsIdx: this.colorColsIdx
    });
    await tb.build();

    const grid = w2ui[this.name];
    if (!grid) { this.warn(`Grid "${this.name}" not found.`); return; }

    // Cache MAIN fields; map 1-based → 0-based config
    this._mainFields = grid.columns.map(c => c.field);
    const selSet    = new Set(this.selectableCols.map(i => i - 1));
    const mainKeys  = this.mainKeyCols.map(i => i - 1);

    // Toolbar sanity button
    grid.toolbar?.add?.({ id:'dd-test', type:'button', text:'Test Popup', icon:'w2ui-icon-search' });
    grid.on('toolbar', async (ev) => {
      if ((ev.detail?.item?.id ?? ev.item?.id) === 'dd-test') {
        await this._ensurePopup('Drilldown', [{ label:'Main', go: () => this._closePopup() }]);
        this._replaceBody(`<div style="padding:12px">Popup OK 🎉</div>`);
      }
    });

    // MAIN click → open B
    grid.on('click', async (ev) => {
      const col   = ev.detail?.column ?? ev.column;
      const recid = ev.detail?.recid  ?? ev.recid;
      if (col == null || recid == null) return;
      if (!selSet.has(col)) return;

      const rec = grid.get(recid);
      if (!rec) return;

      const baseParts = mainKeys.map(idx => rec[this._mainFields[idx]] ?? '');
      const bPath = this._url(this.childDir, this._safeJoin(baseParts) + '.csv');
      await this._goTo({ level:'B', baseParts, path:bPath });
    });
  }

  /* ---------------------- Navigation core ---------------------- */

  async _goTo(state, replaceForward = false) {
    if (this._busy) return;
    this._busy = true;
    try {
      if (state.level === 'B') {
        if (!(await this._exists(state.path))) {
          w2alert(`Level-B CSV not found:\n${state.path}`); this._busy=false; return;
        }
        await this._ensurePopup('Level-B', [
          { label:'Main', go: () => this._closePopup() },
          { label: this._basename(state.path) }
        ]);
        await this._renderGridB(state);
      } else if (state.level === 'C') {
        await this._ensurePopup('Level-C', [
          { label:'Main', go: () => this._closePopup() },
          { label: this._safeJoin(state.baseParts).slice(0,48)+'…', go: () => this._goBackToLevel('B') },
          { label: this._basename(state.path) }
        ]);
        await this._renderGridC(state);
      }

      if (replaceForward) this._stack = this._stack.slice(0, this._idx + 1);
      this._stack.push(state);
      this._idx = this._stack.length - 1;
      this._updateNavButtons();
    } finally { this._busy = false; }
  }

  async _restoreAt(i) {
    const st = this._stack[i];
    if (!st) return;
    if (st.level === 'B') {
      await this._ensurePopup('Level-B', [
        { label:'Main', go: () => this._closePopup() },
        { label: this._basename(st.path) }
      ]);
      await this._renderGridB(st);
    } else {
      await this._ensurePopup('Level-C', [
        { label:'Main', go: () => this._closePopup() },
        { label: this._safeJoin(st.baseParts).slice(0,48)+'…', go: () => this._goBackToLevel('B') },
        { label: this._basename(st.path) }
      ]);
      await this._renderGridC(st);
    }
    this._updateNavButtons();
  }

  async _go(delta) {
    if (this._busy) return;
    const ni = this._idx + delta;
    if (ni < 0 || ni >= this._stack.length) return;
    this._idx = ni;
    await this._restoreAt(this._idx);
  }

  async _goBackToLevel(level) {
    for (let i = this._idx; i >= 0; i--) {
      if (this._stack[i].level === level) {
        this._idx = i;
        await this._restoreAt(i);
        return;
      }
    }
  }

  _updateNavButtons() {
    const back = document.getElementById('dd-back');
    const fwd  = document.getElementById('dd-fwd');
    if (back) back.disabled = !(this._idx > 0);
    if (fwd)  fwd.disabled  = !(this._idx >= 0 && this._idx < this._stack.length - 1);
  }

  /* ---------------------- Popup: open once ---------------------- */

  async _ensurePopup(title, crumbs) {
    const shell = `
      <div id="dd-wrap" style="padding:8px; display:flex; flex-direction:column; gap:8px; height:100%; box-sizing:border-box;">
        <div id="dd-bar" style="display:flex; align-items:center; gap:8px; flex:0 0 auto;">
          <button id="dd-back" class="w2ui-btn">◀ Back</button>
          <button id="dd-fwd"  class="w2ui-btn">Forward ▶</button>
          <div id="dd-crumbs" style="margin-left:8px; flex:1;"></div>
        </div>
        <div id="dd-body" style="flex:1 1 auto; min-height:400px; overflow:hidden;"></div>
      </div>
    `;
    if (!this._openOnce) {
      await new Promise(resolve => {
        w2popup.open({
          title,
          body: shell,
          modal: true,
          showMax: true,
          width: 980, height: 620,
          onOpen(evt){ evt.onComplete = resolve; }
        });
      });
      this._bindNavButtons();
      this._openOnce = true;
      w2popup.on('resize', () => {
        const g = w2ui.ddGrid;
        if (g && g.box && w2popup.body && w2popup.body.contains(g.box)) { try { g.resize(); } catch {} }
      });
    } else {
      this._setPopupTitle(title);
    }
    this._setCrumbs(crumbs);
  }

  _bindNavButtons() {
    document.getElementById('dd-back')?.addEventListener('click', () => this._go(-1));
    document.getElementById('dd-fwd') ?.addEventListener('click', () => this._go(+1));
  }

  _setCrumbs(parts = []) {
    const el = document.getElementById('dd-crumbs');
    if (!el) return;
    el.innerHTML = parts.map((p,i) => {
      const last = i === parts.length - 1;
      if (p.go && !last)
        return `<a href="#" data-i="${i}" style="text-decoration:underline;">${this._esc(p.label)}</a><span style="margin:0 6px;">›</span>`;
      return `<span>${this._esc(p.label)}</span>${last ? '' : '<span style="margin:0 6px;">›</span>'}`;
    }).join('');
    [...el.querySelectorAll('a[data-i]')].forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const i = Number(a.getAttribute('data-i'));
        if (i === 0) this._closePopup(); else this._goBackToLevel('B');
      });
    });
    this._updateNavButtons();
  }

  _replaceBody(html) {
    const body = document.getElementById('dd-body');
    if (!body) return;
    body.innerHTML = html;
  }

  _closePopup() {
    try { w2popup.close(); } catch {}
    this._openOnce = false;
    this._stack = [];
    this._idx = -1;
    if (w2ui.ddGrid) try { w2ui.ddGrid.destroy(); } catch {}
  }

  /* ---------------------- Renderers ---------------------- */

  async _renderGridB(state) {
    this._replaceBody(`<div id="dd-grid" style="height:520px;"></div>`);
    await this._raf2();
    if (w2ui.ddGrid) try { w2ui.ddGrid.destroy(); } catch {}
    const tbB = new TableBuilder({ dataCsv: state.path, box: '#dd-grid', name: 'ddGrid' });
    await tbB.build();
    const gridB = w2ui.ddGrid;
    try { gridB?.resize(); } catch {}

    // B row click → C
    gridB.on('click', async (ev) => {
      const token = ++this._clickToken;
      if (this._busy) return;

      const recid = ev.detail?.recid ?? ev.recid;
      const rec = gridB.get(recid);
      if (!rec) return;

      const bFields = gridB.columns.map(c => c.field);
      const bKeys   = this.bKeyCols.map(i => i - 1);
      const bParts  = bKeys.map(idx => rec[bFields[idx]] ?? '');

      const cPath   = this._url(this.childDir, this._safeJoin([...state.baseParts, ...bParts]) + '.csv');

      const exists = await this._exists(cPath);
      if (token !== this._clickToken) return;

      if (!exists) {
        if (this.fallbackToFirstBRow) {
          const first = gridB.records?.[0];
          if (first) {
            const firstParts = bKeys.map(idx => first[bFields[idx]] ?? '');
            const cPathFirst = this._url(this.childDir, this._safeJoin([...state.baseParts, ...firstParts]) + '.csv');
            if (await this._exists(cPathFirst)) {
              if (token !== this._clickToken) return;
              await this._goTo({ level:'C', baseParts: state.baseParts, bParts: firstParts, path: cPathFirst }, true);
              return;
            }
          }
        }
        w2alert('Matching Level-C CSV not found for this row.');
        return;
      }
      await this._goTo({ level:'C', baseParts: state.baseParts, bParts, path: cPath }, true);
    });
  }

  async _renderGridC(state) {
    this._replaceBody(`<div id="dd-grid" style="height:520px;"></div>`);
    await this._raf2();
    if (w2ui.ddGrid) try { w2ui.ddGrid.destroy(); } catch {}
    const tbC = new TableBuilder({ dataCsv: state.path, box: '#dd-grid', name: 'ddGrid' });
    await tbC.build();
    try { w2ui.ddGrid?.resize(); } catch {}
  }

  /* ---------------------- Utils ---------------------- */

  async _raf2(){ await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }

  async _exists(url) {
    try {
      const h = await fetch(url, { method:'HEAD' });
      if (h.ok) return true;
      const g = await fetch(url, { method:'GET' });
      return g.ok;
    } catch { return false; }
  }

  _url(dir, file){ return dir.endsWith('/') ? dir + file : `${dir}/${file}`; }
  _basename(p){ return (p.split('/').pop() || p); }

  _esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  _safePart(s){
    const banned = new RegExp(`[^\\w\\-]+`, 'g');
    return String(s ?? '').replace(banned,'_').replace(/^_+|_+$/g,'');
  }
  _safeJoin(arr){ return arr.map(v => this._safePart(v)).join(this.sep); }
}
