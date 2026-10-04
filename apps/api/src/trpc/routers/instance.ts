import { checkInstanceAdmin } from "@api/auth/instance-admin";
import { ENV } from "@api/env";
import {
  createTRPCRouter,
  instanceAdminProcedure,
  protectedProcedure,
} from "@api/trpc/init";
import {
  authUserExists,
  createInstanceInvite,
  deleteInstanceInvite,
  getInstanceInvites,
} from "@midday/db/queries";
import { send } from "@midday/mailer";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

/** Sign-up link with the email prefilled on the dashboard login page. */
function signUpUrl(email: string) {
  const url = new URL("/login", ENV.APP_URL);
  url.searchParams.set("email", email);
  return url.toString();
}

export const instanceRouter = createTRPCRouter({
  isAdmin: protectedProcedure.query(async ({ ctx: { db, session } }) => {
    return checkInstanceAdmin(db, session.user.id);
  }),

  invites: createTRPCRouter({
    list: instanceAdminProcedure.query(async ({ ctx: { db } }) => {
      return getInstanceInvites(db);
    }),

    create: instanceAdminProcedure
      .input(z.object({ email: z.string().trim().email() }))
      .mutation(async ({ ctx: { db, session }, input }) => {
        if (await authUserExists(db, input.email)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This email already has an account",
          });
        }

        const invite = await createInstanceInvite(db, {
          email: input.email,
          invitedBy: session.user.id,
        });

        if (!invite) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This email is already invited",
          });
        }

        const link = signUpUrl(invite.email);
        const inviter = session.user.full_name || session.user.email;

        await send({
          fromName: "Midday",
          to: invite.email,
          subject: `${inviter} invited you to Midday`,
          text: [
            `${inviter} invited you to create an account on their Midday server.`,
            "",
            `Sign up here: ${link}`,
            "",
            "You will set up your own team after signing up.",
          ].join("\n"),
          html: `<p>${escapeHtml(inviter ?? "")} invited you to create an account on their Midday server.</p><p><a href="${escapeHtml(link)}">Create your account</a></p><p>You will set up your own team after signing up.</p>`,
        });

        return invite;
      }),

    revoke: instanceAdminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx: { db }, input }) => {
        const deleted = await deleteInstanceInvite(db, input.id);
        if (!deleted) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invite not found",
          });
        }
        return deleted;
      }),
  }),
});

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
