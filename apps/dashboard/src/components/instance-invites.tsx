"use client";

import { Button } from "@midday/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@midday/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@midday/ui/form";
import { Input } from "@midday/ui/input";
import { SubmitButton } from "@midday/ui/submit-button";
import { useToast } from "@midday/ui/use-toast";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { z } from "zod/v3";
import { useZodForm } from "@/hooks/use-zod-form";
import { useTRPC } from "@/trpc/client";

const formSchema = z.object({
  email: z.string().email(),
});

/**
 * Instance admins invite people to sign up on this server. Unlike team
 * invites, the invitee does not join a team: they create their own.
 */
export function InstanceInvites() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: invites } = useSuspenseQuery(
    trpc.instance.invites.list.queryOptions(),
  );

  const form = useZodForm(formSchema, { defaultValues: { email: "" } });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.instance.invites.list.queryKey(),
    });

  const onError = (error: { message: string }) =>
    toast({ duration: 3500, variant: "error", title: error.message });

  const createInvite = useMutation(
    trpc.instance.invites.create.mutationOptions({
      onSuccess: (invite) => {
        form.reset();
        invalidate();
        toast({ duration: 3500, title: `Invite sent to ${invite.email}` });
      },
      onError,
    }),
  );

  const revokeInvite = useMutation(
    trpc.instance.invites.revoke.mutationOptions({
      onSuccess: invalidate,
      onError,
    }),
  );

  const onSubmit = form.handleSubmit((data) => createInvite.mutate(data));

  return (
    <div className="space-y-12">
      <Form {...form}>
        <form onSubmit={onSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Invite to this instance</CardTitle>
              <CardDescription>
                Invite someone to create an account on this server. They sign up
                and set up their own team; they do not join yours.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="max-w-[300px]">
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="jane@example.com"
                        type="email"
                        autoComplete="off"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>

            <CardFooter className="flex justify-end">
              <SubmitButton
                isSubmitting={createInvite.isPending}
                disabled={createInvite.isPending}
              >
                Send invite
              </SubmitButton>
            </CardFooter>
          </Card>
        </form>
      </Form>

      <Card>
        <CardHeader>
          <CardTitle>Pending instance invites</CardTitle>
          <CardDescription>
            An invite is used up when its recipient signs up.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {invites.length === 0 ? (
            <p className="text-sm text-[#606060]">No pending invites.</p>
          ) : (
            <ul className="divide-y divide-border">
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex flex-col">
                    <span className="text-sm">{invite.email}</span>
                    {invite.invitedBy?.fullName && (
                      <span className="text-xs text-[#606060]">
                        Invited by {invite.invitedBy.fullName}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revokeInvite.isPending}
                    onClick={() => revokeInvite.mutate({ id: invite.id })}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
