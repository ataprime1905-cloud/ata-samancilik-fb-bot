// ============================================================
// Settings Service
// ============================================================
// Runtime'da değiştirilebilen ayarlar (system_settings tablosu).
// - automation_mode: preview_only | semi_auto | full_auto
// - default_product_sku: aktif ürün
//
// Env'deki AUTOMATION_MODE bootstrap default'udur; üretimde DB'deki
// değer öncelikli alınır (admin panel UI/API ile değiştirilebilsin).
// ============================================================

import { getPrisma } from '../../infrastructure/db.js';
import { loadEnv } from '../../config/env.js';
import {
  AUTOMATION_MODES,
  DEFAULT_PRODUCT_SKU,
  type AutomationMode,
} from '../../config/constants.js';

const SETTING_KEYS = {
  AUTOMATION_MODE: 'automation_mode',
  DEFAULT_PRODUCT_SKU: 'default_product_sku',
} as const;

export async function getAutomationMode(): Promise<AutomationMode> {
  const prisma = getPrisma();
  const setting = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.AUTOMATION_MODE },
  });
  if (setting) {
    const value = setting.valueJson;
    if (typeof value === 'string' && isAutomationMode(value)) {
      return value;
    }
  }
  // Fallback env
  return loadEnv().AUTOMATION_MODE;
}

export async function setAutomationMode(mode: AutomationMode): Promise<void> {
  if (!isAutomationMode(mode)) {
    throw new Error(`Invalid automation mode: ${mode}`);
  }
  const prisma = getPrisma();
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.AUTOMATION_MODE },
    create: { key: SETTING_KEYS.AUTOMATION_MODE, valueJson: mode },
    update: { valueJson: mode },
  });
}

export async function getDefaultProductSku(): Promise<string> {
  const prisma = getPrisma();
  const setting = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.DEFAULT_PRODUCT_SKU },
  });
  if (setting && typeof setting.valueJson === 'string') {
    return setting.valueJson;
  }
  return DEFAULT_PRODUCT_SKU;
}

function isAutomationMode(value: string): value is AutomationMode {
  return (Object.values(AUTOMATION_MODES) as string[]).includes(value);
}

export const SETTINGS = SETTING_KEYS;
