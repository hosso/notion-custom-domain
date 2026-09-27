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

export function createInjectedHeadMarkup(pageDomain: string, pageId: string) {
  const locationScript = `(${locationProxy.toString()})(${JSON.stringify(pageDomain)},${JSON.stringify(pageId)})`;
  const script = `<script>(${customScript.toString()})()</script>`;
  const css = CUSTOM_STYLE.replace(/\s+/g, ' ').trim();
  return `<script>${locationScript}</script>${script}<style>${css}</style>`;
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
