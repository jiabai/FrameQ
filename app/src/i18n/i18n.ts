import { createInstance, type Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import { SUPPORTED_LOCALES, type SupportedLocale } from "./locale";
import { RESOURCE_NAMESPACES, resources } from "./resources";

export const frameqI18n = createInstance();

let initialization: Promise<void> | null = null;

export async function initializeI18n(locale: SupportedLocale): Promise<void> {
  if (!initialization) {
    initialization = frameqI18n
      .use(initReactI18next)
      .init({
        resources: resources as unknown as Resource,
        lng: locale,
        fallbackLng: "en-US",
        supportedLngs: [...SUPPORTED_LOCALES],
        load: "currentOnly",
        ns: [...RESOURCE_NAMESPACES],
        defaultNS: "common",
        interpolation: { escapeValue: false },
        returnNull: false,
      })
      .then(() => undefined);
  }

  await initialization;
  if (frameqI18n.resolvedLanguage !== locale) {
    await frameqI18n.changeLanguage(locale);
  }
}
