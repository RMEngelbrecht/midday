"use client";

import { Dialog, DialogContent } from "@midday/ui/dialog";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TotpEnrollment } from "@/components/totp-enrollment";

export function AddNewDeviceModal() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isOpen = searchParams.get("add") === "device";

  const close = () => {
    router.push(pathname);
    router.refresh();
  };

  return (
    <Dialog open={isOpen} onOpenChange={close}>
      <DialogContent
        className="max-w-[455px]"
        onInteractOutside={(evt) => {
          evt.preventDefault();
        }}
      >
        <div className="p-6 pt-14">
          {isOpen && (
            <TotpEnrollment onEnrolled={close} onCancel={close} qrSize={190} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
