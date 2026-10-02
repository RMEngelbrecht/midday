"use client";

import { Button } from "@midday/ui/button";
import { Input } from "@midday/ui/input";
import { useToast } from "@midday/ui/use-toast";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getAuthClient } from "@/lib/auth-client";

export function RemoveMFAButton() {
  const { toast } = useToast();
  const router = useRouter();
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [isLoading, setLoading] = useState(false);

  const disable = async () => {
    setLoading(true);
    const { error } = await getAuthClient().twoFactor.disable({ password });
    setLoading(false);

    if (error?.code === "INVALID_PASSWORD" && !needsPassword) {
      // Accounts with a password must confirm it.
      setNeedsPassword(true);
      return;
    }

    if (error) {
      toast({
        duration: 3500,
        variant: "error",
        title: error.message ?? "Something went wrong please try again.",
      });
      return;
    }

    router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      {needsPassword && (
        <Input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-[180px]"
        />
      )}
      <Button
        variant="outline"
        disabled={isLoading || (needsPassword && !password)}
        onClick={disable}
      >
        Remove
      </Button>
    </div>
  );
}
