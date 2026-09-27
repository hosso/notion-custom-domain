const CUSTOM_STYLE = `
  .notion-topbar > div > div:nth-last-child(1), .notion-topbar > div > div:nth-last-child(2) {
    display:none !important;
  }
  .notion-topbar-mobile > div:nth-child(2) > div:nth-child(2) {
    display:none !important;
  }
`;

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

const CUSTOM_SCRIPT = `<script>
(() => {
  const replacedUrl = (url) => {
    const [, domain] = /^https?:\\/\\/([^\\/]*)/.exec(url) || ['', ''];
    if (
      (domain.endsWith('notion.so') &&
        !domain.endsWith('msgstore.www.notion.so')) ||
      domain === 'exp.notion.com' ||
      domain.endsWith('splunkcloud.com') ||
      domain.endsWith('statsigapi.net')
    ) {
      console.info('[NCD]', 'Suppress request:', url);
      return url.replace(/^.*:(.*)\\/\\//, '/200/$1');
    }
    return url;
  };

  window.fetch = new Proxy(window.fetch, {
    apply: (target, that, [url, ...rest]) =>
      Reflect.apply(target, that, [replacedUrl(url), ...rest]),
  });

  window.XMLHttpRequest = new Proxy(XMLHttpRequest, {
    construct: (target, args) => {
      const xhr = new target(...args);
      xhr.open = new Proxy(xhr.open, {
        apply: (target, that, [method, url, ...rest]) =>
          Reflect.apply(target, that, [method, replacedUrl(url), ...rest]),
      });
      return xhr;
    },
  });
})();
</script>`;

function createLocationProxyScript(pageDomain: string, pageId: string) {
  return `<script>
(() => {
  const { pageDomain, pageId } = ${JSON.stringify({ pageDomain, pageId })};
  window.ncd = {
    _pageId: pageId,
    _pageDomain: pageDomain,
    _myUrl(url) {
      return url
        .replace(location.origin, this._pageDomain)
        .replace(/\\/(?=\\?|$)/, '/' + this._pageId);
    },
    _yourUrl(url) {
      return url
        .replace(this._pageDomain, location.origin)
        .replace(
          new RegExp('(^|[^/])\\\\/[^/].*' + this._pageId + '(?=\\\\?|$)'),
          '$1/',
        );
    },
    href() {
      return this._myUrl(location.href);
    },
  };

  const proxyHistoryMethod = (method) =>
    new Proxy(method, {
      apply: (target, that, [data, unused, url]) =>
        Reflect.apply(target, that, [data, unused, window.ncd._yourUrl(url)]),
    });
  window.history.pushState = proxyHistoryMethod(window.history.pushState);
  window.history.replaceState = proxyHistoryMethod(window.history.replaceState);
})();
</script>`;
}

export function createInjectedHeadMarkup(pageDomain: string, pageId: string) {
  const css = CUSTOM_STYLE.replace(/\s+/g, ' ').trim();
  return `${createLocationProxyScript(pageDomain, pageId)}${CUSTOM_SCRIPT}<style>${css}</style>`;
}

export function createAnalyticsMarkup(measurementId?: string) {
  if (!measurementId) return '';

  return `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${measurementId}');
</script>`;
}
