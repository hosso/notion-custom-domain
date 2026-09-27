import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import {
  createAnalyticsMarkup,
  createInjectedHeadMarkup,
} from './client-script.js';
import { createHandler } from './proxy.js';

const {
  PAGE_URL = 'https://notion.notion.site/Notion-Official-83715d7703ee4b8699b5e659a4712dd8',
  GA_MEASUREMENT_ID,
} = process.env;
const { origin: pageDomain, pathname: pagePath } = new URL(PAGE_URL);
const [pageId] = path.basename(pagePath).match(/[^-]*$/) || [''];

export const handler = createHandler({
  analyticsMarkup: createAnalyticsMarkup(GA_MEASUREMENT_ID),
  injectedHeadMarkup: createInjectedHeadMarkup(pageDomain, pageId),
  pageDomain,
  pageId,
});

if (!process.env.VERCEL_REGION && !process.env.NOW_REGION) {
  const port = process.env.PORT || 3000;
  http
    .createServer(handler)
    .listen(port, () =>
      console.log(`Server running at http://localhost:${port}`),
    );
}

export default handler;
