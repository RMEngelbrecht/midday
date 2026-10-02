"use client";

import { isDesktopApp } from "@midday/desktop-client/platform";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { usePublicConfig } from "@/components/public-config-provider";
import { getAuthClient } from "@/lib/auth-client";

export type OAuthProvider = "google" | "apple" | "github" | "microsoft";

type ProviderConfig = {
  name: string;
  icon: "Google" | "Apple" | "Github" | "Microsoft";
  variant: "primary" | "secondary";
  supportsReturnTo: boolean;
};

export const OAUTH_PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  google: {
    name: "Google",
    icon: "Google",
    variant: "secondary",
    supportsReturnTo: true,
  },
  apple: {
    name: "Apple",
    icon: "Apple",
    variant: "secondary",
    supportsReturnTo: false,
  },
  github: {
    name: "Github",
    icon: "Github",
    variant: "secondary",
    supportsReturnTo: true,
  },
  microsoft: {
    name: "Microsoft",
    icon: "Microsoft",
    variant: "secondary",
    supportsReturnTo: true,
  },
};

export function useOAuthSignIn(provider: OAuthProvider) {
  const { appUrl } = usePublicConfig();
  const [isLoading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("return_to");
  const config = OAUTH_PROVIDERS[provider];

  const handleSignIn = async () => {
    setLoading(true);

    const callbackURL = new URL("/api/auth/callback", appUrl);
    callbackURL.searchParams.append("provider", provider);

    if (isDesktopApp()) {
      callbackURL.searchParams.append("client", "desktop");
    } else if (config.supportsReturnTo && returnTo) {
      callbackURL.searchParams.append("return_to", returnTo);
    }

    const errorCallbackURL = new URL("/login", appUrl);

    // Redirects the browser to the provider; the API's callback sets the
    // session cookie and redirects to `callbackURL` (or /mfa/verify).
    await getAuthClient().signIn.social({
      provider,
      callbackURL: callbackURL.toString(),
      errorCallbackURL: errorCallbackURL.toString(),
    });

    setTimeout(() => {
      setLoading(false);
    }, 2000);
  };

  return { handleSignIn, isLoading, config };
}
