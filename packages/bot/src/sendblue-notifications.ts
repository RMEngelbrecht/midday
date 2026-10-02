import SendblueAPI from "sendblue";
import { ENV } from "./env";

function getSendblueConfig() {
  const apiKey = ENV.SENDBLUE_API_KEY;
  const apiSecret = ENV.SENDBLUE_API_SECRET;
  const fromNumber = ENV.SENDBLUE_FROM_NUMBER;

  if (!apiKey || !apiSecret || !fromNumber) {
    throw new Error(
      "Missing Sendblue configuration: SENDBLUE_API_KEY, SENDBLUE_API_SECRET, and SENDBLUE_FROM_NUMBER are required",
    );
  }

  return { apiKey, apiSecret, fromNumber };
}

export async function sendSendblueTextNotification(params: {
  phoneNumber: string;
  text: string;
}) {
  const { apiKey, apiSecret, fromNumber } = getSendblueConfig();

  const client = new SendblueAPI({ apiKey, apiSecret });

  await client.messages.send({
    content: params.text,
    from_number: fromNumber,
    number: params.phoneNumber,
    status_callback: ENV.SENDBLUE_STATUS_CALLBACK_URL,
  });
}
