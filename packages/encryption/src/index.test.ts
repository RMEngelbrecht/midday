import { describe, expect, it } from "bun:test";
import { decrypt, encrypt } from "./index";

// MIDDAY_ENCRYPTION_KEY comes from the root `.env.test` (loaded by `varlock run`).

describe("Encryption/Decryption", () => {
  const plaintext = "This is a secret message.";
  const emptyPlaintext = "";
  it("should encrypt and decrypt a string successfully", () => {
    const encrypted = encrypt(plaintext);
    expect(typeof encrypted).toBe("string");
    // Basic check for base64 format
    expect(Buffer.from(encrypted, "base64").toString("base64")).toBe(encrypted);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("should encrypt and decrypt an empty string successfully", () => {
    const encrypted = encrypt(emptyPlaintext);
    expect(typeof encrypted).toBe("string");
    expect(Buffer.from(encrypted, "base64").toString("base64")).toBe(encrypted);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(emptyPlaintext);
  });
});
