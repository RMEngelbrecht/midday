import { isAIEnabled } from "@midday/ai";
import { InvoiceProcessor } from "./processors/invoice/invoice-processor";
import { ReceiptProcessor } from "./processors/receipt/receipt-processor";
import type { GetDocumentRequest, GetInvoiceOrReceiptResponse } from "./types";
import { getDocumentTypeFromMimeType } from "./utils";

export class DocumentClient {
  public async getInvoiceOrReceipt(
    params: GetDocumentRequest,
  ): Promise<GetInvoiceOrReceiptResponse> {
    const documentType = getDocumentTypeFromMimeType(params.mimetype);

    // No AI configured: the document is marked processed with no extracted fields.
    if (!isAIEnabled()) {
      return {
        type: documentType,
        document_type: documentType as "invoice" | "receipt",
      };
    }

    if (documentType === "invoice") {
      const processor = new InvoiceProcessor();
      return processor.getInvoice(params);
    }

    const processor = new ReceiptProcessor();
    return processor.getReceipt(params);
  }
}
