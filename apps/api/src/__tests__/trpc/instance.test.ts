import { beforeEach, describe, expect, test } from "bun:test";
import { getInstanceAdminFacts, getInstanceInvites } from "@midday/db/queries";
import { createCallerFactory } from "../../trpc/init";
import { instanceRouter } from "../../trpc/routers/instance";
import { createTestContext } from "../helpers/test-context";
import { asMock } from "../setup";

const createCaller = createCallerFactory(instanceRouter);

function facts(firstUserId: string, email = "someone@example.com") {
  asMock(getInstanceAdminFacts).mockImplementation(() =>
    Promise.resolve({ email, firstUserId }),
  );
}

describe("tRPC: instance", () => {
  beforeEach(() => {
    asMock(getInstanceInvites).mockReset();
    asMock(getInstanceInvites).mockImplementation(() =>
      Promise.resolve([{ id: "invite-1", email: "guest@example.com" }]),
    );
  });

  test("the first user is an admin", async () => {
    facts("test-user-id");
    const caller = createCaller(createTestContext());
    expect(await caller.isAdmin()).toBe(true);
    expect(await caller.invites.list()).toHaveLength(1);
  });

  test("other users are not admins and get FORBIDDEN", async () => {
    facts("someone-else");
    const caller = createCaller(createTestContext());
    expect(await caller.isAdmin()).toBe(false);
    await expect(caller.invites.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.invites.create({ email: "guest@example.com" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getInstanceInvites).not.toHaveBeenCalled();
  });
});
