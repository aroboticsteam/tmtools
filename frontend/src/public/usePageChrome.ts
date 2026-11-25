import { useEffect } from 'react';

interface Chrome {
  title?: string;
  /** Inline styles for <body> (e.g. transparent OBS pages). */
  body?: Partial<CSSStyleDeclaration>;
  /** Value for <meta name="theme-color">. */
  themeColor?: string;
  /** Add a <link rel="manifest">. */
  manifest?: string;
  /** Extra <meta name=..> tags. */
  meta?: Record<string, string>;
}

/**
 * Per-page document chrome for the standalone public pages: title, body style,
 * theme colour, PWA manifest. Everything is restored on unmount so the admin
 * shell is unaffected when navigating client-side.
 */
export function usePageChrome(chrome: Chrome): void {
  const { title, themeColor, manifest } = chrome;
  const bodyJson = JSON.stringify(chrome.body ?? {});
  const metaJson = JSON.stringify(chrome.meta ?? {});

  useEffect(() => {
    if (title === undefined) return undefined;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);

  useEffect(() => {
    const style = JSON.parse(bodyJson) as Record<string, string>;
    const html = document.documentElement;
    const saved: [string, string][] = [];
    const targets: [HTMLElement, string, string][] = [];
    for (const [key, value] of Object.entries(style)) {
      targets.push([document.body, key, value]);
      if (key === 'background' || key === 'overflow' || key === 'width' || key === 'height') targets.push([html, key, value]);
    }
    for (const [el, key, value] of targets) {
      saved.push([key, (el.style as unknown as Record<string, string>)[key]]);
      (el.style as unknown as Record<string, string>)[key] = value;
    }
    return () => {
      targets.forEach(([el, key], i) => {
        (el.style as unknown as Record<string, string>)[key] = saved[i][1];
      });
    };
  }, [bodyJson]);

  useEffect(() => {
    if (!themeColor) return undefined;
    let tag = document.querySelector<HTMLMetaElement>('meta[name=theme-color]');
    const created = !tag;
    if (!tag) {
      tag = document.createElement('meta');
      tag.name = 'theme-color';
      document.head.appendChild(tag);
    }
    const previous = tag.getAttribute('content');
    tag.setAttribute('content', themeColor);
    return () => {
      if (created) tag!.remove();
      else if (previous !== null) tag!.setAttribute('content', previous);
    };
  }, [themeColor]);

  useEffect(() => {
    if (!manifest) return undefined;
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = manifest;
    document.head.appendChild(link);
    return () => link.remove();
  }, [manifest]);

  useEffect(() => {
    const entries = Object.entries(JSON.parse(metaJson) as Record<string, string>);
    const tags = entries.map(([name, content]) => {
      const tag = document.createElement('meta');
      tag.name = name;
      tag.content = content;
      document.head.appendChild(tag);
      return tag;
    });
    return () => tags.forEach((t) => t.remove());
  }, [metaJson]);
}
