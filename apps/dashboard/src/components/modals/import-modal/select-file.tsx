import {
  decodeStatementBytes,
  parseStatement,
  STATEMENT_EXTENSIONS,
} from "@midday/import/statement";
import { cn } from "@midday/ui/cn";
import { Spinner } from "@midday/ui/spinner";
import Papa from "papaparse";
import { useCallback, useEffect, useRef, useState } from "react";
import Dropzone, { type FileRejection } from "react-dropzone";
import { Controller } from "react-hook-form";
import { useCsvContext } from "./context";
import { readLines } from "./utils";

export function SelectFile() {
  const { watch, control, setFileColumns, setFirstRows, setStatement } =
    useCsvContext();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const processingRef = useRef<string | null>(null);

  const file = watch("file");

  const processFile = useCallback(
    async (fileToProcess: File) => {
      // Prevent duplicate processing of the same file
      const fileKey = `${fileToProcess.name}-${fileToProcess.size}-${fileToProcess.lastModified}`;
      if (processingRef.current === fileKey) {
        return;
      }

      if (!fileToProcess) {
        setFileColumns(null);
        return;
      }

      processingRef.current = fileKey;
      setIsLoading(true);
      setError(null);
      // Clear old preview data early so remapping only uses the latest file.
      setFileColumns(null);
      setFirstRows(null);
      setStatement(null);

      // Structured statements (OFX/QFX, CAMT.053, MT940, QIF) skip column mapping
      const lower = fileToProcess.name.toLowerCase();
      if (STATEMENT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        try {
          const parsed = parseStatement(
            decodeStatementBytes(
              new Uint8Array(await fileToProcess.arrayBuffer()),
            ),
            fileToProcess.name,
          );
          const transactionCount =
            parsed?.accounts.reduce((n, a) => n + a.transactions.length, 0) ??
            0;
          if (!parsed || transactionCount === 0) {
            setError("No transactions found in this statement file.");
            setIsLoading(false);
            processingRef.current = null;
            return;
          }
          const acct = parsed.accounts[0];
          setStatement({
            format: parsed.format,
            transactionCount,
            accountLabel: acct?.iban ?? acct?.accountNumber,
            currency: acct?.currency,
          });
        } catch {
          setError("Failed to read statement file.");
        }
        setIsLoading(false);
        processingRef.current = null;
        return;
      }

      readLines(fileToProcess, 4)
        .then((lines) => {
          const { data, meta } = Papa.parse(lines, {
            worker: false,
            skipEmptyLines: true,
            header: true,
          });

          if (!data || data.length < 2) {
            setError("CSV file must have at least 2 rows.");
            setFileColumns(null);
            setFirstRows(null);
            setIsLoading(false);
            return;
          }

          if (!meta?.fields || meta.fields.length <= 1) {
            setError("Failed to retrieve CSV column data.");
            setFileColumns(null);
            setFirstRows(null);
            setIsLoading(false);
            return;
          }

          setFileColumns(meta.fields);
          // @ts-expect-error
          setFirstRows(data);
          setIsLoading(false);
          processingRef.current = null;
        })
        .catch((err) => {
          console.error("Error processing file:", err);
          setError("Failed to read CSV file.");
          setFileColumns(null);
          setFirstRows(null);
          setIsLoading(false);
          processingRef.current = null;
        });
    },
    [setFileColumns, setFirstRows, setStatement],
  );

  useEffect(() => {
    if (file) {
      processFile(file);
    }
  }, [file, processFile]);

  return (
    <div className="flex flex-col gap-3">
      <Controller
        control={control}
        name="file"
        render={({ field: { onChange, onBlur } }) => (
          <Dropzone
            onDrop={(acceptedFiles) => {
              const file = acceptedFiles[0];
              if (file) {
                onChange(file);
                // Process file immediately to avoid waiting for watch to update
                processFile(file);
              }
            }}
            onDropRejected={(fileRejections: FileRejection[]) => {
              const rejection = fileRejections[0];
              if (rejection) {
                const error = rejection.errors[0];
                if (error?.code === "file-invalid-type") {
                  setError(
                    "Please select a CSV, OFX/QFX, CAMT.053 (XML), MT940 or QIF file.",
                  );
                } else if (error?.code === "file-too-large") {
                  setError("File size exceeds 5MB limit.");
                } else {
                  setError("File rejected. Please try again.");
                }
                console.error("File rejected:", rejection.errors);
              }
            }}
            maxFiles={1}
            accept={{
              "text/csv": [".csv"],
              "application/csv": [".csv"],
              "text/plain": [".csv", ".ofx", ".qfx", ".sta", ".mt940", ".qif"],
              "application/vnd.ms-excel": [".csv"],
              "application/x-ofx": [".ofx", ".qfx"],
              "application/xml": [".xml"],
              "text/xml": [".xml"],
              "application/octet-stream": [
                ".ofx",
                ".qfx",
                ".sta",
                ".mt940",
                ".qif",
              ],
            }}
            maxSize={5000000}
          >
            {({ getRootProps, getInputProps, isDragActive, isDragReject }) => (
              <div
                {...getRootProps()}
                className={cn(
                  "w-full border border-dashed h-[200px] mt-8 mb-8 flex items-center justify-center",
                  isDragActive && "bg-secondary text-primary",
                  isDragReject && "border-destructive",
                )}
              >
                <div className="text-center flex items-center justify-center flex-col text-xs text-[#878787]">
                  <input {...getInputProps()} onBlur={onBlur} />

                  {isLoading ? (
                    <div className="flex space-x-1 items-center">
                      <Spinner />
                      <span>Loading...</span>
                    </div>
                  ) : (
                    <div>
                      <p>Drop your file here, or click to browse.</p>
                      <span>5MB file limit. </span>
                      <span className="mt-2 text-[10px]">
                        CSV, OFX/QFX, CAMT.053, MT940, QIF
                      </span>
                    </div>
                  )}

                  {error && (
                    <p className="text-center text-sm text-red-600 mt-4">
                      {error}
                    </p>
                  )}
                </div>
              </div>
            )}
          </Dropzone>
        )}
      />
    </div>
  );
}
