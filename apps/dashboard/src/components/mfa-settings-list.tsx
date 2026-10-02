import { Button } from "@midday/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@midday/ui/card";
import Link from "next/link";
import { getServerSession } from "@/utils/auth.server";
import { UnenrollMFA } from "./unenroll-mfa";

export async function MfaSettingsList() {
  const session = await getServerSession();
  const hasMfaFactors = !!session?.user.twoFactorEnabled;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Multi-factor authentication</CardTitle>
        <CardDescription>
          Add an additional layer of security to your account by requiring more
          than just a password to sign in.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {hasMfaFactors && <UnenrollMFA />}
        {!hasMfaFactors && (
          <p className="text-sm text-[#606060]">
            Multi-factor authentication is not enabled. Enable it to add an
            additional layer of security to your account.
          </p>
        )}
      </CardContent>

      <CardFooter className="flex justify-between">
        <div />
        {!hasMfaFactors && (
          <Link href="?add=device">
            <Button>Enable MFA</Button>
          </Link>
        )}
      </CardFooter>
    </Card>
  );
}
