import { InviteEmail } from "@midday/email/emails/invite";
import { getI18n } from "@midday/email/locales";
import type { Job } from "bullmq";
import {
  type InviteTeamMembersPayload,
  inviteTeamMembersSchema,
} from "../../schemas/teams";
import { sendEmail } from "../../utils/mailer";
import { BaseProcessor } from "../base";

/**
 * Send team invite emails, one per invitee.
 */
export class InviteTeamMembersProcessor extends BaseProcessor<InviteTeamMembersPayload> {
  protected override getPayloadSchema() {
    return inviteTeamMembersSchema;
  }

  async process(job: Job<InviteTeamMembersPayload>): Promise<{ sent: number }> {
    const { ip, invites, locale } = job.data;
    const { t } = getI18n({ locale });

    for (const invite of invites) {
      await sendEmail({
        fromName: "Midday",
        to: invite.email,
        subject: t("invite.subject", {
          invitedByName: invite.invitedByName,
          teamName: invite.teamName,
        }),
        react: InviteEmail({
          invitedByEmail: invite.invitedByEmail,
          invitedByName: invite.invitedByName,
          email: invite.email,
          teamName: invite.teamName,
          ip,
          locale,
        }),
      });
    }

    return { sent: invites.length };
  }
}
