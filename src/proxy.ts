/**
 * Design notes:
 * - This module relays requests to one configured public Notion page. `/` maps
 *   to that page ID so the custom domain is the canonical entry point.
 * - `/200/` is a deliberate local success response for browser requests that
 *   `rewrites.ts` suppresses; the rewrite and stub must be introduced together.
 * - HTML is buffered to inject markup. JavaScript assets are transformed as
 *   gzip-aware streams so large runtime assets are never fully buffered.
 * - Transforming a response invalidates its length, encoding, and ETag. Stable
 *   `/_assets/` responses omit cookies so Vercel can cache them publicly.
 */
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';
import {
  addAnalyticsSourcesToCsp,
  RuntimeAssetTransform,
  rewriteCookieDomains,
  rewriteHtml,
  rewriteSharedResponseContent,
} from './rewrites.js';

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

export interface ProxyConfig {
  analyticsMarkup: string;
  injectedHeadMarkup: string;
  pageDomain: string;
  pageId: string;
}

export function isCacheableStaticAsset(requestUrl: string, statusCode: number) {
  return statusCode === 200 && STATIC_ASSET_PATTERN.test(requestUrl);
}

export function getRequestHostname(req: http.IncomingMessage) {
  const host = req.headers.host;
  if (!host) return 'localhost';

  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return 'localhost';
  }
}

function getRequestUrl(req: http.IncomingMessage) {
  return req.url ?? '/';
}

function getProxyPath(url: string, pageId: string) {
  return url.replace(/\/(\?|$)/, `/${pageId}$1`);
}

function isPseudoSuccessEndpoint(url: string) {
  return /^\/200\/?/.test(url);
}

function sendText(res: http.ServerResponse, statusCode: number, body: string) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(body);
}

function handlePseudoSuccessEndpoint(url: string, res: http.ServerResponse) {
  if (url.startsWith(PUBLIC_PAGE_DATA_ENDPOINT)) {
    sendText(res, 200, 'success');
  } else if (url.startsWith(EXPERIMENT_ENDPOINT)) {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ success: true }));
  } else {
    res.statusCode = 200;
    res.end();
  }
}

function shouldRewriteHtml(req: http.IncomingMessage) {
  const requestUrl = getRequestUrl(req);
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (
    STATIC_ASSET_PATTERN.test(requestUrl) ||
    PASSTHROUGH_REQUEST_PATTERN.test(requestUrl)
  ) {
    return false;
  }

  const pathname = new URL(requestUrl, 'http://localhost').pathname;
  return (
    req.headers.accept?.includes('text/html') ||
    pathname === '/' ||
    !path.posix.basename(pathname).includes('.')
  );
}

function copyResponseHeaders(
  upstreamHeaders: http.IncomingHttpHeaders,
  res: http.ServerResponse,
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

function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ProxyConfig,
) {
  const requestUrl = getRequestUrl(req);
  const rewriteHtmlResponse = shouldRewriteHtml(req);
  const rewriteRuntimeResponse =
    JAVASCRIPT_ASSET_PATTERN.test(requestUrl) &&
    !PASSTHROUGH_JAVASCRIPT_PATTERN.test(requestUrl);
  const transformed = rewriteHtmlResponse || rewriteRuntimeResponse;
  const target = new URL(
    getProxyPath(requestUrl, config.pageId),
    config.pageDomain,
  );
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
        getRequestHostname(req),
        requestUrl,
        res.statusCode,
        transformed,
      );

      const handleStreamError = (error: NodeJS.ErrnoException | null) => {
        if (!error) return;
        if (!res.headersSent) {
          sendText(res, 502, 'Bad Gateway');
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
          res.end(
            rewriteSharedResponseContent(
              rewriteHtml(
                html,
                config.injectedHeadMarkup,
                config.analyticsMarkup,
              ),
            ),
          );
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
          sendText(res, 502, 'Unsupported upstream content encoding');
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
      sendText(res, 502, 'Bad Gateway');
    } else {
      res.destroy(error);
    }
  });
  req.on('aborted', () => upstreamRequest.destroy());
  req.pipe(upstreamRequest);
}

export function createHandler(config: ProxyConfig) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const requestUrl = getRequestUrl(req);
    if (isPseudoSuccessEndpoint(requestUrl)) {
      handlePseudoSuccessEndpoint(requestUrl, res);
      return;
    }
    proxyRequest(req, res, config);
  };
}
