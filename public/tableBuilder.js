export class TableBuilder {
  constructor({ dataCsv, fileCsv=null, box='#grid', name='grid', groupByIdx=[], statusIdx=null, colorColsIdx=[] }={}) {
    Object.assign(this, { dataCsv, fileCsv, box, name, groupByIdx, statusIdx, colorColsIdx });
  }

  async build() {
    const parse=t=>{const a=t.trim().split(/\r?\n/),h=(a.shift()||'').split(',').map(s=>s.trim());return{h,rows:a.filter(Boolean).map(l=>l.split(',').map(s=>s.trim()))}};
    const fkey=h=>h.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''), esc=s=>(s+'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const dataTxt = await (await fetch(this.dataCsv)).text();
    const { h: hdr, rows: data } = parse(dataTxt);
    const fields = hdr.map(fkey);
    const files = this.fileCsv ? parse(await (await fetch(this.fileCsv)).text()).rows : null;

    const colored=(rec,fn,sf,isS)=>{const v=rec[fn]??'', st=(sf?rec[sf]:'')?.toString().toLowerCase();
      const cls=st==='failed'?'tb-failed':st==='running'?'tb-running':st==='completed'?'tb-completed':'', spin=isS&&st==='running'?'<span class="tb-loader"></span>':'';
      return `<span class="tb-cell ${cls}">${esc(v)}${spin}</span>`};
    const statusOnly=(rec,fn)=>{const v=rec[fn]??'',st=v.toString().toLowerCase();return st==='running'?`${esc(v)}<span class="tb-loader"></span>`:esc(v)};

    const columns = hdr.map((lab,i)=>({ field:fields[i], text:lab, size:'150px', sortable:true, searchable:'text',
      render: rec => {
        let html = this.colorColsIdx?.includes(i) ? colored(rec,fields[i],fields[this.statusIdx??-1],i===this.statusIdx)
                 : (i===this.statusIdx ? statusOnly(rec,fields[i]) : esc(rec[fields[i]]??''));
        if (files) { const row = rec.__row, path = files[row]?.[i]; if (path && path!=='-') html = `<a href="#" class="tb-link" data-path="${esc(path)}">${html}</a>`; }
        return html;
      }
    }));

    const flat = data.map((r,i)=>{const o={recid:i+1,__row:i}; hdr.forEach((_,j)=>o[fields[j]]=r[j]??''); return o;});
    let records = flat;
    const ok = Array.isArray(this.groupByIdx)&&this.groupByIdx.length&&this.groupByIdx.every(i=>i>=0&&i<hdr.length);
    if (ok) {
      const key=rc=>this.groupByIdx.map(i=>rc[fields[i]]).join(' | '), mp=new Map();
      flat.forEach(rc=>{const k=key(rc);(mp.get(k)||mp.set(k,[]).get(k)).push(rc)});
      records=[]; for (const [,arr] of mp) { const p=arr[arr.length-1], kids=arr.slice(0,-1).map((r,j)=>({...r,recid:p.recid+'-c'+(j+1)})); if(kids.length)p.w2ui={children:kids}; records.push(p); }
    }

    if (w2ui[this.name]) w2ui[this.name].destroy();
    new w2grid({
      name:this.name, box:this.box, columns,
      searches: columns.map(c=>({field:c.field,label:c.text,type:'text'})),
      records,
      show:{ toolbar:true, toolbarSearch:true, toolbarColumns:true, footer:true, expandColumn:true },
      multiSearch:true,
      sortData: columns[0]?[{field:columns[0].field,direction:'asc'}]:[]
    });

    if (files) {
      const host = document.querySelector(this.box);
      host.addEventListener('click', e => {
        const a = e.target.closest('a.tb-link'); if(!a) return; e.preventDefault(); this.#openCsvPopup(a.dataset.path);
      });
    }
  }

  async #openCsvPopup(path){
    const parse=t=>{const a=t.trim().split(/\r?\n/),h=(a.shift()||'').split(',').map(s=>s.trim());return{h,rows:a.filter(Boolean).map(l=>l.split(',').map(s=>s.trim()))}};
    const fkey=h=>h.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
    const txt = await (await fetch(path)).text();
    const { h, rows } = parse(txt), fk = h.map(fkey);
    w2popup.open({
      title:path, modal:true, width:900, height:520, showMax: true, body:'<div id="pg" style="width:100%;height:100%"></div>',
      onOpen: ev => { ev.onComplete = () => {
        const name='pop_'+Date.now(); if (w2ui[name]) w2ui[name].destroy();
        new w2grid({
          name, box:'#pg',
          columns: h.map((lab,i)=>({ field:fk[i], text:lab, size:'150px', sortable:true, searchable:'text' })),
          searches: h.map((lab,i)=>({ field:fk[i], label:lab, type:'text' })),
          records: rows.map((r,i)=>{const o={recid:i+1}; h.forEach((_,j)=>o[fk[j]]=r[j]??''); return o;}),
          show:{ toolbar:true, toolbarSearch:true, toolbarColumns:true, footer:true },
          multiSearch:true,
          sortData: fk[0]?[{field:fk[0],direction:'asc'}]:[]
        });
      };}
    });
  }
}
