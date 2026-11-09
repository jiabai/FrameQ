import { createInstance, type Resource } from "i18next";
import { initReactI18next } from "react-i18next";
import { PRODUCT_MARK, PRODUCT_NAME } from "../brand";
import { SUPPORTED_LOCALES, type SupportedLocale } from "./locale";
import { RESOURCE_NAMESPACES, resources } from "./resources";

export const appI18n = createInstance();

let initialization: Promise<void> | null = null;

export async function initializeI18n(locale: SupportedLocale): Promise<void> {
  if (!initialization) {
    initialization = appI18n
      .use(initReactI18next)
      .init({
        resources: resources as unknown as Resource,
        lng: locale,
        fallbackLng: "en-US",
        supportedLngs: [...SUPPORTED_LOCALES],
        load: "currentOnly",
        ns: [...RESOURCE_NAMESPACES],
        defaultNS: "common",
        interpolation: {
          escapeValue: false,
          defaultVariables: { product: PRODUCT_NAME, productMark: PRODUCT_MARK },
        },
        returnNull: false,
      })
      .then(() => undefined);
  }

  await initialization;
  if (appI18n.resolvedLanguage !== locale) {
    await appI18n.changeLanguage(locale);
  }
}
