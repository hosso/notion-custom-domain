import express from 'express';
import proxy from 'express-http-proxy';

const START_PAGE =
  process.env.START_PAGE ||
  'https://www.notion.so/Notion-Official-83715d7703ee4b8699b5e659a4712dd8';

const startId = START_PAGE.replace(/^.*-/, '');

// Map start page path to "/"
const ncd = `var ncd={
  href:function(){return location.href.replace(/\\/(?=\\?|$)/,"/${startId}")},
  pushState:function(a,b,url){history.pushState(a,b,url.replace(/\\/[^/]*${startId}(?=\\?|$)/,"/"))},
  replaceState:function(a,b,url){history.replaceState(a,b,url.replace(/\\/[^/]*${startId}(?=\\?|$)/,"/"))}
};`.replace(/\n */gm, '');

const app = express();

app.use(
  proxy('https://www.notion.so', {
    proxyReqOptDecorator: (proxyReqOpts) => {
      if (proxyReqOpts.headers) {
        proxyReqOpts.headers['accept-encoding'] = 'gzip';
      }
      return proxyReqOpts;
    },
    userResDecorator: (_proxyRes, proxyResData, userReq) => {
      const proto = userReq.get('x-forwarded-proto') || 'http';
      const host = userReq.get('x-forwarded-host') || userReq.get('host');

      return proxyResData
        .toString()
        .replace(/^/, ncd)
        .replace(/window.location.href(?=[^=]|={2,})/g, 'ncd.href()') // Exclude 'window.locaton.href=' but not 'window.locaton.href=='
        .replace(/window.history.(pushState|replaceState)/g, 'ncd.$1')
        .replace(/https:\/\/(www.)?notion.so/g, `${proto}://${host}`);
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
