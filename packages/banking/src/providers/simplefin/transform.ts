import { capitalCase } from "change-case";
import type {
  Account as BaseAccount,
  Transaction as BaseTransaction,
  GetAccountBalanceResponse,
} from "../../types";
import type { AccountType } from "../../utils/account";
import type {
  SimplefinAccount,
  SimplefinAccountSet,
  SimplefinTransaction,
} from "./types";

export const SIMPLEFIN_INSTITUTION = {
  id: "simplefin",
  name: "SimpleFIN",
  logo: null,
  provider: "simplefin" as const,
};

/** SimpleFIN has no account type; infer the obvious credit-card cases. */
export function inferAccountType(account: SimplefinAccount): AccountType {
  const name = account.name.toLowerCase();
  if (/\b(credit|card|visa|mastercard|amex|discover)\b/.test(name)) {
    return "credit";
  }
  if (/\b(loan|mortgage|line of credit)\b/.test(name)) {
    return "loan";
  }
  return "depository";
}

/** ISO 4217 code, or a custom currency URL (rare): fall back to USD. */
function normalizeCurrency(currency: string) {
  return /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "USD";
}

export function epochToDate(epoch: number) {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

export function orgName(set: SimplefinAccountSet, account: SimplefinAccount) {
  return (
    account.org?.name ??
    account.org?.domain ??
    set.connections?.find((c) => c.conn_id === account.conn_id)?.name
  );
}

export function transformAccount(
  account: SimplefinAccount,
  set: SimplefinAccountSet,
): BaseAccount {
  const org = orgName(set, account);
  const name =
    org && !account.name.toLowerCase().includes(org.toLowerCase())
      ? `${org} ${account.name}`
      : account.name;
  const currency = normalizeCurrency(account.currency);
  const balance = +account.balance;
  const available = account["available-balance"];

  return {
    id: account.id,
    name,
    currency,
    type: inferAccountType(account),
    institution: SIMPLEFIN_INSTITUTION,
    balance: { amount: Number.isNaN(balance) ? 0 : balance, currency },
    enrollment_id: null,
    resource_id: account.id,
    expires_at: null,
    iban: null,
    subtype: null,
    bic: null,
    routing_number: null,
    wire_routing_number: null,
    account_number: null,
    sort_code: null,
    available_balance:
      available !== undefined && !Number.isNaN(+available) ? +available : null,
    credit_limit: null,
  };
}

export function transformBalance(
  account: SimplefinAccount,
): GetAccountBalanceResponse {
  const available = account["available-balance"];
  return {
    currency: normalizeCurrency(account.currency),
    amount: +account.balance,
    available_balance:
      available !== undefined && !Number.isNaN(+available) ? +available : null,
    credit_limit: null,
  };
}

export function transformTransaction({
  transaction,
  currency,
}: {
  transaction: SimplefinTransaction;
  currency: string;
}): BaseTransaction {
  const description = transaction.description?.trim() ?? "";
  // Pending transactions may have posted = 0; fall back to transacted_at
  const epoch = transaction.posted || transaction.transacted_at || 0;

  return {
    id: transaction.id,
    date: epochToDate(epoch),
    name: description ? capitalCase(description) : "Transaction",
    description: null,
    currency_rate: null,
    currency_source: null,
    method: "other",
    amount: +transaction.amount,
    currency: normalizeCurrency(currency),
    category: +transaction.amount > 0 ? "income" : null,
    balance: null,
    counterparty_name: null,
    merchant_name: null,
    status: transaction.pending ? "pending" : "posted",
  };
}
