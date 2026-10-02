import { Input } from "@midday/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@midday/ui/input-otp";
import { Spinner } from "@midday/ui/spinner";
import { sanitizeRedirectPath } from "@midday/utils/sanitize-redirect";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { getAuthClient } from "@/lib/auth-client";

export function VerifyMfa() {
  const [isValidating, setValidating] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState("");
  const searchParams = useSearchParams();

  const onComplete = async (code: string) => {
    setError(false);

    if (!isValidating) {
      setValidating(true);

      // Completes the pending sign-in (two_factor cookie) and sets the
      // session cookie.
      const client = getAuthClient();
      const { error } = useBackupCode
        ? await client.twoFactor.verifyBackupCode({ code })
        : await client.twoFactor.verifyTotp({ code });

      if (error) {
        setValidating(false);
        setError(true);
        return;
      }

      setIsRedirecting(true);
      // Full navigation so server components see the new session cookie.
      window.location.assign(
        sanitizeRedirectPath(`/${searchParams.get("return_to") || ""}`),
      );
    }
  };

  return (
    <>
      <div className="pb-4">
        <div className="text-center">
          <h1 className="text-lg lg:text-xl mb-2 font-serif">
            Verify your identity.
          </h1>
          <p className="text-[#878787] text-sm mb-8">
            Please enter the code from your authenticator app.
          </p>
        </div>
      </div>

      <div className="flex w-full mb-6">
        <div className="w-full h-16 flex items-center justify-center">
          {isValidating || isRedirecting ? (
            <div className="flex items-center justify-center h-full bg-background/95 border border-input w-full">
              <div className="flex items-center space-x-2 bg-background px-4 py-2 rounded-md shadow-sm">
                <Spinner size={16} className="text-primary" />
                <span className="text-sm text-foreground font-medium">
                  {isRedirecting ? "Redirecting..." : "Verifying..."}
                </span>
              </div>
            </div>
          ) : useBackupCode ? (
            <form
              className="w-full"
              onSubmit={(event) => {
                event.preventDefault();
                onComplete(backupCode.trim());
              }}
            >
              <Input
                autoFocus
                placeholder="Backup code"
                value={backupCode}
                onChange={(event) => setBackupCode(event.target.value)}
                className={error ? "border-destructive" : undefined}
              />
            </form>
          ) : (
            <InputOTP
              onComplete={onComplete}
              maxLength={6}
              autoFocus
              className={error ? "invalid" : undefined}
              disabled={isValidating || isRedirecting}
              render={({ slots }) => (
                <InputOTPGroup>
                  {slots.map((slot, index) => (
                    <InputOTPSlot key={index.toString()} {...slot} />
                  ))}
                </InputOTPGroup>
              )}
            />
          )}
        </div>
      </div>

      <p className="text-xs text-[#878787] text-center font-mono">
        Open your authenticator apps like 1Password, Authy, etc. to verify your
        identity.
      </p>

      <button
        type="button"
        className="mt-4 w-full text-center text-xs text-[#878787] underline"
        onClick={() => {
          setError(false);
          setUseBackupCode(!useBackupCode);
        }}
      >
        {useBackupCode ? "Use authenticator app" : "Use a backup code"}
      </button>
    </>
  );
}
