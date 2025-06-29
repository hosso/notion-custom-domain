import express from 'express';
import proxy from 'express-http-proxy';
import { URL } from 'url';
import path from 'path';
import { minify_sync as minify } from 'terser';
import CleanCSS from 'clean-css';

const {
  PAGE_URL = 'https://notion.notion.site/Notion-Official-83715d7703ee4b8699b5e659a4712dd8',
  GA_MEASUREMENT_ID,
} = process.env;

const { origin: pageDomain, pathname: pagePath } = new URL(PAGE_URL);
const [pageId] = path.basename(pagePath).match(/[^-]*$/) || [''];

// Map start page path to "/". Replacing URL for example:
// - https://my.notion.site/0123456789abcdef0123456789abcdef -> https://mydomain.com/
// - /My-Page-0123456789abcdef0123456789abcdef -> /
// - /my/My-Page-0123456789abcdef0123456789abcdef -> /
declare global {
  interface Window {
    ncd: {
      _pageId: string;
      _pageDomain: string;
      _myUrl: (url: string) => string;
      _yourUrl: (url: string) => string;
      href: () => string;
    };
  }
}
const locationProxy = (pageDomain: string, pageId: string) => {
  window.ncd = {
    _pageId: pageId,
    _pageDomain: pageDomain,
    _myUrl: function (url: string) {
      return url
        .replace(location.origin, this._pageDomain)
        .replace(/\/(?=\?|$)/, `/${this._pageId}`);
    },
    _yourUrl: function (url: string) {
      return url
        .replace(this._pageDomain, location.origin)
        .replace(
          new RegExp(`(^|[^/])\\/[^/].*${this._pageId}(?=\\?|$)`),
          '$1/',
        );
    },
    href: function () {
      return this._myUrl(location.href);
    },
  };

  window.history.pushState = new Proxy(window.history.pushState, {
    apply: function (target, that, [data, unused, url]) {
      return Reflect.apply(target, that, [
        data,
        unused,
        window.ncd._yourUrl(url),
      ]);
    },
  });
  window.history.replaceState = new Proxy(window.history.replaceState, {
    apply: function (target, that, [data, unused, url]) {
      return Reflect.apply(target, that, [
        data,
        unused,
        window.ncd._yourUrl(url),
      ]);
    },
  });
};
const ncd = minify(
  `(${locationProxy.toString()})('${pageDomain}', '${pageId}')`,
).code;

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

const customScript = () => {
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

const customStyle = `
  .notion-topbar > div > div:nth-last-child(1), .notion-topbar > div > div:nth-last-child(2) { 
    display:none !important; 
  }
`;

function getCustomScript() {
  const js = minify(`(${customScript.toString()})()`).code;
  return `<script>${js}</script>`;
}

function getCustomStyle() {
  const css = new CleanCSS().minify(customStyle).styles;
  return `<style>${css}</style>`;
}

const app = express();

app.use(
  proxy(pageDomain, {
    proxyReqOptDecorator: (proxyReqOpts) => {
      if (proxyReqOpts.headers) {
        delete proxyReqOpts.headers['accept-encoding'];
      }
      return proxyReqOpts;
    },
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
        data = data.replace(
          /window\.location\.href(?=[^=]|={2,})/g,
          'ncd.href()',
        ); // Exclude 'window.locaton.href=' but not 'window.locaton.href=='
      } else {
        // Assume HTML
        data = data
          .replace(
            '</head>',
            `<script>${ncd}</script>${getCustomScript()}${getCustomStyle()}</head>`,
          )
          .replace('</body>', `${ga}</body>`);
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
