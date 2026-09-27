/**
 * Design notes:
 * - Rewrites intentionally match exact strings in Notion's generated output;
 *   a Notion client change therefore requires corresponding test updates.
 * - AIF and Intercom are routed to `/200/`, while Sentry initialization is
 *   disabled. `proxy.ts` owns the matching local success responses.
 * - `window.location.href` reads are redirected through `window.ncd`; writes
 *   remain unchanged so Notion's own navigation behavior is preserved.
 * - Runtime assets are chunked streams. Retaining an unprocessed suffix makes
 *   matches spanning chunks safe; tests cover every possible chunk boundary.
 */
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

const GOOGLE_ANALYTICS_SOURCES =
  'https://www.googletagmanager.com https://www.google-analytics.com';

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

export function rewriteRuntimeAsset(data: string) {
  return data.replace(
    /window\.location\.href(?=[^=]|={2,})/g,
    'window.ncd.href()',
  );
}

export function rewriteHtml(
  data: string,
  injectedHeadMarkup: string,
  analyticsMarkup: string,
) {
  return data
    .replace('</head>', `${injectedHeadMarkup}</head>`)
    .replace('</body>', `${analyticsMarkup}</body>`);
}

export function rewriteSharedResponseContent(data: string) {
  return data
    .replace(/https:\/\/(aif\.notion\.so\/?[^"`]*)/g, `/200/$1`)
    .replace(/https:\/\/(widget\.intercom\.io\/?[^"`]*)/g, `/200/$1`)
    .replace(/\w+\.init\({dsn:/, 'return;$&');
}

/**
 * Rewrites fixed strings without buffering the complete JavaScript asset.
 * The unprocessed suffix is kept between chunks so matches split across
 * network chunks are handled correctly.
 */
export class RuntimeAssetTransform extends Transform {
  private static readonly replacements = [
    ['window.location.href', 'window.ncd.href()'],
    ['https://aif.notion.so', '/200/aif.notion.so'],
    ['https://widget.intercom.io', '/200/widget.intercom.io'],
    ['.init({dsn:', ''],
  ] as const;

  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private readonly longestSearch = Math.max(
    128,
    ...RuntimeAssetTransform.replacements.map(([search]) => search.length),
  );

  private process(data: string, flush = false) {
    const safeStartLimit = flush
      ? data.length
      : Math.max(0, data.length - this.longestSearch + 1);
    let cursor = 0;
    let output = '';

    while (cursor < safeStartLimit) {
      let nextIndex = -1;
      let nextReplacement:
        | (typeof RuntimeAssetTransform.replacements)[number]
        | undefined;

      for (const replacement of RuntimeAssetTransform.replacements) {
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
