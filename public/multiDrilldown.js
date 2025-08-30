import { TableBuilder } from './tableBuilder.js';

export class MultiDrilldown {
  /**
   * @param {Object} options
   * @param {Array}  options.levels  — Array describing each level:
   *    Level 0 (main): {
   *      name: 'Main',
   *      csv: './path/to/main.csv',
   *      selectableCols: [14,15,16,17,18,19],  // 1-based, optional
   *      keyCols: [1,2,3,4,5,6,7],            // 1-based: parts to build Level 1 file
   *      dir: './dataset',                    // default dir for this level’s children
   *      // optional custom builder (overrides defaults):
   *      // pathBuilder: ({levelIndex, parts, dir, sep}) => './dataset/foo.csv'
   *    }
   *    Level i>0:  {
   *      name: 'Level-B',
   *      childKeyCols: [1,2,3,4,5],           // 1-based: parts taken from THIS level’s row to build next
   *      dir: './dataset',                    // where this level’s children live (optional)
   *      // optional custom builder for NEXT file:
   *      // pathBuilder: ({levelIndex, parts, dir, sep}) => './dataset/foo.csv'
   *    }
   *
   * The file for level k (k>=1) is built from the accumulated parts from levels 0..k-1.
   *
   * @param {string} options.container — Selector for the main grid box (only used at level 0)
   * @param {string} options.name      — w2ui name for the main grid
   * @param {string} options.sep       — filename separator (default '_')
   * @param {boolean} options.fallbackToFirstRow — when a child file is missing, open the first row’s child if available
   * @param {boolean} options.debug
   */
  constructor({
    levels,
    container = '#grid',
    name = 'mainGrid',
    sep = '_',
    fallbackToFirstRow = false,
    debug = true
  } = {}) {
    if (!Array.isArray(levels) || levels.length < 1) {
      throw new Error('levels[] config is required (at least the main level).');
    }
    this.levels = levels;
    this.container = container;
    this.name = name;
    this.sep = sep;
    this.fallbackToFirstRow = fallbackToFirstRow;
    this.debug = debug;

    // state
    this._openOnce = false;
    this._busy = false;
    this._clickToken = 0;
    this._stack = [];   // [{ levelIndex, parts, path }]
    this._idx = -1;
    this._level0Fields = [];   // column field names from level 0
  }

  log(...a){ if(this.debug) console.log('[MultiDrilldown]', ...a); }
  warn(...a){ console.warn('[MultiDrilldown]', ...a); }

  _setPopupTitle(t) {
    if (typeof w2popup?.title === 'function') return w2popup.title(t);
    if (typeof w2popup?.setTitle === 'function') return w2popup.setTitle(t);
  }

  /* ======================= PUBLIC ======================= */
  async init() {
    if (!window.w2ui || !window.w2popup) {
      this.warn('w2ui/w2popup not found; include w2ui before this module.');
      return;
    }
    const L0 = this.levels[0];
    if (!L0?.csv) throw new Error('levels[0].csv (main CSV) is required');

    // Build main via TableBuilder
    const tb = new TableBuilder({
      dataCsv: L0.csv,
      box: this.container,
      name: this.name,
      groupByIdx: L0.groupByIdx ?? [],
      statusIdx: L0.statusIdx ?? 11,
      colorColsIdx: L0.colorColsIdx ?? []
    });
    await tb.build();

    const grid = w2ui[this.name];
    if (!grid) { this.warn(`Grid "${this.name}" not found.`); return; }

    // cache main fields and handlers
    this._level0Fields = grid.columns.map(c => c.field);
    const selSet = new Set((L0.selectableCols ?? []).map(i => i - 1));
    const keyIdx = (L0.keyCols ?? []).map(i => i - 1);

    /*// Optional test button
    grid.toolbar?.add?.({ id:'dd-test', type:'button', text:'Test Popup', icon:'w2ui-icon-search' });
    grid.on('toolbar', async (ev) => {
      if ((ev.detail?.item?.id ?? ev.item?.id) === 'dd-test') {
        await this._ensurePopup(L0.name ?? 'Main', [{ label:L0.name ?? 'Main', go: () => this._closePopup() }]);
        this._replaceBody(`<div style="padding:12px">Popup OK 🎉</div>`);
      }
    });*/

    // MAIN click => open Level 1 (if exists)
    if (this.levels.length > 1 && keyIdx.length > 0) {
      grid.on('click', async (ev) => {
        const col = ev.detail?.column ?? ev.column;
        const recid = ev.detail?.recid ?? ev.recid;
        if (col == null || recid == null) return;
        if (selSet.size && !selSet.has(col)) return;

        const rec = grid.get(recid);
        if (!rec) return;

        const baseParts = keyIdx.map(ix => rec[this._level0Fields[ix]] ?? '');
        const path = await this._buildPathForLevel(1, baseParts); // file for next level
        await this._goTo({ levelIndex: 1, parts: baseParts, path });
      });
    } else {
      this.warn('No next level or no keyCols defined for level 0 — drilldown disabled.');
    }
  }

  /* ======================= CORE NAV ======================= */
  async _goTo(state, replaceForward = false) {
    if (this._busy) return;
    this._busy = true;
    try {
      await this._openAndRenderLevel(state);

      if (replaceForward) this._stack = this._stack.slice(0, this._idx + 1);
      this._stack.push(state);
      this._idx = this._stack.length - 1;
      this._updateNavButtons();
    } finally { this._busy = false; }
  }

  async _restoreAt(i) {
    const st = this._stack[i];
    if (!st) return;
    await this._openAndRenderLevel(st);
    this._updateNavButtons();
  }

  async _openAndRenderLevel({ levelIndex, parts, path }) {
    const L = this.levels[levelIndex];
    const title = L?.name ?? `Level-${levelIndex}`;
    const crumbs = this._crumbsFor(levelIndex, parts, path);

    // Open popup once
    await this._ensurePopup(title, crumbs);

    // Render the current grid (levels[1..N-1] are file-based)
    if (levelIndex >= 1) {
      await this._renderCsvGrid({
        levelIndex,
        csvPath: path,
        parts
      });
    }
  }

  _crumbsFor(levelIndex, parts, path) {
    const out = [];
    const L0 = this.levels[0];
    out.push({ label: L0?.name ?? 'Main', go: () => this._closePopup() });
    if (levelIndex >= 1) {
      // Include compacted accumulated key context
      out.push({
        label: this._safeJoin(parts).slice(0,48) + (this._safeJoin(parts).length > 48 ? '…' : ''),
        go: () => this._popBackToLevel(1)
      });
      out.push({ label: this._basename(path) });
    }
    return out;
  }

  async _popBackToLevel(levelIndex) {
    // Find latest stack entry with the same levelIndex
    for (let i = this._idx; i >= 0; i--) {
      if (this._stack[i].levelIndex === levelIndex) {
        this._idx = i;
        await this._restoreAt(i);
        return;
      }
    }
  }

  async _go(delta) {
    if (this._busy) return;
    const ni = this._idx + delta;
    if (ni < 0 || ni >= this._stack.length) return;
    this._idx = ni;
    await this._restoreAt(this._idx);
  }

  /* ======================= RENDERING ======================= */
  async _renderCsvGrid({ levelIndex, csvPath, parts }) {
    // File for this level must exist
    if (!(await this._exists(csvPath))) {
      if (this.fallbackToFirstRow && levelIndex > 0) {
        // Try falling back to the *previous* level’s first row => Not applicable here—file missing entirely.
      }
      w2alert(`CSV not found:\n${csvPath}`);
      return;
    }

    // Mount container
    this._replaceBody(`<div id="dd-grid" style="height:520px;"></div>`);
    await this._raf2();

    // Destroy previous
    if (w2ui.ddGrid) try { w2ui.ddGrid.destroy(); } catch {}

    // Build
    const tb = new TableBuilder({ dataCsv: csvPath, box: '#dd-grid', name: 'ddGrid' });
    await tb.build();
    try { w2ui.ddGrid?.resize(); } catch {}

    // If there is a deeper level to go to, wire click
    const nextIndex = levelIndex + 1;
    if (nextIndex < this.levels.length) {
      const grid = w2ui.ddGrid;
      const nextConf = this.levels[levelIndex]; // current level determines child's keys
      const childKeys = (nextConf.childKeyCols ?? []).map(i => i - 1);

      if (childKeys.length === 0) {
        this.warn(`levels[${levelIndex}].childKeyCols not set — cannot drill to level ${nextIndex}`);
        return;
      }

      grid.on('click', async (ev) => {
        const token = ++this._clickToken;
        if (this._busy) return;
        const recid = ev.detail?.recid ?? ev.recid;
        const rec = grid.get(recid);
        if (!rec) return;

        const fields = grid.columns.map(c => c.field);
        const added = childKeys.map(ix => rec[fields[ix]] ?? '');
        const newParts = [...parts, ...added];
        const newPath = await this._buildPathForLevel(nextIndex, newParts);

        const exists = await this._exists(newPath);
        if (token !== this._clickToken) return;

        if (!exists) {
          if (this.fallbackToFirstRow) {
            const first = grid.records?.[0];
            if (first) {
              const firstAdded = childKeys.map(ix => first[fields[ix]] ?? '');
              const fp = await this._buildPathForLevel(nextIndex, [...parts, ...firstAdded]);
              if (await this._exists(fp)) {
                if (token !== this._clickToken) return;
                await this._goTo({ levelIndex: nextIndex, parts: [...parts, ...firstAdded], path: fp }, true);
                return;
              }
            }
          }
          w2alert('Matching child CSV not found for this row.');
          console.log(newPath);
          return;
        }

        await this._goTo({ levelIndex: nextIndex, parts: newParts, path: newPath }, true);
      });
    }
  }

  /* ======================= PATH BUILDING ======================= */
  async _buildPathForLevel(levelIndex, parts) {
    // Level 0 is the main grid—no file build here.
    if (levelIndex <= 0) return null;

    // If the level has a custom builder, use it.
    const levelConf = this.levels[levelIndex];
    const dir = levelConf?.dir ?? this.levels[levelIndex - 1]?.dir ?? './';
    if (typeof levelConf?.pathBuilder === 'function') {
      return levelConf.pathBuilder({ levelIndex, parts, dir, sep: this.sep });
    }

    // Default: dir / join(parts) + '.csv'
    return this._url(dir, this._safeJoin(parts) + '.csv');
  }

  /* ======================= POPUP ======================= */
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
      document.getElementById('dd-back')?.addEventListener('click', () => this._go(-1));
      document.getElementById('dd-fwd') ?.addEventListener('click', () => this._go(+1));
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
        if (i === 0) this._closePopup(); else this._popBackToLevel(1);
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

  _updateNavButtons() {
    const back = document.getElementById('dd-back');
    const fwd  = document.getElementById('dd-fwd');
    if (back) back.disabled = !(this._idx > 0);
    if (fwd)  fwd.disabled  = !(this._idx >= 0 && this._idx < this._stack.length - 1);
  }

  /* ======================= Utils ======================= */
  async _raf2(){ await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }

  async _exists(url) {
    try {
      const h = await fetch(url, { method:'HEAD' });
      if (h.ok) return true;
      const g = await fetch(url, { method:'GET' });
      return g.ok;
    } catch { return false; }
  }

  _url(dir, file){ return dir?.endsWith('/') ? dir + file : `${dir}/${file}`; }
  _basename(p){ return (p.split('/').pop() || p); }

  _esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  _safePart(s){
    const banned = new RegExp(`[^\\w\\-]+`, 'g');
    return String(s ?? '').replace(banned,'_').replace(/^_+|_+$/g,'');
  }
  _safeJoin(arr){ return arr.map(v => this._safePart(v)).join(this.sep); }
}
