import { countBankConnections, getUserById } from "@midday/db/queries";
import { TrialActivationEmail } from "@midday/email/emails/trial-activation";
import { WelcomeEmail } from "@midday/email/emails/welcome";
import { triggerJob } from "@midday/job-client";
import type { Job } from "bullmq";
import {
  type OnboardTeamPayload,
  onboardTeamSchema,
} from "../../schemas/teams";
import { getDb } from "../../utils/db";
import { sendEmail } from "../../utils/mailer";
import { BaseProcessor } from "../base";

/** Give the user time to finish onboarding (name, team) before welcoming. */
export const WELCOME_EMAIL_DELAY_MS = 10 * 60_000;
/** Day 3: nudge users who haven't connected a bank yet. */
export const ACTIVATION_EMAIL_DELAY_MS = 3 * 24 * 60 * 60_000;

/**
 * Enqueued when a user signs up. Schedules the onboarding email sequence as
 * delayed jobs; job ids are per user so a re-enqueue doesn't double-send.
 */
export class OnboardTeamProcessor extends BaseProcessor<OnboardTeamPayload> {
  protected override getPayloadSchema() {
    return onboardTeamSchema;
  }

  async process(
    job: Job<OnboardTeamPayload>,
  ): Promise<{ scheduled: string[] }> {
    const { userId } = job.data;

    const welcome = await triggerJob(
      "onboarding-welcome-email",
      { userId },
      "teams",
      { delay: WELCOME_EMAIL_DELAY_MS, jobId: `onboarding-welcome-${userId}` },
    );
    const activation = await triggerJob(
      "onboarding-activation-email",
      { userId },
      "teams",
      {
        delay: ACTIVATION_EMAIL_DELAY_MS,
        jobId: `onboarding-activation-${userId}`,
      },
    );

    return { scheduled: [welcome.id, activation.id] };
  }
}

async function getRecipient(userId: string) {
  const user = await getUserById(getDb(), userId);
  if (!user?.email) return null;
  return { ...user, email: user.email, fullName: user.fullName ?? "" };
}

export class OnboardingWelcomeEmailProcessor extends BaseProcessor<OnboardTeamPayload> {
  protected override getPayloadSchema() {
    return onboardTeamSchema;
  }

  async process(job: Job<OnboardTeamPayload>): Promise<{ sent: boolean }> {
    const user = await getRecipient(job.data.userId);
    if (!user) {
      this.logger.warn("User not found or has no email", job.data);
      return { sent: false };
    }

    await sendEmail({
      fromName: "Midday",
      to: user.email,
      subject: "Welcome to Midday",
      react: WelcomeEmail({ fullName: user.fullName }),
    });

    return { sent: true };
  }
}

export class OnboardingActivationEmailProcessor extends BaseProcessor<OnboardTeamPayload> {
  protected override getPayloadSchema() {
    return onboardTeamSchema;
  }

  async process(job: Job<OnboardTeamPayload>): Promise<{ sent: boolean }> {
    const user = await getRecipient(job.data.userId);
    if (!user?.teamId) {
      this.logger.info("User has no team, skipping activation email", job.data);
      return { sent: false };
    }

    const connections = await countBankConnections(getDb(), {
      teamId: user.teamId,
    });
    if (connections > 0) {
      return { sent: false };
    }

    await sendEmail({
      fromName: "Midday",
      to: user.email,
      subject: "Connect your bank to see the full picture",
      react: TrialActivationEmail({ fullName: user.fullName }),
    });

    return { sent: true };
  }
}
