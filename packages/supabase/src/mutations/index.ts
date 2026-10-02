import { addDays } from "date-fns";
import type { Client } from "../types";

type UpdateBankConnectionData = {
  id: string;
  referenceId?: string;
  accessValidForDays: number;
};

// NOTE: Only GoCardLess needs to be updated
export async function updateBankConnection(
  supabase: Client,
  data: UpdateBankConnectionData,
) {
  const { id, referenceId, accessValidForDays } = data;

  return await supabase
    .from("bank_connections")
    .update({
      expires_at: addDays(new Date(), accessValidForDays).toDateString(),
      reference_id: referenceId,
    })
    .eq("id", id)
    .select()
    .single();
}

type DeleteBankConnectionParams = {
  id: string;
};

export async function deleteBankConnection(
  supabase: Client,
  params: DeleteBankConnectionParams,
) {
  return supabase
    .from("bank_connections")
    .delete()
    .eq("id", params.id)
    .select("reference_id, provider, access_token")
    .single();
}
