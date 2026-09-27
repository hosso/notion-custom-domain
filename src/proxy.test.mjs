import assert from 'node:assert/strict';
import test from 'node:test';
import { getRequestHostname, isCacheableStaticAsset } from './proxy.ts';

test('request hostname excludes the local port used for cookie rewriting', () => {
  assert.equal(
    getRequestHostname({ headers: { host: 'preview.example.com:3200' } }),
    'preview.example.com',
  );
  assert.equal(getRequestHostname({ headers: {} }), 'localhost');
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
