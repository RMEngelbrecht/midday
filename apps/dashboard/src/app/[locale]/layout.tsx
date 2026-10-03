import "@/styles/globals.css";
import { cn } from "@midday/ui/cn";
import "@midday/ui/globals.css";
import { Provider as Analytics } from "@midday/events/client";
import { Toaster } from "@midday/ui/toaster";
import type { Metadata } from "next";
import { Hedvig_Letters_Sans, Hedvig_Letters_Serif } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactElement } from "react";
import { DesktopHeader } from "@/components/desktop-header";
import { PublicConfigProvider } from "@/components/public-config-provider";
import { ENV } from "@/env";
import { isDesktopApp } from "@/utils/desktop";
import { getPublicConfig } from "@/utils/public-config.server";
import { Providers } from "./providers";

const description =
  "Automate financial tasks, stay organized, and make informed decisions effortlessly.";

// Resolved per request: APP_URL is runtime config, not a build-time constant.
export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(ENV.APP_URL),
    title: "Midday | Run your business smarter",
    description,
    twitter: {
      title: "Midday | Run your business smarter",
      description,
    },
    openGraph: {
      title: "Midday | Run your business smarter",
      description,
      url: ENV.APP_URL,
      siteName: "Midday",
      locale: "en_US",
      type: "website",
    },
  };
}

const hedvigSans = Hedvig_Letters_Sans({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hedvig-sans",
});

const hedvigSerif = Hedvig_Letters_Serif({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hedvig-serif",
});

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)" },
    { media: "(prefers-color-scheme: dark)" },
  ],
};

export default async function Layout({
  children,
  params,
}: {
  children: ReactElement;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const isDesktop = await isDesktopApp();
  // Resolved from env at request time, never inlined at build time.
  const publicConfig = getPublicConfig();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn(isDesktop && "desktop")}
    >
      <body
        className={cn(
          `${hedvigSans.variable} ${hedvigSerif.variable} font-sans`,
          "whitespace-pre-line overscroll-none antialiased",
        )}
      >
        <PublicConfigProvider config={publicConfig}>
          <DesktopHeader />

          <NuqsAdapter>
            <Providers locale={locale}>
              {children}
              <Toaster />
            </Providers>
            <Analytics clientId={publicConfig.openpanelClientId ?? undefined} />
          </NuqsAdapter>
        </PublicConfigProvider>
      </body>
    </html>
  );
}
