import express from 'express';
import proxy from 'express-http-proxy';

const app = express();

app.use(
  '/',
  proxy('https://www.notion.so', {
    proxyReqOptDecorator: (proxyReqOpts) => {
      if (proxyReqOpts.headers) {
        proxyReqOpts.headers['accept-encoding'] = '';
      }
      return proxyReqOpts;
    },
    userResDecorator: (_proxyRes, proxyResData, userReq) => {
      const proto = userReq.get('x-forwarded-proto') || 'http';
      const host = userReq.get('x-forwarded-host') || userReq.get('host');
      return proxyResData
        .toString()
        .replace(/https:\/\/(www.)?notion.so/g, `${proto}://${host}`);
    },
  }),
);

if (!process.env.NOW_REGION) {
  const port = process.env.PORT || 3000;
  app.listen(port, () =>
    console.log(`Server running at http://localhost:${port}`),
  );
}

export default app;
