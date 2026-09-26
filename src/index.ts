import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pipeline, Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { URL } from 'node:url';
import { createGunzip, createGzip } from 'node:zlib';
import express from 'express';

const {
  PAGE_URL = 'https://notion.notion.site/Notion-Official-83715d7703ee4b8699b5e659a4712dd8',
  GA_MEASUREMENT_ID,
} = process.env;

const GOOGLE_ANALYTICS_SOURCES =
  'https://www.googletagmanager.com https://www.google-analytics.com';
const CUSTOM_STYLE = `
  .notion-topbar > div > div:nth-last-child(1), .notion-topbar > div > div:nth-last-child(2) {
    display:none !important;
  }
  .notion-topbar-mobile > div:nth-child(2) > div:nth-child(2) {
    display:none !important;
  }
`;
const LOCATION_HREF_PATTERN = /window\.location\.href(?=[^=]|={2,})/g;
const STATIC_ASSET_PATTERN = /^\/_assets\//;
const PASSTHROUGH_REQUEST_PATTERN = /^\/(image[s]?|api)\//;
const JAVASCRIPT_ASSET_PATTERN = /^\/_assets\/[^/]+\.js(?:\?|$)/;
const PASSTHROUGH_JAVASCRIPT_PATTERN =
  /^\/_assets\/localeSetup-[^/]+\.js(?:\?|$)/;
const PUBLIC_PAGE_DATA_ENDPOINT = '/200/www.notion.so/api/v3/';
const EXPERIMENT_ENDPOINT = '/200/exp.notion.so/v1/';
const UPSTREAM_TIMEOUT_MS = 20_000;
const STATIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const VERCEL_STATIC_CACHE_CONTROL =
  'public, s-maxage=31536000, stale-if-error=86400';

export function isCacheableStaticAsset(requestUrl: string, statusCode: number) {
  return statusCode === 200 && STATIC_ASSET_PATTERN.test(requestUrl);
}

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

  const proxyHistoryMethod = (method: typeof window.history.pushState) =>
    new Proxy(method, {
      apply: (target, that, [data, unused, url]) =>
        Reflect.apply(target, that, [data, unused, window.ncd._yourUrl(url)]),
    });
  window.history.pushState = proxyHistoryMethod(window.history.pushState);
  window.history.replaceState = proxyHistoryMethod(window.history.replaceState);
};

function getLocationProxyScript() {
  return `(${locationProxy.toString()})(${JSON.stringify(pageDomain)},${JSON.stringify(pageId)})`;
}

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
    apply: (target, that, [url, ...rest]) => {
      url = replacedUrl(url);
      return Reflect.apply(target, that, [url, ...rest]);
    },
  });

  window.XMLHttpRequest = new Proxy(XMLHttpRequest, {
    construct: (target, args) => {
      // @ts-expect-error A spread argument must either have a tuple type or be passed to a rest parameter.
      const xhr = new target(...args);
      xhr.open = new Proxy(xhr.open, {
        apply: (target, that, [method, url, ...rest]) => {
          url = replacedUrl(url);
          return Reflect.apply(target, that, [method, url, ...rest]);
        },
      });
      return xhr;
    },
  });
};

function getCustomScript() {
  return `<script>(${customScript.toString()})()</script>`;
}

function getCustomStyle() {
  const css = CUSTOM_STYLE.replace(/\s+/g, ' ').trim();
  return `<style>${css}</style>`;
}

const injectedHeadMarkup = `<script>${getLocationProxyScript()}</script>${getCustomScript()}${getCustomStyle()}`;

function getProxyPath(url: string) {
  return url.replace(/\/(\?|$)/, `/${pageId}$1`);
}

export function rewriteCookieDomains(cookies: string[], hostname: string) {
  return cookies.map((cookie) =>
    cookie.replace(
      /((?:^|; )Domain=)(?:[^.]+\.)?notion\.site(;|$)/gi,
      `$1${hostname}$2`,
    ),
  );
}

export function addAnalyticsSourcesToCsp(csp: string) {
  return csp.replace(
    /(?=(script-src|connect-src) )[^;]*/g,
    `$& ${GOOGLE_ANALYTICS_SOURCES}`,
  );
}

export function isPseudoSuccessEndpoint(url: string) {
  return /^\/200\/?/.test(url);
}

function handlePseudoSuccessEndpoint(url: string, res: express.Response) {
  if (url.startsWith(PUBLIC_PAGE_DATA_ENDPOINT)) {
    res.send('success');
  } else if (url.startsWith(EXPERIMENT_ENDPOINT)) {
    res.json({ success: true });
  } else {
    res.end();
  }
}

export function rewriteRuntimeAsset(data: string) {
  return data.replace(LOCATION_HREF_PATTERN, 'window.ncd.href()');
}

export function rewriteHtml(data: string) {
  return data
    .replace('</head>', `${injectedHeadMarkup}</head>`)
    .replace('</body>', `${ga}</body>`);
}

export function rewriteSharedResponseContent(data: string) {
  return data
    .replace(
      /https:\/\/((aif\.notion\.so|widget\.intercom\.io)\/?[^"`]*)/g,
      `/200/$1`,
    )
    .replace(/\w+\.init\({dsn:/, 'return;$&');
}

const STREAM_REPLACEMENTS = [
  ['window.location.href', 'window.ncd.href()'],
  ['https://aif.notion.so', '/200/aif.notion.so'],
  ['https://widget.intercom.io', '/200/widget.intercom.io'],
  ['.init({dsn:', ''],
] as const;

/**
 * Rewrites fixed strings without buffering the complete JavaScript asset.
 * The unprocessed suffix is kept between chunks so matches split across
 * network chunks are handled correctly.
 */
export class RuntimeAssetTransform extends Transform {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private readonly longestSearch = Math.max(
    128,
    ...STREAM_REPLACEMENTS.map(([search]) => search.length),
  );

  private process(data: string, flush = false) {
    const safeStartLimit = flush
      ? data.length
      : Math.max(0, data.length - this.longestSearch + 1);
    let cursor = 0;
    let output = '';

    while (cursor < safeStartLimit) {
      let nextIndex = -1;
      let nextReplacement: (typeof STREAM_REPLACEMENTS)[number] | undefined;

      for (const replacement of STREAM_REPLACEMENTS) {
        const index = data.indexOf(replacement[0], cursor);
        if (index !== -1 && (nextIndex === -1 || index < nextIndex)) {
          nextIndex = index;
          nextReplacement = replacement;
        }
      }

      if (nextIndex === -1 || nextIndex >= safeStartLimit || !nextReplacement) {
        output += data.slice(cursor, safeStartLimit);
        cursor = safeStartLimit;
        break;
      }

      const [search, replacement] = nextReplacement;
      const nextCharacter = data[nextIndex + search.length];
      const followingCharacter = data[nextIndex + search.length + 1];
      if (search === '.init({dsn:') {
        let identifierStart = nextIndex;
        while (
          identifierStart > cursor &&
          /\w/.test(data[identifierStart - 1])
        ) {
          identifierStart -= 1;
        }
        output +=
          data.slice(cursor, identifierStart) +
          (identifierStart < nextIndex ? 'return;' : '') +
          data.slice(identifierStart, nextIndex) +
          search;
        cursor = nextIndex + search.length;
        continue;
      }

      const shouldKeepLocationHref =
        search === 'window.location.href' &&
        (nextCharacter === undefined ||
          (nextCharacter === '=' && followingCharacter !== '='));

      output +=
        data.slice(cursor, nextIndex) +
        (shouldKeepLocationHref ? search : replacement);
      cursor = nextIndex + search.length;
    }

    return { output, pending: data.slice(cursor) };
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    const data = this.pending + this.decoder.write(chunk);
    const result = this.process(data);
    this.push(result.output);
    this.pending = result.pending;
    callback();
  }

  override _flush(callback: (error?: Error | null) => void) {
    this.push(this.process(this.pending + this.decoder.end(), true).output);
    callback();
  }
}

function shouldRewriteHtml(req: express.Request) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (
    STATIC_ASSET_PATTERN.test(req.url) ||
    PASSTHROUGH_REQUEST_PATTERN.test(req.url)
  ) {
    return false;
  }

  const pathname = new URL(req.url, 'http://localhost').pathname;
  return (
    req.headers.accept?.includes('text/html') ||
    pathname === '/' ||
    !path.posix.basename(pathname).includes('.')
  );
}

function copyResponseHeaders(
  upstreamHeaders: http.IncomingHttpHeaders,
  res: express.Response,
  hostname: string,
  requestUrl: string,
  statusCode: number,
  transformed: boolean,
) {
  const cacheableStaticAsset = isCacheableStaticAsset(requestUrl, statusCode);
  const hopByHopHeaders = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]);

  for (const [name, value] of Object.entries(upstreamHeaders)) {
    if (value === undefined || hopByHopHeaders.has(name)) continue;
    // Notion's CDN adds bot-management cookies to immutable assets. Forwarding
    // them makes Vercel treat each response as personalized and bypass its CDN.
    if (cacheableStaticAsset && name === 'set-cookie') continue;
    if (
      transformed &&
      ['content-length', 'content-encoding', 'etag', 'content-md5'].includes(
        name,
      )
    ) {
      continue;
    }
    res.setHeader(name, value);
  }

  const cookies = upstreamHeaders['set-cookie'];
  if (cookies && !cacheableStaticAsset) {
    res.setHeader('set-cookie', rewriteCookieDomains(cookies, hostname));
  }

  const csp = upstreamHeaders['content-security-policy'];
  if (typeof csp === 'string') {
    res.setHeader('content-security-policy', addAnalyticsSourcesToCsp(csp));
  }

  if (cacheableStaticAsset) {
    res.setHeader('cache-control', STATIC_CACHE_CONTROL);
    res.setHeader('vercel-cdn-cache-control', VERCEL_STATIC_CACHE_CONTROL);
  }
}

function proxyRequest(req: express.Request, res: express.Response) {
  const rewriteHtmlResponse = shouldRewriteHtml(req);
  const rewriteRuntimeResponse =
    JAVASCRIPT_ASSET_PATTERN.test(req.url) &&
    !PASSTHROUGH_JAVASCRIPT_PATTERN.test(req.url);
  const transformed = rewriteHtmlResponse || rewriteRuntimeResponse;
  const target = new URL(getProxyPath(req.url), pageDomain);
  const headers: http.OutgoingHttpHeaders = {
    ...req.headers,
    host: target.host,
  };

  if (rewriteHtmlResponse) {
    headers['accept-encoding'] = 'identity';
  } else if (rewriteRuntimeResponse) {
    // gzip is supported by Node's streaming zlib implementation. Requesting a
    // known encoding keeps the upstream transfer small while avoiding a full
    // response buffer before rewriting.
    headers['accept-encoding'] = 'gzip';
  }

  const transport = target.protocol === 'https:' ? https : http;
  const upstreamRequest = transport.request(
    target,
    {
      method: req.method,
      headers,
    },
    (upstreamResponse) => {
      res.statusCode = upstreamResponse.statusCode ?? 502;
      if (upstreamResponse.statusMessage) {
        res.statusMessage = upstreamResponse.statusMessage;
      }
      copyResponseHeaders(
        upstreamResponse.headers,
        res,
        req.hostname,
        req.url,
        res.statusCode,
        transformed,
      );

      const handleStreamError = (error: NodeJS.ErrnoException | null) => {
        if (!error) return;
        if (!res.headersSent) {
          res.status(502).send('Bad Gateway');
        } else if (!res.destroyed) {
          res.destroy(error);
        }
      };

      if (req.method === 'HEAD') {
        upstreamResponse.resume();
        res.end();
        return;
      }

      if (rewriteHtmlResponse) {
        const chunks: Buffer[] = [];
        upstreamResponse.on('data', (chunk: Buffer) => chunks.push(chunk));
        upstreamResponse.on('error', handleStreamError);
        upstreamResponse.on('end', () => {
          const html = Buffer.concat(chunks).toString();
          res.send(rewriteSharedResponseContent(rewriteHtml(html)));
        });
        return;
      }

      if (rewriteRuntimeResponse) {
        const contentEncoding = upstreamResponse.headers['content-encoding'];
        if (contentEncoding === 'gzip') {
          res.setHeader('content-encoding', 'gzip');
          res.flushHeaders();
          pipeline(
            upstreamResponse,
            createGunzip(),
            new RuntimeAssetTransform(),
            createGzip(),
            res,
            handleStreamError,
          );
        } else if (!contentEncoding || contentEncoding === 'identity') {
          res.flushHeaders();
          pipeline(
            upstreamResponse,
            new RuntimeAssetTransform(),
            res,
            handleStreamError,
          );
        } else {
          upstreamResponse.destroy();
          res.status(502).send('Unsupported upstream content encoding');
        }
      } else {
        res.flushHeaders();
        pipeline(upstreamResponse, res, handleStreamError);
      }
    },
  );

  upstreamRequest.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
    upstreamRequest.destroy(new Error('Upstream request timed out'));
  });
  upstreamRequest.on('error', (error) => {
    if (!res.headersSent) {
      res.status(502).send('Bad Gateway');
    } else {
      res.destroy(error);
    }
  });
  req.on('aborted', () => upstreamRequest.destroy());
  req.pipe(upstreamRequest);
}

const app = express();

app.use((req, res, next) => {
  if (isPseudoSuccessEndpoint(req.url)) {
    handlePseudoSuccessEndpoint(req.url, res);
    return;
  }
  next();
});

app.use(proxyRequest);

if (!process.env.VERCEL_REGION && !process.env.NOW_REGION) {
  const port = process.env.PORT || 3000;
  app.listen(port, () =>
    console.log(`Server running at http://localhost:${port}`),
  );
}

export default app;
