import { HtmlTemplate } from "@midday/invoice/templates/html";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { SearchParams } from "nuqs";
import { InvoiceViewWrapper } from "@/components/invoice-view-wrapper";
import { getQueryClient, getTRPCClient, trpc } from "@/trpc/server";
import { getServerSession } from "@/utils/auth.server";

export async function generateMetadata(props: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const queryClient = getQueryClient();

  try {
    const invoice = await queryClient.fetchQuery(
      trpc.invoice.getInvoiceByToken.queryOptions({
        token: params.token,
      }),
    );

    if (!invoice) {
      return {
        title: "Invoice Not Found",
        robots: {
          index: false,
          follow: false,
        },
      };
    }

    const title = `Invoice ${invoice.invoiceNumber} | ${invoice.team?.name}`;
    const description = `Invoice for ${invoice.customerName || invoice.customer?.name || "Customer"}`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
      robots: {
        index: false,
        follow: false,
      },
    };
  } catch (_error) {
    return {
      title: "Invoice Not Found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }
}

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<SearchParams>;
};

export default async function Page(props: Props) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const viewerParam = searchParams?.viewer as string | undefined;
  const viewer = viewerParam ? decodeURIComponent(viewerParam) : undefined;

  const session = await getServerSession();

  const queryClient = getQueryClient();

  const invoice = await queryClient.fetchQuery(
    trpc.invoice.getInvoiceByToken.queryOptions({
      token: params.token,
    }),
  );

  if (!invoice) {
    notFound();
  }

  if (viewer && viewer.trim().length > 0) {
    // Marks the invoice viewed when `viewer` is the customer's encrypted
    // email. Fire and forget - don't block the page render.
    getTRPCClient()
      .then((client) =>
        client.invoice.markViewed.mutate({ token: params.token, viewer }),
      )
      .catch(() => {});
  }

  // If the invoice is draft and the user is not logged in, return 404 or if the invoice is not found
  if (!invoice || (invoice.status === "draft" && !session)) {
    notFound();
  }

  const width = invoice.template.size === "letter" ? 750 : 595;
  const height = invoice.template.size === "letter" ? 1056 : 842;

  // Payment is only enabled if: template has it enabled AND team has Stripe connected
  const paymentEnabled =
    invoice.template.paymentEnabled && invoice.team?.stripeConnected === true;

  return (
    <>
      <InvoiceViewWrapper
        token={invoice.token}
        invoiceNumber={invoice.invoiceNumber || "invoice"}
        paymentEnabled={paymentEnabled}
        amount={invoice.amount ?? undefined}
        currency={invoice.currency ?? undefined}
        initialStatus={invoice.status}
        customerName={
          invoice.customerName || (invoice.customer?.name as string)
        }
        customerWebsite={invoice.customer?.website}
        customerPortalEnabled={invoice.customer?.portalEnabled ?? false}
        customerPortalId={invoice.customer?.portalId ?? undefined}
        invoiceWidth={width}
      >
        <div className="pb-24 md:pb-0">
          <div className="shadow-[0_24px_48px_-12px_rgba(0,0,0,0.3)] dark:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]">
            <HtmlTemplate data={invoice} width={width} height={height} />
          </div>
        </div>
      </InvoiceViewWrapper>
    </>
  );
}
