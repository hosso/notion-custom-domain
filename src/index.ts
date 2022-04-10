import express from 'express';
import proxy from 'express-http-proxy';
import { URL } from 'url';

const {
  PAGE_URL = 'https://notion.notion.site/Notion-Official-83715d7703ee4b8699b5e659a4712dd8',
  GA_TRACKING_ID,
} = process.env;

const { origin: pageDomain, pathname: pagePath } = new URL(PAGE_URL);
const pageId = pagePath.match(/[^-]*$/);

// Map start page path to "/". Replacing URL for example:
// - https://my.notion.site/0123456789abcdef0123456789abcdef -> https://mydomain.com/
// - /My-Page-0123456789abcdef0123456789abcdef -> /
// - /my/My-Page-0123456789abcdef0123456789abcdef -> /
const ncd = `var ncd={
  href:function(){return location.href.replace(location.origin,"${pageDomain}").replace(/\\/(?=\\?|$)/,"/${pageId}")},
  pushState:function(a,b,url){history.pushState(a,b,url.replace("${pageDomain}",location.origin).replace(/(^|[^/])\\/[^/].*${pageId}(?=\\?|$)/,"$1/"));pageview();},
  replaceState:function(a,b,url){history.replaceState(a,b,url.replace("${pageDomain}",location.origin).replace(/(^|[^/])\\/[^/].*${pageId}(?=\\?|$)/,"$1/"));pageview();}
};`.replace(/\n */gm, '');

const ga = GA_TRACKING_ID
  ? `<!-- Global site tag (gtag.js) - Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${GA_TRACKING_ID}');
</script>`
  : '';

const pageview = `<script>
  window.pagePath = location.pathname + location.search + location.hash;
  function pageview(){
    var pagePath = location.pathname + location.search + location.hash;
    if (pagePath !== window.pagePath) {${
      GA_TRACKING_ID
        ? `
      gtag('config', '${GA_TRACKING_ID}', {'page_path': pagePath});`
        : ''
    }
      window.pagePath = pagePath;
    }
  }
  window.addEventListener('popstate', pageview);
</script>`;

const app = express();

app.use(
  proxy(pageDomain, {
    proxyReqOptDecorator: (proxyReqOpts) => {
      if (proxyReqOpts.headers) {
        proxyReqOpts.headers['accept-encoding'] = 'gzip';
      }
      return proxyReqOpts;
    },
    proxyReqPathResolver: (req) => {
      // Replace '/' with `/${pageId}`
      return req.url.replace(/\/(\?|$)/, `/${pageId}$1`);
    },
    userResHeaderDecorator: (headers, userReq) => {
      if (headers['location']) {
        // "https://www.notion.so/syncCookies?backUrl=https%3A%2F%2Fmy.notion.site%2F0123456789abcdef0123456789abcdef%3Fv%3D1"
        // -> "https://mydomain.com/syncCookies?backUrl=https%3A%2F%2Fmydomain.com%2F0123456789abcdef0123456789abcdef%3Fv%3D1"
        headers['location'] = headers['location'].replace(
          /(https?)(:\/\/|%3A%2F%2F)[^.]+\.notion\.(so|site)/g,
          `${userReq.headers['x-forwarded-proto']}$2${userReq.headers['x-forwarded-host']}`,
        );
      }

      if (headers['set-cookie']) {
        // "Domain=notion.site" -> "Domain=mydomain.com"
        // "; Domain=notion.site;' -> '; Domain=mydomain.com;"
        const domain = (userReq.headers['x-forwarded-host'] as string).replace(
          /:.*/,
          '',
        );
        headers['set-cookie'] = headers['set-cookie'].map((cookie) =>
          cookie.replace(
            /((?:^|; )Domain=)((?:[^.]+\.)?notion\.(?:so|site))(;|$)/g,
            `$1${domain}$3`,
          ),
        );
      }

      const csp = headers['content-security-policy'] as string;
      if (csp) {
        headers['content-security-policy'] = csp.replace(
          /(?=script-src )[^;]*/,
          '$& https://www.googletagmanager.com https://www.google-analytics.com',
        );
      }

      return headers;
    },
    userResDecorator: (_proxyRes, proxyResData, userReq) => {
      if (/\/app-.*\.js/.test(userReq.url)) {
        return proxyResData
          .toString()
          .replace(/^/, ncd)
          .replace(/window.location.href(?=[^=]|={2,})/g, 'ncd.href()') // Exclude 'window.locaton.href=' but not 'window.locaton.href=='
          .replace(/window.history.(pushState|replaceState)/g, 'ncd.$1');
      } else if (/^\/image\//.test(userReq.url)) {
        return proxyResData;
      } else {
        // Assume HTML
        return proxyResData
          .toString()
          .replace('</body>', `${ga}${pageview}</body>`);
      }
    },
  }),
);

if (!process.env.VERCEL_REGION) {
  const port = process.env.PORT || 3000;
  app.listen(port, () =>
    console.log(`Server running at http://localhost:${port}`),
  );
}

export default app;
