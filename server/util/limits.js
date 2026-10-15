// shared input limits, keep in sync with the maxLength/max attributes in the client
export const MAX_EMAIL_LENGTH = 254;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72; // bcrypt ignores everything past 72 bytes
export const MAX_ITEM_NAME_LENGTH = 100;
export const MAX_CATEGORY_LENGTH = 50;
export const MAX_CENTS = 100_000_000; // $1,000,000
export const MAX_EXPENSES_PER_WEEK = 500;
export const MAX_EXPENSES_PER_MONTH = 2000;
