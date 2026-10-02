import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { PPTXLoader } from "@langchain/community/document_loaders/fs/pptx";
import { getModelHandle, isAIEnabled } from "@midday/ai";
import { generateText } from "ai";
import { parseOfficeAsync } from "officeparser";
import { cleanText, extractTextFromRtf } from "../utils";
import { extractTextFromPdf } from "../utils/pdf-text-extract";
import { retryCall } from "../utils/retry";

export async function loadDocument({
  content,
  metadata,
}: {
  content: Blob;
  metadata: { mimetype: string };
}) {
  let document: string | null = null;

  switch (metadata.mimetype) {
    case "application/pdf":
    case "application/x-pdf": {
      try {
        const arrayBuffer = await content.arrayBuffer();

        // Embedded text layer first: free, and the only option for models that
        // cannot take PDFs (openai-compatible servers). Scanned PDFs need a
        // PDF-capable vision model.
        const embeddedText = await extractTextFromPdf("", arrayBuffer);
        const vision = isAIEnabled() ? getModelHandle("vision") : null;
        if (embeddedText && !vision?.pdfInput) {
          document = embeddedText;
          break;
        }
        if (!vision?.pdfInput) {
          document = null;
          break;
        }

        const base64Content = Buffer.from(arrayBuffer).toString("base64");

        // Use retry logic to handle transient failures (503 errors, timeouts)
        const result = await retryCall(
          () =>
            generateText({
              model: vision.model,
              abortSignal: AbortSignal.timeout(60000), // 60s timeout for PDF extraction
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text: "Extract all text from this PDF document. Return only the extracted text, preserving the structure and formatting as much as possible.",
                    },
                    {
                      type: "file",
                      data: base64Content,
                      mediaType: "application/pdf",
                    },
                  ],
                },
              ],
            }),
          2, // 2 retries (3 total attempts)
          2000, // Start with 2s delay
        );

        document = result.text ?? null;
      } catch (error) {
        // Log detailed error information for debugging
        const errorDetails: Record<string, unknown> = {
          error: error instanceof Error ? error.message : String(error),
          errorName: error instanceof Error ? error.name : typeof error,
        };
        if (error instanceof Error && error.stack) {
          errorDetails.errorStack = error.stack;
        }
        console.error("PDF extraction failed after retries:", errorDetails);
        // Return null instead of throwing to allow the process to continue
        // The upstream code will handle null documents appropriately
        document = null;
      }

      break;
    }

    case "text/csv": {
      const loader = new CSVLoader(content);

      document = await loader
        .load()
        .then((docs) => docs.map((doc) => doc.pageContent).join("\n"));
      break;
    }

    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.oasis.opendocument.text":
    case "application/vnd.oasis.opendocument.spreadsheet":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/msword":
    case "application/vnd.ms-excel":
    case "application/vnd.oasis.opendocument.presentation":
    case "application/docx": {
      const arrayBuffer = await content.arrayBuffer();
      const result = await parseOfficeAsync(Buffer.from(arrayBuffer));

      document = result;
      break;
    }

    case "text/markdown":
    case "text/plain": {
      const loader = new TextLoader(content);

      document = await loader
        .load()
        .then((docs) => docs.map((doc) => doc.pageContent).join("\n"));
      break;
    }

    case "application/rtf": {
      const arrayBuffer = await content.arrayBuffer();
      const text = extractTextFromRtf(Buffer.from(arrayBuffer));

      document = text;
      break;
    }

    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    case "application/pptx": {
      const loader = new PPTXLoader(content);
      document = await loader
        .load()
        .then((docs) => docs.map((doc) => doc.pageContent).join("\n"));
      break;
    }

    default: {
      throw new Error(`Unsupported file type: ${metadata.mimetype}`);
    }
  }

  return document ? cleanText(document) : null;
}
