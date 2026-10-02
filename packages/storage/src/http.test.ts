import { describe, expect, it } from "bun:test";
import { attachmentHeader, parseRange } from "./http";

describe("parseRange", () => {
  it("parses explicit, open and suffix ranges", () => {
    expect(parseRange("bytes=0-3", 10)).toEqual({ start: 0, end: 3 });
    expect(parseRange("bytes=5-", 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange("bytes=-4", 10)).toEqual({ start: 6, end: 9 });
    expect(parseRange("bytes=8-100", 10)).toEqual({ start: 8, end: 9 });
  });

  it("ignores missing or multi-range headers", () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange("bytes=0-1,4-5", 10)).toBeNull();
    expect(parseRange("items=0-1", 10)).toBeNull();
  });

  it("flags ranges outside the object", () => {
    expect(parseRange("bytes=10-", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=5-2", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 10)).toBe("unsatisfiable");
  });
});

describe("attachmentHeader", () => {
  it("quotes safely and keeps the UTF-8 name", () => {
    expect(attachmentHeader('fa"ktura ö.pdf')).toBe(
      `attachment; filename="fa_ktura _.pdf"; filename*=UTF-8''fa%22ktura%20%C3%B6.pdf`,
    );
  });
});
