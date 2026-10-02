"use client";

import QRCode from "qrcode";
import { useCallback, useState } from "react";
import { getAuthClient } from "@/lib/auth-client";

type Enrollment = {
  qr: string;
  secret: string;
  backupCodes: string[];
};

/**
 * TOTP enrollment against better-auth's twoFactor plugin:
 * `enable` creates an unverified secret (re-running it replaces a pending
 * one), and the first valid code from `verify` turns 2FA on.
 *
 * Accounts with a password must confirm it to enable 2FA; passwordless
 * (email code / social) accounts don't, so `needsPassword` is only set when
 * the API asks for one.
 */
export function useTotpEnrollment() {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);

  const start = useCallback(async (password?: string) => {
    setLoading(true);
    setError(null);

    const { data, error } = await getAuthClient().twoFactor.enable({
      password: password ?? "",
    });

    setLoading(false);

    if (error || !data || !("totpURI" in data) || !data.totpURI) {
      if (error?.code === "INVALID_PASSWORD") {
        setNeedsPassword(true);
        if (password) setError("Incorrect password");
        return;
      }
      setError(error?.message ?? "Could not start setup");
      return;
    }

    setNeedsPassword(false);
    setEnrollment({
      qr: await QRCode.toDataURL(data.totpURI, { width: 220, margin: 1 }),
      secret: new URL(data.totpURI).searchParams.get("secret") ?? "",
      backupCodes: data.backupCodes ?? [],
    });
  }, []);

  const verify = useCallback(async (code: string) => {
    setError(null);
    const { error } = await getAuthClient().twoFactor.verifyTotp({ code });
    if (error) {
      setError(error.message ?? "Invalid code");
      return false;
    }
    return true;
  }, []);

  return { enrollment, needsPassword, error, isLoading, start, verify };
}
