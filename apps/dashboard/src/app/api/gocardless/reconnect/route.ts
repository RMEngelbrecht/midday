import { getSession } from "@midday/supabase/cached-queries";
import { updateBankConnection } from "@midday/supabase/mutations";
import { createClient } from "@midday/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { ENV } from "@/env";

export async function GET(req: NextRequest) {
  const origin = ENV.APP_URL;
  const {
    data: { session },
  } = await getSession();

  if (!session) {
    return NextResponse.redirect(new URL("/", origin));
  }

  const supabase = await createClient();
  const requestUrl = new URL(req.url);
  const id = requestUrl.searchParams.get("id");
  const referenceId = requestUrl.searchParams.get("reference_id") ?? undefined;
  const accessValidForDays = Number(
    requestUrl.searchParams.get("access_valid_for_days"),
  );
  const isDesktop = requestUrl.searchParams.get("desktop");

  if (id) {
    await updateBankConnection(supabase, {
      id,
      referenceId,
      accessValidForDays: accessValidForDays || 180,
    });
  }

  if (isDesktop === "true") {
    const scheme = ENV.DESKTOP_SCHEME;
    return NextResponse.redirect(
      `${scheme}://settings/accounts?id=${id}&step=reconnect`,
    );
  }

  return NextResponse.redirect(
    `${origin}/settings/accounts?id=${id}&step=reconnect`,
  );
}
