import { isDesktopApp } from "@midday/desktop-client/platform";
import { Button } from "@midday/ui/button";
import { Icons } from "@midday/ui/icons";
import { Spinner } from "@midday/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@midday/ui/tooltip";
import { useToast } from "@midday/ui/use-toast";
import { useMutation } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useScript } from "usehooks-ts";
import { usePublicConfig } from "@/components/public-config-provider";
import { useTRPC } from "@/trpc/client";

/**
 * Callback type for when a provider reconnect flow completes.
 * - "reconnect": Provider may have changed account IDs, trigger reconnect job
 * - "sync": Provider preserves account IDs (e.g., Plaid update mode), trigger manual sync
 */
type OnCompleteType = "reconnect" | "sync";

type Props = {
  id: string;
  provider: string;
  enrollmentId: string | null;
  institutionId: string;
  referenceId?: string | null;
  accessToken: string | null;
  /**
   * Called when the provider's reconnect flow completes successfully.
   * @param type - "reconnect" if account IDs may have changed, "sync" if they're preserved
   */
  onComplete: (type: OnCompleteType) => void;
  variant?: "button" | "icon";
};

export function ReconnectProvider({
  id,
  provider,
  enrollmentId,
  institutionId,
  referenceId,
  accessToken,
  onComplete,
  variant,
}: Props) {
  const { plaidEnvironment, teller: tellerConfig } = usePublicConfig();
  const { toast } = useToast();
  const { theme } = useTheme();
  const trpc = useTRPC();
  const [plaidToken, setPlaidToken] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  const createPlaidLink = useMutation(
    trpc.banking.plaidLink.mutationOptions({
      onSuccess: (result) => {
        if (result.data.link_token) {
          setPlaidToken(result.data.link_token);
        }
      },
    }),
  );

  const createEnableBankingLink = useMutation(
    trpc.banking.enablebankingLink.mutationOptions({}),
  );

  useScript("https://cdn.teller.io/connect/connect.js", {
    removeOnUnmount: false,
  });

  const { open: openPlaid } = usePlaidLink({
    token: plaidToken,
    publicKey: "",
    env: plaidEnvironment,
    clientName: "Midday",
    product: ["transactions"],
    onSuccess: () => {
      setPlaidToken(undefined);
      // Plaid uses "update mode" which preserves account IDs - just sync
      onComplete("sync");
    },
    onExit: () => {
      setPlaidToken(undefined);
    },
  });

  const openTeller = () => {
    // @ts-expect-error
    const teller = window.TellerConnect.setup({
      applicationId: tellerConfig?.applicationId ?? "",
      environment: tellerConfig?.environment,
      enrollmentId,
      appearance: theme,
      onSuccess: () => {
        // Teller may change account IDs after reconnect - trigger reconnect job
        onComplete("reconnect");
      },
      onFailure: () => {},
    });

    if (teller) {
      teller.open();
    }
  };

  useEffect(() => {
    if (plaidToken) {
      openPlaid();
    }
  }, [plaidToken, openPlaid]);

  const handleOnClick = async () => {
    switch (provider) {
      case "plaid": {
        createPlaidLink.mutate({
          accessToken: accessToken ?? undefined,
        });

        return;
      }
      case "enablebanking": {
        setIsLoading(true);

        try {
          const linkData = await createEnableBankingLink.mutateAsync({
            institutionId,
            state: isDesktopApp()
              ? `desktop:reconnect:${referenceId}`
              : `web:reconnect:${referenceId}`,
          });

          window.location.href = linkData.data.url;
        } catch {
          setIsLoading(false);
          toast({
            duration: 2500,
            variant: "error",
            title: "Something went wrong please try again.",
          });
        }
        return;
      }
      case "teller":
        return openTeller();
      default:
        return;
    }
  };

  if (variant === "button") {
    return (
      <Button variant="outline" onClick={handleOnClick} disabled={isLoading}>
        {isLoading ? <Spinner className="size-3.5" /> : "Reconnect"}
      </Button>
    );
  }

  return (
    <TooltipProvider delayDuration={70}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full w-7 h-7 flex items-center"
            onClick={handleOnClick}
            disabled={isLoading}
          >
            {isLoading ? (
              <Spinner className="size-3.5" />
            ) : (
              <Icons.Reconnect size={16} />
            )}
          </Button>
        </TooltipTrigger>

        <TooltipContent className="px-3 py-1.5 text-xs" sideOffset={10}>
          Reconnect
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
