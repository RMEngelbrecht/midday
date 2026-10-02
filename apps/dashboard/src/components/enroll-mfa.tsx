"use client";

import { useRouter } from "next/navigation";
import { TotpEnrollment } from "./totp-enrollment";

export function EnrollMFA() {
  const router = useRouter();

  return (
    <TotpEnrollment
      onEnrolled={() => router.replace("/")}
      onCancel={() => router.push("/")}
    />
  );
}
