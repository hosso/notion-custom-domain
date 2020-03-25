import fs from 'fs';
import { URL } from 'url';

const START_PAGE = new URL(
  process.env.START_PAGE ||
    'https://www.notion.so/Notion-Official-83715d7703ee4b8699b5e659a4712dd8',
).pathname;

let config = fs.readFileSync('./now-tmpl.json').toString();

config = config.replace(/{{start}}/g, START_PAGE);

fs.writeFileSync('./now.json', config);
