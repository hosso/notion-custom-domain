import express from 'express';
import proxy from 'express-http-proxy';

const START_PAGE =
  process.env.START_PAGE ||
  'https://www.notion.so/Notion-Official-83715d7703ee4b8699b5e659a4712dd8';
const GA_TRACKING_ID = process.env.GA_TRACKING_ID;

const startId = START_PAGE.replace(/^.*-/, '');

// Map start page path to "/"
const ncd = `var ncd={
  href:function(){return location.href.replace(/\\/(?=\\?|$)/,"/${startId}")},
  pushState:function(a,b,url){history.pushState(a,b,url.replace(/\\/[^/]*${startId}(?=\\?|$)/,"/"));pageview();},
  replaceState:function(a,b,url){history.replaceState(a,b,url.replace(/\\/[^/]*${startId}(?=\\?|$)/,"/"));pageview();}
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
  proxy('https://www.notion.so', {
    proxyReqOptDecorator: (proxyReqOpts) => {
      if (proxyReqOpts.headers) {
        proxyReqOpts.headers['accept-encoding'] = 'gzip';
      }
      return proxyReqOpts;
    },
    proxyReqPathResolver: (req) => {
      // Replace '/' with `/${startId}`
      return req.url.replace(/\/(\?|$)/, `/${startId}$1`);
    },
    userResHeaderDecorator: (headers) => {
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
        const proto = userReq.get('x-forwarded-proto') || 'http';
        const host = userReq.get('x-forwarded-host') || userReq.get('host');

        return proxyResData
          .toString()
          .replace(/^/, ncd)
          .replace(/window.location.href(?=[^=]|={2,})/g, 'ncd.href()') // Exclude 'window.locaton.href=' but not 'window.locaton.href=='
          .replace(/window.history.(pushState|replaceState)/g, 'ncd.$1')
          .replace(/https:\/\/(www.)?notion.so/g, `${proto}://${host}`);
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
