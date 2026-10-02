import { CancellationEmailFollowupProcessor } from "./cancellation-email-followup";
import { CancellationEmailsProcessor } from "./cancellation-emails";
import { DeleteTeamProcessor } from "./delete-team";
import { InviteTeamMembersProcessor } from "./invite-team-members";
import {
  OnboardingActivationEmailProcessor,
  OnboardingWelcomeEmailProcessor,
  OnboardTeamProcessor,
} from "./onboarding";
import { PaymentIssueProcessor } from "./payment-issue";

/**
 * Export all team processors (for type imports)
 */
export { CancellationEmailFollowupProcessor } from "./cancellation-email-followup";
export { CancellationEmailsProcessor } from "./cancellation-emails";
export { DeleteTeamProcessor } from "./delete-team";
export { PaymentIssueProcessor } from "./payment-issue";

/**
 * Team processor registry
 * Maps job names to processor instances
 */
export const teamProcessors = {
  "delete-team": new DeleteTeamProcessor(),
  "cancellation-email-immediate": new CancellationEmailsProcessor(),
  "cancellation-email-followup": new CancellationEmailFollowupProcessor(),
  "payment-issue": new PaymentIssueProcessor(),
  "onboard-team": new OnboardTeamProcessor(),
  "onboarding-welcome-email": new OnboardingWelcomeEmailProcessor(),
  "onboarding-activation-email": new OnboardingActivationEmailProcessor(),
  "invite-team-members": new InviteTeamMembersProcessor(),
};
