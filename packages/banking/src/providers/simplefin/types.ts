/** SimpleFIN protocol v1/v2 payloads (https://www.simplefin.org/protocol.html) */
export type SimplefinOrg = {
  id?: string;
  domain?: string;
  name?: string;
  url?: string;
  "sfin-url"?: string;
};

export type SimplefinTransaction = {
  id: string;
  /** Unix epoch seconds */
  posted: number;
  /** Numeric string, negative = money out of the account */
  amount: string;
  description: string;
  transacted_at?: number;
  pending?: boolean;
  extra?: Record<string, unknown>;
};

export type SimplefinAccount = {
  id: string;
  name: string;
  /** v1 */
  org?: SimplefinOrg;
  /** v2 */
  conn_id?: string;
  currency: string;
  balance: string;
  "available-balance"?: string;
  /** Unix epoch seconds */
  "balance-date"?: number;
  transactions?: SimplefinTransaction[];
};

export type SimplefinConnection = {
  conn_id: string;
  name?: string;
  org_id?: string;
  org_url?: string;
  sfin_url?: string;
};

export type SimplefinError = {
  code?: string;
  msg?: string;
  conn_id?: string;
  account_id?: string;
};

export type SimplefinAccountSet = {
  /** v1: plain strings */
  errors?: string[];
  /** v2 */
  errlist?: SimplefinError[];
  connections?: SimplefinConnection[];
  accounts: SimplefinAccount[];
};
