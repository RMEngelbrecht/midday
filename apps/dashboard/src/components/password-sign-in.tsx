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
import { SubmitButton } from "@midday/ui/submit-button";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v3";
import { getAuthClient, UNREACHABLE_MESSAGE } from "@/lib/auth-client";
import { afterSignIn } from "@/utils/after-sign-in";

const formSchema = z.object({
  name: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(8, "At least 8 characters"),
});

type Props = {
  className?: string;
};

/**
 * Email + password sign-in, always available (the zero-config default).
 * "Create account" is subject to the server's ALLOW_SIGNUP policy.
 */
export function PasswordSignIn({ className }: Props) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);
    setError(null);

    const client = getAuthClient();
    const result = await (mode === "sign-up"
      ? client.signUp.email({
          email: values.email,
          password: values.password,
          name: values.name?.trim() ?? "",
        })
      : client.signIn.email({
          email: values.email,
          password: values.password,
        })
    ).catch(() => null);

    if (!result) {
      setLoading(false);
      setError(UNREACHABLE_MESSAGE);
      return;
    }

    const { data, error } = result;

    if (error || !data) {
      setLoading(false);
      setError(error?.message ?? "Something went wrong");
      return;
    }

    afterSignIn({
      method: "password",
      twoFactorRedirect:
        "twoFactorRedirect" in data && Boolean(data.twoFactorRedirect),
      returnTo: searchParams.get("return_to"),
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="w-full">
        <div className={cn("flex flex-col space-y-4", className)}>
          {mode === "sign-up" && (
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      placeholder="Full name"
                      autoComplete="name"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    placeholder="Email address"
                    autoComplete="email"
                    autoCapitalize="false"
                    autoCorrect="false"
                    spellCheck="false"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input
                    type="password"
                    placeholder="Password"
                    autoComplete={
                      mode === "sign-up" ? "new-password" : "current-password"
                    }
                    {...field}
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
            {mode === "sign-up" ? "Create account" : "Sign in"}
          </SubmitButton>

          <button
            type="button"
            className="text-sm text-[#878787] underline"
            onClick={() => {
              setError(null);
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            }}
          >
            {mode === "sign-in"
              ? "New here? Create an account"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </form>
    </Form>
  );
}
