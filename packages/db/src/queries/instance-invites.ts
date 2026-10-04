import { asc, desc, eq, sql } from "drizzle-orm";
import { authUser } from "../auth-schema";
import type { Database } from "../client";
import { instanceInvites, users } from "../schema";

const sameEmail = (column: typeof instanceInvites.email, email: string) =>
  sql`lower(${column}) = lower(${email})`;

export async function getInstanceInvites(db: Database) {
  return db
    .select({
      id: instanceInvites.id,
      email: instanceInvites.email,
      createdAt: instanceInvites.createdAt,
      invitedBy: {
        id: users.id,
        fullName: users.fullName,
        email: users.email,
      },
    })
    .from(instanceInvites)
    .leftJoin(users, eq(instanceInvites.invitedBy, users.id))
    .orderBy(desc(instanceInvites.createdAt));
}

export async function hasInstanceInvite(db: Database, email: string) {
  const [row] = await db
    .select({ id: instanceInvites.id })
    .from(instanceInvites)
    .where(sameEmail(instanceInvites.email, email))
    .limit(1);
  return !!row;
}

/** Returns the new invite, or undefined when the email is already invited. */
export async function createInstanceInvite(
  db: Database,
  params: { email: string; invitedBy: string },
) {
  const [row] = await db
    .insert(instanceInvites)
    .values({ email: params.email.trim(), invitedBy: params.invitedBy })
    .onConflictDoNothing()
    .returning({
      id: instanceInvites.id,
      email: instanceInvites.email,
      createdAt: instanceInvites.createdAt,
    });
  return row;
}

export async function deleteInstanceInvite(db: Database, id: string) {
  const [row] = await db
    .delete(instanceInvites)
    .where(eq(instanceInvites.id, id))
    .returning({ id: instanceInvites.id, email: instanceInvites.email });
  return row;
}

/** Consumes the invite once its invitee has signed up. */
export async function deleteInstanceInviteByEmail(db: Database, email: string) {
  await db
    .delete(instanceInvites)
    .where(sameEmail(instanceInvites.email, email));
}

/** Whether an account already exists for this email. */
export async function authUserExists(db: Database, email: string) {
  const [row] = await db
    .select({ id: authUser.id })
    .from(authUser)
    .where(sql`lower(${authUser.email}) = lower(${email})`)
    .limit(1);
  return !!row;
}

/** The user's email, plus the id of the first account ever created. */
export async function getInstanceAdminFacts(db: Database, userId: string) {
  const [[user], [first]] = await Promise.all([
    db
      .select({ email: authUser.email })
      .from(authUser)
      .where(eq(authUser.id, userId)),
    db
      .select({ id: authUser.id })
      .from(authUser)
      .orderBy(asc(authUser.createdAt), asc(authUser.id))
      .limit(1),
  ]);
  return { email: user?.email, firstUserId: first?.id };
}
