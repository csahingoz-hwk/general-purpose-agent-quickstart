import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  observeDocumentTitleLocale,
  syncDocumentLocale,
  UiLocaleDocumentSync,
} from "../../components/ui-locale-document-sync";
import {
  detectBrowserLocale,
  readStoredLocalePreference,
  useUiLocale,
} from "../../hooks/use-ui-locale";
import { dedupeTurnMemoryCardsAcrossMessages } from "../../lib/memory/bulk-import";

const ROOT = resolve(import.meta.dirname, "../..");

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

type MockObserverInstance = {
  target: unknown;
  options: unknown;
  disconnected: boolean;
  callback: () => void;
  callbackCount: number;
  pendingRecords: Array<{ type: string; target: unknown }>;
  flushScheduled: boolean;
};

function installMockBrowserDom(opts: {
  initialTitle: string;
  initialLang: string;
  storedLocale?: string | null;
  navigatorLanguage?: string;
  navigatorLanguages?: string[];
  maxTitleWrites?: number;
}) {
  const titleWrites: string[] = [];
  const langWrites: string[] = [];
  const observers: MockObserverInstance[] = [];
  const maxWrites = opts.maxTitleWrites ?? 20;

  let currentTitle = opts.initialTitle;
  let currentLang = opts.initialLang;
  const storageMap = new Map<string, string>();
  if (opts.storedLocale != null) {
    storageMap.set("assistant-ui-locale", opts.storedLocale);
  }

  const titleElement = {
    tagName: "TITLE",
    get textContent() {
      return currentTitle;
    },
    set textContent(next: string) {
      currentTitle = next;
    },
  };

  const headSentinel = {
    tagName: "HEAD",
    querySelector(selector: string) {
      return selector === "title" ? titleElement : null;
    },
  };

  const notifyObservers = (
    target: unknown,
    type: "childList" | "characterData"
  ) => {
    for (const obs of observers) {
      if (obs.disconnected) {
        continue;
      }
      const matchesTarget =
        obs.target === target ||
        (obs.target === headSentinel && target === titleElement);
      if (!matchesTarget) {
        continue;
      }
      obs.pendingRecords.push({ type, target });
      if (!obs.flushScheduled) {
        obs.flushScheduled = true;
        queueMicrotask(() => {
          obs.flushScheduled = false;
          if (obs.disconnected || obs.pendingRecords.length === 0) {
            return;
          }
          obs.pendingRecords.length = 0;
          obs.callbackCount += 1;
          obs.callback();
        });
      }
    }
  };

  const documentElement = {
    get lang() {
      return currentLang;
    },
    set lang(next: string) {
      langWrites.push(next);
      currentLang = next;
    },
  };

  const mockDocument = {
    head: headSentinel,
    documentElement,
    get title() {
      return currentTitle;
    },
    set title(next: string) {
      titleWrites.push(next);
      if (titleWrites.length > maxWrites) {
        throw new Error(
          `Unbounded document.title write loop detected (${titleWrites.length} writes): ${titleWrites.slice(-6).join(" -> ")}`
        );
      }
      currentTitle = next;
      notifyObservers(titleElement, "childList");
    },
  };

  class MockMutationObserver {
    private readonly instance: MockObserverInstance;

    constructor(callback: () => void) {
      this.instance = {
        target: null,
        options: null,
        disconnected: false,
        callback,
        callbackCount: 0,
        pendingRecords: [],
        flushScheduled: false,
      };
      observers.push(this.instance);
    }

    observe(target: unknown, options?: unknown) {
      this.instance.target = target;
      this.instance.options = options;
    }

    takeRecords() {
      return this.instance.pendingRecords.splice(0);
    }

    disconnect() {
      this.instance.disconnected = true;
      this.instance.pendingRecords.length = 0;
    }
  }

  const mockWindow = {
    localStorage: {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storageMap.set(key, value);
      },
      removeItem: (key: string) => {
        storageMap.delete(key);
      },
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  };

  const mockNavigator = {
    language: opts.navigatorLanguage ?? "tr-TR",
    languages: opts.navigatorLanguages ?? ["tr-TR", "tr"],
  };

  const prevDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator"
  );
  const prevMutationObserver = Object.getOwnPropertyDescriptor(
    globalThis,
    "MutationObserver"
  );

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: mockDocument,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: mockWindow,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: mockNavigator,
  });
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    writable: true,
    value: MockMutationObserver,
  });

  const restore = () => {
    const restoreProp = (key: string, desc: PropertyDescriptor | undefined) => {
      if (desc) {
        Object.defineProperty(globalThis, key, desc);
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    };
    restoreProp("document", prevDocument);
    restoreProp("window", prevWindow);
    restoreProp("navigator", prevNavigator);
    restoreProp("MutationObserver", prevMutationObserver);
  };

  const simulateNextMetadataTitleCommit = (nextTitle: string) => {
    currentTitle = nextTitle;
    notifyObservers(titleElement, "characterData");
  };

  const simulateUnrelatedHeadMutation = () => {
    notifyObservers(headSentinel, "childList");
  };

  return {
    mockDocument,
    headSentinel,
    titleElement,
    titleWrites,
    langWrites,
    observers,
    storageMap,
    simulateNextMetadataTitleCommit,
    simulateUnrelatedHeadMutation,
    restore,
  };
}

test("Regression: useUiLocale creates zero MutationObservers and never writes document.title directly", () => {
  const hookSrc = readFileSync(resolve(ROOT, "hooks/use-ui-locale.ts"), "utf8");

  assert.doesNotMatch(
    hookSrc,
    /\bMutationObserver\b/,
    "hooks/use-ui-locale.ts must not create any MutationObserver"
  );
  assert.doesNotMatch(
    hookSrc,
    /\.observe\s*\(\s*document\.head/,
    "hooks/use-ui-locale.ts must not observe document.head"
  );
  assert.doesNotMatch(
    hookSrc,
    /\bdocument\.title\s*=/,
    "hooks/use-ui-locale.ts must not assign document.title per hook caller"
  );
  assert.doesNotMatch(
    hookSrc,
    /\bdocument\.documentElement\.lang\s*=/,
    "hooks/use-ui-locale.ts must not mutate document.documentElement.lang per hook caller"
  );
});

test("Regression: document.title and its single <title>-only MutationObserver live solely in UiLocaleDocumentSync mounted once in AppProviders", () => {
  const searchRoots = ["hooks", "components", "app"].map((d) =>
    resolve(ROOT, d)
  );
  const titleWriteSites: string[] = [];
  const headObserverSites: string[] = [];
  const titleObserverSites: string[] = [];

  for (const dir of searchRoots) {
    for (const file of collectSourceFiles(dir)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const src = readFileSync(file, "utf8");
      if (/\bdocument\.title\s*=/.test(src)) {
        titleWriteSites.push(rel);
      }
      if (/\.observe\s*\(\s*document\.head\b/.test(src)) {
        headObserverSites.push(rel);
      }
      if (
        /\bMutationObserver\b/.test(src) &&
        (/\btitleElement\b/.test(src) ||
          /querySelector\(\s*["'](?:head\s*>\s*)?title["']\s*\)/.test(src) ||
          /\bdocument\.title\b/.test(src)) &&
        rel !== "app/layout.tsx"
      ) {
        titleObserverSites.push(rel);
      }
    }
  }

  // Exclude the first-paint inline boot script in app/layout.tsx; React/TS code must have exactly ONE site.
  const reactTitleWriters = titleWriteSites.filter(
    (rel) => rel !== "app/layout.tsx"
  );
  assert.deepEqual(
    reactTitleWriters,
    ["components/ui-locale-document-sync.tsx"],
    `Expected exactly one React document.title write site, found: ${reactTitleWriters.join(", ")}`
  );
  assert.deepEqual(
    headObserverSites,
    [],
    `No file may observe all of document.head, found: ${headObserverSites.join(", ")}`
  );
  assert.deepEqual(
    titleObserverSites,
    ["components/ui-locale-document-sync.tsx"],
    `Expected MutationObserver for document title only in UiLocaleDocumentSync, found: ${titleObserverSites.join(", ")}`
  );

  const syncSrc = readFileSync(
    resolve(ROOT, "components/ui-locale-document-sync.tsx"),
    "utf8"
  );
  const syncObserverCreations =
    syncSrc.match(/\bnew\s+MutationObserver\b/g) ?? [];
  assert.equal(
    syncObserverCreations.length,
    1,
    "UiLocaleDocumentSync must register at most one MutationObserver"
  );
  assert.doesNotMatch(
    syncSrc,
    /\.observe\s*\(\s*document\.head\b/,
    "UiLocaleDocumentSync must observe only the <title> element, not document.head"
  );
  assert.match(
    syncSrc,
    /document\.head\?\.querySelector\(\s*"title"\s*\)/,
    "UiLocaleDocumentSync must locate the <head> <title> element specifically"
  );
  assert.match(
    syncSrc,
    /observer\.observe\(\s*titleElement\b/,
    "UiLocaleDocumentSync must observe only titleElement"
  );
  assert.match(
    syncSrc,
    /if\s*\(\s*!resolved\s*\)/,
    "UiLocaleDocumentSync must wait until locale is resolved from storage before writing document.title or attaching its observer"
  );
  assert.match(
    syncSrc,
    /MANAGED_PAGE_TITLES\.has\(\s*currentTitle\s*\)/,
    "UiLocaleDocumentSync must only rewrite managed default page titles"
  );
  assert.match(
    syncSrc,
    /currentTitle\s*!==\s*copy\.pageTitle/,
    "UiLocaleDocumentSync must only assign document.title when the new value differs"
  );
  assert.match(
    syncSrc,
    /document\.title\s*=\s*copy\.pageTitle/,
    "UiLocaleDocumentSync must assign document.title = copy.pageTitle"
  );
  assert.match(
    syncSrc,
    /document\.documentElement\.lang\s*!==\s*locale/,
    "UiLocaleDocumentSync must only write html lang when it differs"
  );

  const providersSrc = readFileSync(
    resolve(ROOT, "components/app-providers.tsx"),
    "utf8"
  );
  const mountMatches = providersSrc.match(/<UiLocaleDocumentSync\b/g) ?? [];
  assert.equal(
    mountMatches.length,
    1,
    "AppProviders must mount <UiLocaleDocumentSync /> exactly once"
  );

  const layoutSrc = readFileSync(resolve(ROOT, "app/layout.tsx"), "utf8");
  assert.doesNotMatch(
    layoutSrc,
    /observe\(\s*document\.head/,
    "app/layout.tsx boot script must not observe document.head"
  );
  assert.match(
    layoutSrc,
    /if\s*\(\s*isTr\s*&&\s*\(\s*!document\.title\s*\|\|\s*document\.title\s*===\s*"Assistant"\s*\)\s*\)/,
    "app/layout.tsx boot script must only write 'Asistan' on first paint when title is empty or 'Assistant'"
  );
});

test("Behavioral: single <title>-only observer recovers Next.js metadata overwrites across reload and multi-consumer mounts with zero ping-pong", async () => {
  const env = installMockBrowserDom({
    initialTitle: "Assistant",
    initialLang: "en",
    storedLocale: "tr",
    navigatorLanguage: "tr-TR",
    navigatorLanguages: ["tr-TR", "tr"],
  });

  const activeObservers = () =>
    env.observers.filter((obs) => !obs.disconnected);
  let disconnectObserver: () => void = () => undefined;

  try {
    // 1. Simulate first-paint boot script (agreeing with stored Turkish locale)
    if (!env.mockDocument.title || env.mockDocument.title === "Assistant") {
      env.mockDocument.title = "Asistan";
    }
    env.mockDocument.documentElement.lang = "tr";
    assert.equal(env.mockDocument.title, "Asistan");
    assert.equal(env.titleWrites.length, 1);

    // 2. Render 12 simultaneous useUiLocale() consumers alongside the single
    //    <UiLocaleDocumentSync /> mounted in AppProviders
    const renderedSnapshots: Array<{ locale: string; resolved: boolean }> = [];
    function MockConsumer({ id }: { id: number }) {
      const state = useUiLocale();
      renderedSnapshots.push({
        locale: state.locale,
        resolved: state.resolved,
      });
      return createElement("span", { key: id }, state.copy.send);
    }

    assert.equal(renderToStaticMarkup(createElement(UiLocaleDocumentSync)), "");

    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(UiLocaleDocumentSync),
        Array.from({ length: 12 }, (_, idx) =>
          createElement(MockConsumer, { key: idx, id: idx })
        )
      )
    );
    assert.ok(html.length > 0);
    assert.equal(renderedSnapshots.length, 12);
    // Initial hydration frame must stay unresolved so nothing overwrites "Asistan" -> "Assistant"
    assert.ok(
      renderedSnapshots.every((s) => s.resolved === false),
      "Initial hydration frame must report resolved === false"
    );
    assert.equal(env.mockDocument.title, "Asistan");
    assert.equal(
      env.titleWrites.length,
      1,
      "Initial unresolved render must not write document.title"
    );
    assert.equal(
      env.observers.length,
      0,
      "Zero MutationObservers should be created before resolution or by useUiLocale consumers"
    );

    // 3. Simulate resolution from storage & browser signals (like mount effect)
    const storedPref = readStoredLocalePreference();
    const detected = detectBrowserLocale();
    const resolvedLocale = storedPref === "auto" ? detected : storedPref;
    assert.equal(resolvedLocale, "tr");

    // Single app-level sync runs after resolution: title is already "Asistan", so 0 extra writes,
    // and exactly ONE observer attaches to <title> only (never document.head)
    const didWriteAfterResolve = syncDocumentLocale(resolvedLocale);
    disconnectObserver = observeDocumentTitleLocale(resolvedLocale);
    assert.equal(didWriteAfterResolve, false);
    assert.equal(env.mockDocument.title, "Asistan");
    assert.equal(env.titleWrites.length, 1);
    assert.equal(activeObservers().length, 1);
    assert.equal(
      activeObservers()[0]?.target,
      env.titleElement,
      "Single observer must observe only the <title> element"
    );
    assert.notEqual(
      activeObservers()[0]?.target,
      env.headSentinel,
      "Single observer must not observe document.head"
    );

    // 4. Simulate Next.js metadata hydration/reload overwriting <title> text back to "Assistant"
    const writesBeforeMetadata = env.titleWrites.length;
    env.simulateNextMetadataTitleCommit("Assistant");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(
      env.mockDocument.title,
      "Asistan",
      "Single <title> observer must restore 'Asistan' after Next.js metadata overwrite"
    );
    assert.equal(
      env.titleWrites.length,
      writesBeforeMetadata + 1,
      "Restoring 'Asistan' must perform exactly 1 write with zero ping-pong"
    );

    // 5. Unrelated <head> mutations (<style>, <meta>) must NOT wake the <title> observer
    const callbacksBeforeHeadMutation =
      activeObservers()[0]?.callbackCount ?? 0;
    env.simulateUnrelatedHeadMutation();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(
      activeObservers()[0]?.callbackCount,
      callbacksBeforeHeadMutation,
      "Unrelated document.head mutations must not invoke the <title> observer"
    );

    // 6. Simulate chat send: new consumers (StopButton, MessageActions) mount mid-session
    //    while existing consumers are already on "tr"
    renderToStaticMarkup(createElement(MockConsumer, { id: 99 }));
    renderToStaticMarkup(createElement(MockConsumer, { id: 100 }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(activeObservers().length, 1);
    assert.equal(env.mockDocument.title, "Asistan");
    assert.equal(env.titleWrites.length, writesBeforeMetadata + 1);

    // 7. Simulate route navigation resetting document.title back to "Assistant":
    //    observer recovers in 1 write and does not loop
    const writesBeforeNav = env.titleWrites.length;
    env.mockDocument.title = "Assistant";
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(env.mockDocument.title, "Asistan");
    assert.equal(
      env.titleWrites.length,
      writesBeforeNav + 2,
      "Route reset ('Assistant') + single recovery ('Asistan') must settle immediately"
    );
    // Repeated sync is a strict no-op
    assert.equal(syncDocumentLocale("tr"), false);
    assert.equal(env.titleWrites.length, writesBeforeNav + 2);

    // 8. Explicit user switch TR -> EN -> TR (cleanup old observer before attaching new one)
    disconnectObserver();
    assert.equal(activeObservers().length, 0);
    assert.equal(syncDocumentLocale("en"), true);
    disconnectObserver = observeDocumentTitleLocale("en");
    assert.equal(activeObservers().length, 1);
    assert.equal(env.mockDocument.title, "Assistant");
    assert.equal(env.mockDocument.documentElement.lang, "en");
    assert.equal(syncDocumentLocale("en"), false);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(env.mockDocument.title, "Assistant");

    // External flip to "Asistan" while in "en" restores "Assistant" once without looping
    const writesBeforeEnRecover = env.titleWrites.length;
    env.simulateNextMetadataTitleCommit("Asistan");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(env.mockDocument.title, "Assistant");
    assert.equal(env.titleWrites.length, writesBeforeEnRecover + 1);

    // Switch back EN -> TR
    disconnectObserver();
    assert.equal(syncDocumentLocale("tr"), true);
    disconnectObserver = observeDocumentTitleLocale("tr");
    assert.equal(activeObservers().length, 1);
    assert.equal(env.mockDocument.title, "Asistan");
    assert.equal(env.mockDocument.documentElement.lang, "tr");

    // 9. Non-managed custom titles are never clobbered even when observer fires
    env.mockDocument.title = "Shared Chat — Q3 Plan";
    const writesBeforeCustom = env.titleWrites.length;
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(syncDocumentLocale("tr"), false);
    assert.equal(syncDocumentLocale("en"), false);
    assert.equal(env.mockDocument.title, "Shared Chat — Q3 Plan");
    assert.equal(env.titleWrites.length, writesBeforeCustom);

    // 10. Unmount cleanup leaves 0 active observers
    disconnectObserver();
    assert.equal(activeObservers().length, 0);
  } finally {
    disconnectObserver();
    env.restore();
  }
});

test("Behavioral: memory card dedupe in messages path is pure single-pass with no loop", () => {
  const input = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Bunu hatırla: çay severim." }],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "tool-saveProfileFact", output: { saved: true } },
        {
          type: "tool-saveProfileFact",
          output: { saved: true, deduplicated: true },
        },
        { type: "text", text: "Not ettim." },
      ],
    },
  ];
  const deduped = dedupeTurnMemoryCardsAcrossMessages(input);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[1]?.parts.length, 2);
  // Original array and message objects remain unmutated
  assert.equal(input[1]?.parts.length, 3);
});
