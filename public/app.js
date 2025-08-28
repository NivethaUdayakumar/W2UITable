import { TableBuilder } from './tableBuilder.js';

new TableBuilder({
  dataCsv: '/data/table.csv',
  fileCsv: '/data/filepaths.csv', // omit or set null for non-clickable grid
  box: '#grid',
  name: 'myGrid',
  groupByIdx: [1,2],  // optional
  statusIdx: 6,       // optional
  colorColsIdx: [6]   // optional
}).build();