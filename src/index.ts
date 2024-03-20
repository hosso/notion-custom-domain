import express from 'express';
import proxy from 'express-http-proxy';
import { URL } from 'url';
import path from 'path';
import { minify_sync as minify } from 'terser';

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

const customFetch = () => {
  const replacedUrl = (url: string) => {
    const [, domain] = /^https?:\/\/([^\\/]*)/.exec(url) || ['', ''];
    if (
      (domain.endsWith('notion.so') &&
        !domain.endsWith('msgstore.www.notion.so')) ||
      domain.endsWith('splunkcloud.com') ||
      domain.endsWith('statsigapi.net')
    ) {
      console.info('[NCD]', 'Suppress request:', url);
      return url.replace(/^.*:(.*)\/\//, '/200/$1');
    }
    return url;
  };

  window.fetch = new Proxy(window.fetch, {
    apply: function (target, that, [url, ...rest]) {
      url = replacedUrl(url);
      return Reflect.apply(target, that, [url, ...rest]);
    },
  });

  window.XMLHttpRequest = new Proxy(XMLHttpRequest, {
    construct: function (target, args) {
      // @ts-expect-error A spread argument must either have a tuple type or be passed to a rest parameter.
      const xhr = new target(...args);
      xhr.open = new Proxy(xhr.open, {
        apply: function (target, that, [method, url, ...rest]) {
          url = replacedUrl(url);
          return Reflect.apply(target, that, [method, url, ...rest]);
        },
      });
      return xhr;
    },
  });
};
const customCode = minify(`(${customFetch.toString()})()`).code;
const customScript = `<script>${customCode}</script>`;

const customStyle = `<style> 
  .notion-topbar > div > div:nth-last-child(1), .notion-topbar > div > div:nth-last-child(2) { 
    display:none !important; 
  } 
</style>`;

const app = express();

app.use(
  proxy(pageDomain, {
    filter: (req, res) => {
      // Pseudo endpoint returning 200
      if (/^\/200\/?/.test(req.url)) {
        if (req.url.startsWith('/200/www.notion.so/api/v3/')) {
          res.send('success');
        } else if (req.url.startsWith('/200/exp.notion.so/v1/')) {
          res.json({ success: true });
        } else {
          res.end();
        }
        return false;
      }
      return true;
    },
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
            /((?:^|; )Domain=)(?:[^.]+\.)?notion\.site(;|$)/gi,
            `$1${userReq.hostname}$2`,
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
      if (/^\/image[s]?\//.test(userReq.url)) {
        return proxyResData;
      }

      let data = proxyResData.toString();

      // For investigation
      const keywords: string[] = [
        // 'teV1',
        // 'aif.notion.so',
        // 'exp.notion.so',
        // 'msgstore.www.notion.so',
        // 'primus',
        // 'widget.intercom.io',
        // 'ingest.sentry.io',
        // 'envelope',
        // 'dsn',
        // 'splunkcloud.com',
        // 'statsigapi.net',
      ];
      const found = keywords.reduce(
        (acc: string[], keyword) =>
          data.includes(keyword) ? [...acc, keyword] : acc,
        [],
      );
      if (found.length > 0) {
        console.log('[DEBUG]', userReq.url, found);
      }

      if (/^\/_assets\/[^/]*\.js$/.test(userReq.url)) {
        data = data
          .replace(/^/, ncd)
          .replace(/window\.location\.href(?=[^=]|={2,})/g, 'ncd.href()') // Exclude 'window.locaton.href=' but not 'window.locaton.href=='
          .replace(/window\.history\.(pushState|replaceState)/g, 'ncd.$1');
      } else {
        // Assume HTML
        data = data
          .replace('</body>', `${ga}</body>`)
          .replace('</head>', `${customScript}${customStyle}</head>`);
      }

      data = data
        // https://aif.notion.so/**      -> /200/aif.notion.so/**
        // https://widget.intercom.io/** -> /200/widget.intercom.io/**
        .replace(
          /https:\/\/((aif\.notion\.so|widget\.intercom\.io)\/?[^"`]*)/g,
          `/200/$1`,
        )
        // Skip Sentry.init()
        .replace(/\w+\.init\({dsn:/, 'return;$&');

      return data;
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
