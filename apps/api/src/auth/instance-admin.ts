import { ENV } from "@api/env";
import type { Database } from "@midday/db/client";
import { getInstanceAdminFacts } from "@midday/db/queries";
import { isInstanceAdmin, parseEmailList } from "./policy";

// ADMIN_EMAILS may always sign up too: an admin who cannot register is useless.
export const signupAllowlist = parseEmailList(
  [ENV.SIGNUP_ALLOWED_EMAILS, ENV.ADMIN_EMAILS].join(","),
);
const adminEmails = parseEmailList(ENV.ADMIN_EMAILS);

/** Whether the user is an instance admin (first account or ADMIN_EMAILS). */
export async function checkInstanceAdmin(
  db: Database,
  userId: string,
): Promise<boolean> {
  const { email, firstUserId } = await getInstanceAdminFacts(db, userId);
  if (!email) return false;
  return isInstanceAdmin({ userId, email, firstUserId, adminEmails });
}
