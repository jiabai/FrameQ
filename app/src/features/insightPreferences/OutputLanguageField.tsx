import type { SupportedLocale } from "../../i18n/locale";
import {
  getOutputLanguageName,
  getPreferenceCopy,
} from "../../i18n/preferencePresentation";

type OutputLanguageFieldProps = {
  locale: SupportedLocale;
  outputLanguage: SupportedLocale;
};

export function OutputLanguageField({
  locale,
  outputLanguage,
}: OutputLanguageFieldProps) {
  const copy = getPreferenceCopy(locale).outputLanguage;
  return (
    <div className="sheet-fact" data-output-language={outputLanguage}>
      <dt>{copy.label}</dt>
      <dd>
        <strong>{getOutputLanguageName(locale, outputLanguage)}</strong>
      </dd>
    </div>
  );
}
