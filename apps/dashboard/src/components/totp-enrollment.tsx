"use client";

import { Button } from "@midday/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@midday/ui/collapsible";
import { Input } from "@midday/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@midday/ui/input-otp";
import { Spinner } from "@midday/ui/spinner";
import { CaretSortIcon } from "@radix-ui/react-icons";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useTotpEnrollment } from "@/hooks/use-totp-enrollment";
import { CopyInput } from "./copy-input";

type Props = {
  /** Called once the first code is verified and 2FA is on. */
  onEnrolled: () => void;
  onCancel: () => void;
  qrSize?: number;
};

export function TotpEnrollment({ onEnrolled, onCancel, qrSize = 220 }: Props) {
  const { enrollment, needsPassword, error, isLoading, start, verify } =
    useTotpEnrollment();
  const [password, setPassword] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isVerifying, setVerifying] = useState(false);
  const [isDone, setDone] = useState(false);

  useEffect(() => {
    start();
  }, [start]);

  const onComplete = async (code: string) => {
    if (isVerifying) return;
    setVerifying(true);
    const ok = await verify(code);
    setVerifying(false);
    if (ok) {
      setDone(true);
      onEnrolled();
    }
  };

  if (needsPassword && !enrollment) {
    return (
      <form
        className="flex flex-col space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          start(password);
        }}
      >
        <p className="text-sm text-[#606060]">
          Confirm your password to set up multi-factor authentication.
        </p>
        <Input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-between">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading || !password}>
            Continue
          </Button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <div
          className="bg-white rounded-md"
          style={{ width: qrSize, height: qrSize }}
        >
          {enrollment && (
            <Image
              src={enrollment.qr}
              alt="qr"
              width={qrSize}
              height={qrSize}
              unoptimized
            />
          )}
        </div>
      </div>
      <div className="my-8">
        <p className="font-medium pb-1 text-2xl text-[#606060]">
          Use an authenticator app to scan the following QR code, and provide
          the code to complete the setup.
        </p>
      </div>

      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="w-full mb-4"
      >
        <CollapsibleTrigger className="p-0 text-sm w-full">
          <div className="flex items-center justify-between">
            <span className="font-medium">Setup key and backup codes</span>
            <CaretSortIcon className="h-4 w-4" />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          {enrollment?.secret && (
            <CopyInput value={enrollment.secret} className="w-full" />
          )}
          {enrollment && enrollment.backupCodes.length > 0 && (
            <div>
              <p className="text-xs text-[#606060] mb-1">
                Save these backup codes. Each can be used once if you lose
                access to your authenticator.
              </p>
              <CopyInput
                value={enrollment.backupCodes.join(" ")}
                className="w-full"
              />
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <div className="flex w-full">
        <div className="w-full h-16 flex items-center justify-center">
          {isVerifying || isDone ? (
            <div className="flex items-center justify-center h-full bg-background/95 border border-input w-full">
              <div className="flex items-center space-x-2 bg-background px-4 py-2 rounded-md shadow-sm">
                <Spinner size={16} className="text-primary" />
                <span className="text-sm text-foreground font-medium">
                  {isDone ? "Redirecting..." : "Setting up..."}
                </span>
              </div>
            </div>
          ) : (
            <InputOTP
              className={error ? "invalid" : ""}
              maxLength={6}
              autoFocus
              onComplete={onComplete}
              disabled={!enrollment}
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

      <div className="flex border-t-[1px] pt-4 mt-6 justify-center mb-6">
        <Button
          onClick={onCancel}
          variant="ghost"
          className="text-medium text-sm hover:bg-transparent"
        >
          Cancel
        </Button>
      </div>
    </>
  );
}
