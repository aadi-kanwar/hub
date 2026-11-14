import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ConvexClientProvider } from "@/components/app/convex-client-provider";
import { OfflineBanner } from "@/components/app/offline-banner";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

// Instrument Serif, bundled with the app (no outside font service).
const displaySerif = localFont({
  src: [
    { path: "../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2", style: "normal" },
    { path: "../../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2", style: "italic" },
  ],
  weight: "400",
  variable: "--font-display-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Livoza Hub", template: "%s · Livoza Hub" },
  description: "Livoza Hub: one sign-in for every Livoza tool.",
  // Private tool: keep it out of search engines.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f2ea",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${GeistSans.variable} ${GeistMono.variable} ${displaySerif.variable}`}>
      <body className="min-h-dvh">
        <ConvexAuthNextjsServerProvider>
          <ConvexClientProvider>
            <OfflineBanner />
            {children}
            <Toaster />
          </ConvexClientProvider>
        </ConvexAuthNextjsServerProvider>
      </body>
    </html>
  );
}
