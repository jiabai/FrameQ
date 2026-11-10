import { appI18n } from "./i18n";
import type { SupportedLocale } from "./locale";

export type UiMessageArgs = Readonly<Record<string, string | number>>;

export type UiMessage = Readonly<{
  messageCode: string;
  args?: UiMessageArgs;
}>;

const INTERNAL_MESSAGE_CODE_PATTERN =
  /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)+$/;

type DynamicI18n = {
  exists(key: string, options: { lng: string; ns: string }): boolean;
  getFixedT(
    locale: string,
    namespace: string,
  ): (key: string, args?: UiMessageArgs) => unknown;
};

export function uiMessage(
  messageCode: string,
  args?: UiMessageArgs,
): UiMessage {
  return args === undefined ? { messageCode } : { messageCode, args };
}

export function renderUiMessage(
  locale: SupportedLocale,
  message: UiMessage | null,
): string {
  if (
    !message ||
    !INTERNAL_MESSAGE_CODE_PATTERN.test(message.messageCode)
  ) {
    return "";
  }

  const separator = message.messageCode.indexOf(".");
  const namespace = message.messageCode.slice(0, separator);
  const key = message.messageCode.slice(separator + 1);
  const dynamicI18n = appI18n as unknown as DynamicI18n;
  if (!dynamicI18n.exists(key, { lng: locale, ns: namespace })) {
    return "";
  }

  return String(
    dynamicI18n.getFixedT(locale, namespace)(key, message.args ?? {}),
  );
}

/** Maps the fixed worker probe error codes to localized, content-free UI messages. */
export function llmProbeMessage(errorCode: string | null): UiMessage {
  switch (errorCode) {
    case "LLM_PROBE_INVALID_REQUEST":
      return uiMessage("errors.llmProbe.invalidRequest");
    case "LLM_PROBE_NETWORK_ERROR":
      return uiMessage("errors.llmProbe.networkError");
    case "LLM_PROBE_AUTH_FAILED":
      return uiMessage("errors.llmProbe.authFailed");
    case "LLM_PROBE_MODEL_NOT_FOUND":
      return uiMessage("errors.llmProbe.modelNotFound");
    case "LLM_PROBE_TIMEOUT":
      return uiMessage("errors.llmProbe.timeout");
    case "LLM_PROBE_RATE_LIMITED":
      return uiMessage("errors.llmProbe.rateLimited");
    case "LLM_PROBE_INVALID_RESPONSE":
      return uiMessage("errors.llmProbe.invalidResponse");
    case "LLM_PROBE_UNEXPECTED_ERROR":
      return uiMessage("errors.llmProbe.unexpectedError");
    default:
      return uiMessage("errors.llmProbe.unexpectedError");
  }
}
