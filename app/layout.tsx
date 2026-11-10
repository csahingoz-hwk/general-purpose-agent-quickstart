import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOT_THEMES, botThemeCss } from "@/lib/bot-theme";

import "./globals.css";
import { SessionProvider } from "next-auth/react";

export const metadata: Metadata = {
  metadataBase: new URL("https://chat.vercel.ai"),
  title: "OpenClaw Clone with Composio",
  description:
    "AI agent built on the Vercel AI SDK with Composio tools, Supermemory, and Telegram.",
  applicationName: "Assistant",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Assistant",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    {
      media: "(prefers-color-scheme: light)",
      color: BOT_THEMES.blue.light.accent,
    },
    {
      media: "(prefers-color-scheme: dark)",
      color: BOT_THEMES.blue.dark.accent,
    },
  ],
};

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

const THEME_COLOR_SCRIPT = `\
(function() {
  var html = document.documentElement;
  var allowed = ["blue","purple","pink","orange","green","yellow","red","teal","black","white"];
  try {
    var saved = localStorage.getItem("assistant-mascot");
    html.setAttribute("data-bot-theme", allowed.indexOf(saved) === -1 ? "blue" : saved);
  } catch (error) {
    html.setAttribute("data-bot-theme", "blue");
  }
  function updateThemeColor() {
    var color = getComputedStyle(html).getPropertyValue("--bot-accent").trim() || "${BOT_THEMES.blue.light.accent}";
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    if (metas.length === 0) {
      var created = document.createElement('meta');
      created.setAttribute('name', 'theme-color');
      document.head.appendChild(created);
      metas = document.querySelectorAll('meta[name="theme-color"]');
    }
    for (var index = 0; index < metas.length; index += 1) {
      metas[index].removeAttribute('media');
      metas[index].setAttribute('content', color);
    }
  }
  var observer = new MutationObserver(updateThemeColor);
  observer.observe(html, { attributes: true, attributeFilter: ['class', 'data-bot-theme'] });
  updateThemeColor();
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${geist.variable} ${geistMono.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <style
          // biome-ignore lint/security/noDangerouslySetInnerHtml: theme tokens are generated from the mascot map
          dangerouslySetInnerHTML={{ __html: botThemeCss() }}
        />
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: "Required"
          dangerouslySetInnerHTML={{
            __html: THEME_COLOR_SCRIPT,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <SessionProvider
            basePath={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth`}
          >
            <TooltipProvider>{children}</TooltipProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
