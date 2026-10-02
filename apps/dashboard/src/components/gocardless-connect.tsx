import {
  getDesktopSchemeUrl,
  isDesktopApp,
} from "@midday/desktop-client/platform";
import { useToast } from "@midday/ui/use-toast";
import { useMutation } from "@tanstack/react-query";
import { usePublicConfig } from "@/components/public-config-provider";
import { useTRPC } from "@/trpc/client";
import { BankConnectButton } from "./bank-connect-button";

type Props = {
  id: string;
  availableHistory: number;
  onSelect: () => void;
  redirectPath?: string;
  connectRef?: React.MutableRefObject<(() => void) | null>;
};

export function GoCardLessConnect({
  onSelect,
  id,
  availableHistory,
  redirectPath,
  connectRef,
}: Props) {
  const { appUrl, desktopScheme } = usePublicConfig();
  const { toast } = useToast();
  const trpc = useTRPC();

  const createAgreement = useMutation(
    trpc.banking.gocardlessAgreement.mutationOptions({}),
  );

  const createLink = useMutation(
    trpc.banking.gocardlessLink.mutationOptions({}),
  );

  const handleOnSelect = async () => {
    onSelect();

    const redirectBase = isDesktopApp()
      ? getDesktopSchemeUrl(desktopScheme)
      : appUrl;
    const redirectTo = new URL(redirectPath ?? "/", redirectBase);
    redirectTo.searchParams.append("step", "account");
    redirectTo.searchParams.append("provider", "gocardless");

    try {
      const agreementData = await createAgreement.mutateAsync({
        institutionId: id,
        transactionTotalDays: availableHistory,
      });

      const linkData = await createLink.mutateAsync({
        agreement: agreementData.data.id,
        institutionId: id,
        redirect: redirectTo.toString(),
      });

      window.location.href = linkData.data.link;
    } catch {
      toast({
        duration: 3500,
        variant: "error",
        title: "Something went wrong please try again.",
      });
    }
  };

  return <BankConnectButton onClick={handleOnSelect} connectRef={connectRef} />;
}
