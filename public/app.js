/*import { TableBuilder } from './tableBuilder.js';

new TableBuilder({
  dataCsv: '/data/table.csv',
  fileCsv: null, // omit or set null for non-clickable grid
  box: '#grid',
  name: 'myGrid',
  groupByIdx: [1,2],  // optional
  statusIdx: 11,       // optional
  colorColsIdx: [11]   // optional
}).build();*/

/*
  import { Drilldown } from './tableDrilldown.js';

  // Build MAIN table; clicking any cell in columns 14..19 opens Level-B
  const dd = new Drilldown({
    mainCsv: './data/table.csv',
    container: '#grid',
    selectableCols: [14,15,16,17,18,19], // 1-based
    mainKeyCols: [1,2,3,4,5,6,7], // 1-based
    bKeyCols: [1,2,3,4,5], // 1-based
    childDir: './data/dropdown',
    fallbackToFirstBRow: false,
    sep: '_',               // where B/C CSVs live
    groupByIdx: [0,1,2],                     
    statusIdx: 11,
    colorColsIdx: [11],
    debug: true
  });
  dd.init();*/

  import { MultiDrilldown } from "./multiDrilldown.js";
  const dd4 = new MultiDrilldown({
  levels: [
    { name:'Main', csv:'./data/table.csv', selectableCols:[10,11,12], keyCols:[1,2,3,4,5,6,7], groupByIdx: [0,1,2], dir:'./data/dropdown' },
    { name:'B',    childKeyCols:[1,2,3,4,5], dir:'./data/dropdown' },
    { name:'C',    childKeyCols:[1,2,3,4,5], dir:'./data/dropdown' },
    { name:'D',    /* last level (no childKeyCols) */ dir:'./data/deep-data' }
  ],
  container:'#grid',
  name:'mainGrid',
  sep:'_',
  fallbackToFirstRow:true, // allow fallback during dev
  debug:true
});
dd4.init();