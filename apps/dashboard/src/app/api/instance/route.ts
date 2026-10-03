import { NextResponse } from "next/server";
import { ENV } from "@/env";
import { buildInstanceInfo } from "@/utils/instance-info";

export const dynamic = "force-dynamic";

export const GET = () => {
  return NextResponse.json(
    buildInstanceInfo({
      appUrl: ENV.APP_URL,
      apiUrl: ENV.API_URL,
      desktopScheme: ENV.DESKTOP_SCHEME,
      release: ENV.GIT_COMMIT_SHA,
    }),
  );
};
