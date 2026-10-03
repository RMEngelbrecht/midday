import { getFeatures } from "@midday/features";
import { Icons } from "@midday/ui/icons";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { LoginAccordion } from "@/components/login-accordion";
import { LoginVideoBackground } from "@/components/login-video-background";
import { OAuthSignIn } from "@/components/oauth-sign-in";
import { OTPSignIn } from "@/components/otp-sign-in";
import { PasswordSignIn } from "@/components/password-sign-in";
import type { OAuthProvider } from "@/hooks/use-oauth-sign-in";
import { Cookies } from "@/utils/constants";

export const metadata: Metadata = {
  title: "Login | Midday",
};

const PROVIDER_ORDER: OAuthProvider[] = [
  "google",
  "apple",
  "microsoft",
  "github",
];

export default async function Page() {
  const cookieStore = await cookies();
  const preferred = cookieStore.get(Cookies.PreferredSignInProvider)?.value;

  // Only providers configured on the API (AUTH_<PROVIDER>_CLIENT_ID/SECRET).
  const { auth } = getFeatures();
  const providers = PROVIDER_ORDER.filter((provider) => auth[provider]);

  // The last-used method goes first; email + password is the default.
  const preferredProvider = providers.find(
    (provider) => provider === preferred,
  );

  const preferredSignInOption = preferredProvider ? (
    <OAuthSignIn provider={preferredProvider} showLastUsed />
  ) : preferred === "otp" ? (
    <OTPSignIn />
  ) : (
    <PasswordSignIn />
  );

  const moreSignInOptions = (
    <>
      {providers
        .filter((provider) => provider !== preferredProvider)
        .map((provider) => (
          <OAuthSignIn key={provider} provider={provider} />
        ))}
      {(preferredProvider || preferred === "otp") && (
        <PasswordSignIn className="border-t-[1px] border-border pt-8" />
      )}
      {preferred !== "otp" && (
        <OTPSignIn className="border-t-[1px] border-border pt-8" />
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background flex relative">
      {/* Logo - fixed position */}
      <div className="fixed top-0 left-0 right-0 z-50 w-full">
        <nav className="w-full pointer-events-none">
          <div className="relative py-3 xl:py-4 px-4 sm:px-4 md:px-4 lg:px-4 xl:px-6 2xl:px-8 flex items-center">
            <Link
              href="/"
              className="flex items-center gap-2 hover:opacity-80 active:opacity-80 transition-opacity duration-200 pointer-events-auto"
            >
              <div className="w-6 h-6">
                <Icons.LogoSmall className="w-full h-full text-foreground lg:text-white" />
              </div>
            </Link>
          </div>
        </nav>
      </div>

      {/* Left Side - Video Background */}
      <LoginVideoBackground />

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-8 lg:p-12 pb-2">
        <div className="w-full max-w-md flex flex-col h-full">
          <div className="space-y-8 flex-1 flex flex-col justify-center">
            {/* Header */}
            <div className="text-center space-y-2">
              <h1 className="text-lg lg:text-xl mb-4 font-serif">
                Welcome to Midday
              </h1>
              <p className="font-sans text-sm text-[#878787]">
                Sign in or create an account
              </p>
            </div>

            {/* Sign In Options */}
            <div className="space-y-3 flex items-center justify-center w-full">
              {preferredSignInOption}
            </div>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-background font-sans text-[#878787]">
                  or
                </span>
              </div>
            </div>

            {/* More Options Accordion */}
            <LoginAccordion>{moreSignInOptions}</LoginAccordion>
          </div>
        </div>
      </div>
    </div>
  );
}
