import { track } from "@midday/events/client";
import { LogEvents } from "@midday/events/events";
import { Button } from "@midday/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@midday/ui/dialog";
import { Input } from "@midday/ui/input";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useConnectParams } from "@/hooks/use-connect-params";
import { useTRPC } from "@/trpc/client";
import { BankConnectButton } from "./bank-connect-button";

type Props = {
  id: string;
  onSelect: (id: string) => void;
  connectRef?: React.MutableRefObject<(() => void) | null>;
};

/**
 * SimpleFIN has no OAuth: the user creates a setup token in their SimpleFIN
 * Bridge account (https://bridge.simplefin.org) and pastes it here. The API
 * claims it and hands back the access URL already encrypted.
 */
export function SimplefinConnect({ id, onSelect, connectRef }: Props) {
  const trpc = useTRPC();
  const { setParams } = useConnectParams();
  const [open, setOpen] = useState(false);
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const claim = useMutation(
    trpc.banking.simplefinClaim.mutationOptions({
      onSuccess: (result) => {
        setOpen(false);
        setSetupToken("");
        setParams({
          step: "account",
          provider: "simplefin",
          token: result.data.accessToken,
          institution_id: id,
        });
        track({
          event: LogEvents.ConnectBankAuthorized.name,
          channel: LogEvents.ConnectBankAuthorized.channel,
          provider: "simplefin",
        });
      },
      onError: (e) => setError(e.message),
    }),
  );

  return (
    <>
      <BankConnectButton
        connectRef={connectRef}
        onClick={() => {
          onSelect(id);
          setError(null);
          setOpen(true);
        }}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <div className="p-4 flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Connect with SimpleFIN</DialogTitle>
              <DialogDescription>
                Create a setup token in your SimpleFIN Bridge account
                (bridge.simplefin.org) and paste it below. The token can only be
                used once.
              </DialogDescription>
            </DialogHeader>

            <Input
              autoFocus
              placeholder="Setup token"
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button
              disabled={setupToken.trim().length < 10 || claim.isPending}
              onClick={() => {
                setError(null);
                claim.mutate({ setupToken: setupToken.trim() });
              }}
            >
              {claim.isPending ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
