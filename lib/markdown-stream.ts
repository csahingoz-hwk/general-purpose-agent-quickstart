import { defaultRehypePlugins, type StreamdownProps } from "streamdown";

type SanitizeSchemaLike = {
  protocols?: {
    href?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type RehypePluginsList = NonNullable<StreamdownProps["rehypePlugins"]>;

/**
 * Streamdown 2.3.0 rewrites incomplete mid-stream markdown links to
 * `href="streamdown:incomplete-link"`, but its default `rehype-sanitize` schema
 * strips the `streamdown:` protocol before `rehype-harden` runs. `rehype-harden`
 * then sees an `<a>` with `href === undefined` and appends literal `" [blocked]"`
 * via its default `linkBlockPolicy: "indicator"`.
 *
 * This plugin chain:
 * 1) Allows `streamdown:` through `rehype-sanitize` so Streamdown renders
 *    incomplete mid-stream links cleanly as pending (`data-incomplete="true"`).
 * 2) Restricts `rehype-harden` to safe protocols (`http:`, `https:`, `mailto:`,
 *    `tel:`, `streamdown:`) and uses `linkBlockPolicy: "text-only"` and
 *    `imageBlockPolicy: "text-only"`, so blocked/malformed links still have
 *    their URLs stripped safely without ever injecting visible `"[blocked]"` text.
 */
export function buildSafeStreamdownRehypePlugins(): RehypePluginsList {
  const plugins: RehypePluginsList = [];

  if (defaultRehypePlugins.raw) {
    plugins.push(defaultRehypePlugins.raw);
  }

  const sanitizeEntry = defaultRehypePlugins.sanitize;
  if (Array.isArray(sanitizeEntry) && sanitizeEntry.length >= 2) {
    const [sanitizePlugin, rawSchema, ...rest] = sanitizeEntry;
    const schema = (rawSchema ?? {}) as SanitizeSchemaLike;
    const existingHrefProtocols = Array.isArray(schema.protocols?.href)
      ? schema.protocols.href
      : ["http", "https", "irc", "ircs", "mailto", "xmpp", "tel"];
    const nextHrefProtocols = existingHrefProtocols.includes("streamdown")
      ? existingHrefProtocols
      : [...existingHrefProtocols, "streamdown"];
    plugins.push([
      sanitizePlugin,
      {
        ...schema,
        protocols: {
          ...schema.protocols,
          href: nextHrefProtocols,
        },
      },
      ...rest,
    ] as RehypePluginsList[number]);
  } else if (sanitizeEntry) {
    plugins.push(sanitizeEntry);
  }

  const hardenEntry = defaultRehypePlugins.harden;
  if (Array.isArray(hardenEntry) && hardenEntry.length >= 2) {
    const [hardenPlugin, rawOpts, ...rest] = hardenEntry;
    const opts = (rawOpts ?? {}) as Record<string, unknown>;
    plugins.push([
      hardenPlugin,
      {
        ...opts,
        allowedProtocols: ["http:", "https:", "mailto:", "tel:", "streamdown:"],
        linkBlockPolicy: "text-only",
        imageBlockPolicy: "text-only",
      },
      ...rest,
    ] as RehypePluginsList[number]);
  } else if (hardenEntry) {
    plugins.push(hardenEntry);
  }

  return plugins;
}

export const STREAMDOWN_SAFE_REHYPE_PLUGINS: RehypePluginsList =
  buildSafeStreamdownRehypePlugins();
