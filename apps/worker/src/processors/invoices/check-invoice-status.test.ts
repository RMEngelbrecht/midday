import { describe, expect, test } from "bun:test";
import { decideInvoiceStatus, toDateInTimezone } from "./check-invoice-status";

const now = new Date("2026-03-10T12:00:00Z");

describe("decideInvoiceStatus", () => {
  test("a single matching transaction marks the invoice paid", () => {
    expect(
      decideInvoiceStatus({
        status: "overdue",
        dueDate: "2026-03-01T00:00:00Z",
        candidateCount: 1,
        now,
      }),
    ).toBe("paid");
  });

  test("ambiguous matches never mark paid", () => {
    expect(
      decideInvoiceStatus({
        status: "unpaid",
        dueDate: "2026-04-01T00:00:00Z",
        candidateCount: 2,
        now,
      }),
    ).toBeNull();
  });

  test("unpaid past due becomes overdue; already overdue stays", () => {
    const pastDue = {
      dueDate: "2026-03-09T00:00:00Z",
      candidateCount: 0,
      now,
    };
    expect(decideInvoiceStatus({ ...pastDue, status: "unpaid" })).toBe(
      "overdue",
    );
    expect(decideInvoiceStatus({ ...pastDue, status: "overdue" })).toBeNull();
  });
});

describe("toDateInTimezone", () => {
  test("uses the calendar date in the given timezone", () => {
    const instant = new Date("2026-03-10T02:00:00Z");
    expect(toDateInTimezone(instant, "UTC")).toBe("2026-03-10");
    expect(toDateInTimezone(instant, "America/New_York")).toBe("2026-03-09");
    expect(toDateInTimezone(instant, "Not/AZone")).toBe("2026-03-10");
  });
});
