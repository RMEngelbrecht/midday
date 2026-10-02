"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@midday/ui/cn";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@midday/ui/form";
import { Input } from "@midday/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@midday/ui/input-otp";
import { Spinner } from "@midday/ui/spinner";
import { SubmitButton } from "@midday/ui/submit-button";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v3";
import { getAuthClient } from "@/lib/auth-client";
import { afterSignIn } from "@/utils/after-sign-in";

const formSchema = z.object({
  email: z.string().email(),
});

type Props = {
  className?: string;
};

export function OTPSignIn({ className }: Props) {
  const [isLoading, setLoading] = useState(false);
  const [isSent, setSent] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [email, setEmail] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
    },
  });

  async function onSubmit({ email }: z.infer<typeof formSchema>) {
    setLoading(true);

    setEmail(email);
    setError(null);

    const { error } = await getAuthClient().emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });

    setLoading(false);

    if (error) {
      setError(error.message ?? "Could not send a sign-in code");
      return;
    }

    setSent(true);
  }

  async function onComplete(token: string) {
    if (!email) return;

    setIsVerifying(true);
    setError(null);

    const { data, error } = await getAuthClient().signIn.emailOtp({
      email,
      otp: token,
    });

    if (error || !data) {
      setIsVerifying(false);
      setError(error?.message ?? "Invalid code");
      return;
    }

    afterSignIn({
      method: "otp",
      twoFactorRedirect:
        "twoFactorRedirect" in data && Boolean(data.twoFactorRedirect),
      returnTo: searchParams.get("return_to"),
    });
  }

  if (isSent) {
    return (
      <div className={cn("flex flex-col space-y-4 items-center", className)}>
        <div className="h-[62px] w-full flex items-center justify-center">
          {isVerifying ? (
            <div className="flex items-center justify-center h-full bg-background/95 border border-input w-full">
              <div className="flex items-center space-x-2 bg-background px-4 py-2 rounded-md shadow-sm">
                <Spinner size={16} className="text-primary" />
                <span className="text-sm text-foreground font-medium">
                  Verifying...
                </span>
              </div>
            </div>
          ) : (
            <InputOTP
              maxLength={6}
              autoFocus
              onComplete={onComplete}
              disabled={isVerifying}
              render={({ slots }) => (
                <InputOTPGroup>
                  {slots.map((slot, index) => (
                    <InputOTPSlot
                      key={index.toString()}
                      {...slot}
                      className="w-[62px] h-[62px]"
                    />
                  ))}
                </InputOTPGroup>
              )}
            />
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex space-x-2">
          <span className="text-sm text-[#878787]">
            Didn't receive the email?
          </span>
          <button
            onClick={() => setSent(false)}
            type="button"
            className="text-sm text-primary underline font-medium"
            disabled={isVerifying}
          >
            Resend code
          </button>
        </div>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="w-full">
        <div className={cn("flex flex-col space-y-4", className)}>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    placeholder="Enter email address"
                    {...field}
                    autoCapitalize="false"
                    autoCorrect="false"
                    spellCheck="false"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <SubmitButton
            type="submit"
            className="bg-primary px-6 py-4 text-secondary font-medium flex space-x-2 h-[40px] w-full"
            isSubmitting={isLoading}
          >
            Continue
          </SubmitButton>
        </div>
      </form>
    </Form>
  );
}
