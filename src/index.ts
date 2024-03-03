import express from 'express';
import proxy from 'express-http-proxy';
import { URL } from 'url';
import path from 'path';

const {
  PAGE_URL = 'https://notion.notion.site/Notion-Official-83715d7703ee4b8699b5e659a4712dd8',
  GA_MEASUREMENT_ID,
} = process.env;

const { origin: pageDomain, pathname: pagePath } = new URL(PAGE_URL);
const pageId = path.basename(pagePath).match(/[^-]*$/);

// Map start page path to "/". Replacing URL for example:
// - https://my.notion.site/0123456789abcdef0123456789abcdef -> https://mydomain.com/
// - /My-Page-0123456789abcdef0123456789abcdef -> /
// - /my/My-Page-0123456789abcdef0123456789abcdef -> /
const ncd = `var ncd={
  href:function(){return location.href.replace(location.origin,"${pageDomain}").replace(/\\/(?=\\?|$)/,"/${pageId}")},
  pushState:function(a,b,url){history.pushState(a,b,url.replace("${pageDomain}",location.origin).replace(/(^|[^/])\\/[^/].*${pageId}(?=\\?|$)/,"$1/"));},
  replaceState:function(a,b,url){history.replaceState(a,b,url.replace("${pageDomain}",location.origin).replace(/(^|[^/])\\/[^/].*${pageId}(?=\\?|$)/,"$1/"));}
};`.replace(/\n */gm, '');

const ga = GA_MEASUREMENT_ID
  ? `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${GA_MEASUREMENT_ID}');
</script>`
  : '';

const customStyle = `<style> 
  .notion-topbar > div > div:nth-last-child(1), .notion-topbar > div > div:nth-last-child(2) { 
    display:none !important; 
  } 
</style>`;

const app = express();

app.use(
  proxy(pageDomain, {
    proxyReqPathResolver: (req) => {
      // Replace '/' with `/${pageId}`
      return req.url.replace(/\/(\?|$)/, `/${pageId}$1`);
    },
    userResHeaderDecorator: (headers, userReq) => {
      const cookies = headers['set-cookie'];
      if (cookies) {
        // "Domain=notion.site" -> "Domain=mydomain.com"
        // "; Domain=notion.site;' -> '; Domain=mydomain.com;"
        headers['set-cookie'] = cookies.map((cookie) =>
          cookie.replace(
            /((?:^|; )Domain=)((?:[^.]+\.)?notion\.site)(;|$)/gi,
            `$1${userReq.hostname}$3`,
          ),
        );
      }

      const csp = headers['content-security-policy'] as string;
      if (csp) {
        headers['content-security-policy'] = csp.replace(
          /(?=(script-src|connect-src) )[^;]*/g,
          '$& https://www.googletagmanager.com https://www.google-analytics.com',
        );
      }

      return headers;
    },
    userResDecorator: (_proxyRes, proxyResData, userReq) => {
      if (/^\/_assets\/[^/]*\.js$/.test(userReq.url)) {
        return proxyResData
          .toString()
          .replace(/^/, ncd)
          .replace(/window\.location\.href(?=[^=]|={2,})/g, 'ncd.href()') // Exclude 'window.locaton.href=' but not 'window.locaton.href=='
          .replace(/window\.history\.(pushState|replaceState)/g, 'ncd.$1');
      } else if (/^\/image[s]?\//.test(userReq.url)) {
        return proxyResData;
      } else {
        // Assume HTML
        return proxyResData
          .toString()
          .replace('</body>', `${ga}</body>`)
          .replace('</head>', `${customStyle}</head>`);
      }
    },
  }),
);

if (!process.env.VERCEL_REGION && !process.env.NOW_REGION) {
  const port = process.env.PORT || 3000;
  app.listen(port, () =>
    console.log(`Server running at http://localhost:${port}`),
  );
}

export default app;
