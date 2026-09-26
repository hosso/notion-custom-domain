import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import {
  addAnalyticsSourcesToCsp,
  isCacheableStaticAsset,
  RuntimeAssetTransform,
  rewriteCookieDomains,
  rewriteRuntimeAsset,
} from './index.ts';

async function transformInChunks(input, splitAt) {
  const transform = new RuntimeAssetTransform();
  const chunks = [];
  transform.on('data', (chunk) => chunks.push(chunk));

  transform.write(Buffer.from(input.slice(0, splitAt)));
  transform.end(Buffer.from(input.slice(splitAt)));
  await once(transform, 'finish');

  return Buffer.concat(chunks).toString();
}

test('runtime asset rewriting works across every chunk boundary', async () => {
  const input = [
    'before window.location.href after',
    'https://aif.notion.so/example',
    'https://widget.intercom.io/widget',
    't.init({dsn:"https://example.com"})',
  ].join('|');
  const expected = [
    'before window.ncd.href() after',
    '/200/aif.notion.so/example',
    '/200/widget.intercom.io/widget',
    'return;t.init({dsn:"https://example.com"})',
  ].join('|');

  for (let splitAt = 0; splitAt <= input.length; splitAt += 1) {
    assert.equal(await transformInChunks(input, splitAt), expected);
  }
});

test('runtime asset rewriting does not replace location assignments', async () => {
  const input =
    'window.location.href="/next";const current=window.location.href;const same=window.location.href===url';
  const expected =
    'window.location.href="/next";const current=window.ncd.href();const same=window.ncd.href()===url';

  assert.equal(rewriteRuntimeAsset(input), expected);
  assert.equal(await transformInChunks(input, 25), expected);
});

test('cookie domains are rewritten for the custom host', () => {
  assert.deepEqual(
    rewriteCookieDomains(
      [
        'token=value; Domain=bittersweet-sturgeon-42d.notion.site; Path=/',
        'other=value; Path=/',
      ],
      'example.com',
    ),
    ['token=value; Domain=example.com; Path=/', 'other=value; Path=/'],
  );
});

test('only successful static assets are eligible for shared CDN caching', () => {
  assert.equal(isCacheableStaticAsset('/_assets/runtime.js', 200), true);
  assert.equal(
    isCacheableStaticAsset('/_assets/runtime.js?cache=1', 200),
    true,
  );
  assert.equal(isCacheableStaticAsset('/_assets/runtime.js', 404), false);
  assert.equal(isCacheableStaticAsset('/api/v3/loadPageChunk', 200), false);
});

test('analytics origins are added to script and connect CSP directives', () => {
  const csp = addAnalyticsSourcesToCsp(
    "default-src 'self';script-src 'self';connect-src 'self';img-src https:",
  );

  assert.match(
    csp,
    /script-src 'self' https:\/\/www\.googletagmanager\.com https:\/\/www\.google-analytics\.com/,
  );
  assert.match(
    csp,
    /connect-src 'self' https:\/\/www\.googletagmanager\.com https:\/\/www\.google-analytics\.com/,
  );
});
