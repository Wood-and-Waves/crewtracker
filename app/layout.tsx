import type { Metadata, Viewport } from "next";
import "./globals.css";
import ThemeScript from "@/components/ThemeScript";

export const metadata: Metadata = {
  title: "CrewTracker",
  description: "Crew time tracking and payroll for corporate AV shows.",
  // Drives Home Screen behaviour on iOS: the label under the icon and the
  // status-bar style. Modern iOS takes standalone mode from the web manifest's
  // `display` field; see the legacy meta tag in <head> below for older versions.
  //
  // statusBarStyle "black" rather than "black-translucent" on purpose:
  // translucent lets the page render *under* the status bar, which would put
  // AppShell's sticky top nav beneath the clock on a landscape iPad. "black"
  // gives the status bar its own space and matches the near-black theme.
  //
  // `title` is the label under the Home Screen icon, kept short so iOS doesn't
  // truncate it.
  appleWebApp: {
    capable: true,
    title: "CrewTracker",
    statusBarStyle: "black",
  },
};

// Drives the browser/OS UI colour around the app. Split out from `metadata`
// because Next requires themeColor in its own export.
export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // suppressHydrationWarning below is required, not cosmetic: ThemeScript sets
  // data-theme on <html> before paint (that's how the saved theme avoids a
  // flash), so the server's markup and the client's DOM differ by design on
  // every page. Without it, every route logs a hydration mismatch — noise that
  // hides the real ones. Scoped to this one element.
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        {/* Next only emits the standardised `mobile-web-app-capable`. iOS
            versions before manifest support (pre-16.4) honour nothing but
            Apple's legacy name, and without it a Home Screen shortcut there
            just opens Safari. Harmless where it's ignored, so it stays. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
