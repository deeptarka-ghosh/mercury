import { getDatabase } from '../../db/database.js';
import { AppError } from '../../errors/AppError.js';
import { sql } from 'kysely';

export interface StoreSettingsResponse {
  storeName: string;
  defaultCurrency: string;
  countryCode: string;
  timezone: string;
  locale: string;
  gstin: string | null;
  legalBusinessName: string | null;
  businessAddress: string | null;
  supportEmail: string | null;
  supportMobile: string | null;
}

export interface UpdateStoreSettingsInput {
  storeName?: string;
  defaultCurrency?: string;
  countryCode?: string;
  timezone?: string;
  locale?: string;
  gstin?: string | null;
  legalBusinessName?: string | null;
  businessAddress?: string | null;
  supportEmail?: string | null;
  supportMobile?: string | null;
}

function mapSettings(row: {
  store_name: string;
  default_currency: string;
  country_code: string;
  timezone: string;
  locale: string;
  gstin: string | null;
  legal_business_name: string | null;
  business_address: string | null;
  support_email: string | null;
  support_mobile: string | null;
}): StoreSettingsResponse {
  return {
    storeName: row.store_name,
    defaultCurrency: row.default_currency,
    countryCode: row.country_code,
    timezone: row.timezone,
    locale: row.locale,
    gstin: row.gstin,
    legalBusinessName: row.legal_business_name,
    businessAddress: row.business_address,
    supportEmail: row.support_email,
    supportMobile: row.support_mobile,
  };
}

export async function getStoreSettings(): Promise<StoreSettingsResponse> {
  const db = getDatabase();
  const row = await db
    .selectFrom('store_settings')
    .selectAll()
    .executeTakeFirst();

  if (!row) {
    throw AppError.notFound('Store settings not initialized');
  }

  return mapSettings(row);
}

export async function updateStoreSettings(
  input: UpdateStoreSettingsInput,
): Promise<StoreSettingsResponse> {
  const db = getDatabase();

  const existing = await db
    .selectFrom('store_settings')
    .select('id')
    .executeTakeFirst();

  if (!existing) {
    throw AppError.notFound('Store settings not initialized');
  }

  const updates: Record<string, unknown> = { updated_at: sql`now()` };

  if (input.storeName !== undefined) {
    if (typeof input.storeName !== 'string' || input.storeName.length === 0) {
      throw AppError.badRequest('storeName must be a non-empty string');
    }
    updates.store_name = input.storeName;
  }
  if (input.defaultCurrency !== undefined) {
    if (typeof input.defaultCurrency !== 'string' || input.defaultCurrency.length !== 3) {
      throw AppError.badRequest('defaultCurrency must be a 3-letter currency code');
    }
    updates.default_currency = input.defaultCurrency.toUpperCase();
  }
  if (input.countryCode !== undefined) {
    if (typeof input.countryCode !== 'string' || input.countryCode.length !== 2) {
      throw AppError.badRequest('countryCode must be a 2-letter country code');
    }
    updates.country_code = input.countryCode.toUpperCase();
  }
  if (input.timezone !== undefined) {
    if (typeof input.timezone !== 'string') {
      throw AppError.badRequest('timezone must be a string');
    }
    updates.timezone = input.timezone;
  }
  if (input.locale !== undefined) {
    if (typeof input.locale !== 'string') {
      throw AppError.badRequest('locale must be a string');
    }
    updates.locale = input.locale;
  }
  if (input.gstin !== undefined) {
    updates.gstin = input.gstin;
  }
  if (input.legalBusinessName !== undefined) {
    updates.legal_business_name = input.legalBusinessName;
  }
  if (input.businessAddress !== undefined) {
    updates.business_address = input.businessAddress;
  }
  if (input.supportEmail !== undefined) {
    updates.support_email = input.supportEmail;
  }
  if (input.supportMobile !== undefined) {
    updates.support_mobile = input.supportMobile;
  }

  if (Object.keys(updates).length <= 1) {
    throw AppError.badRequest('Nothing to update');
  }

  await db
    .updateTable('store_settings')
    .set(updates as never)
    .execute();

  return getStoreSettings();
}