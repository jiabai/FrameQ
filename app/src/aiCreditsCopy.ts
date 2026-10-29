import type { SupportedLocale } from "./i18n/locale";
import { resources } from "./i18n/resources";

function creditsCopy(locale: SupportedLocale) {
  return resources[locale].synthesis.credits;
}

export function getAiCreditsCostHint(locale: SupportedLocale): string {
  return creditsCopy(locale).costHint;
}

export function getAiCreditsDisclosureCopy(locale: SupportedLocale): string {
  return creditsCopy(locale).disclosure;
}
