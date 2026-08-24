import nodemailer from "nodemailer";
import type { RuntimeEnvironment, SmtpConfig } from "./runtimeConfig.js";
import type {
  ActivationCodeEmailSender,
  ActivationEmailLocale,
  SendActivationCodeInput,
} from "./selfServiceActivation.js";

type SmtpTransportOptions = {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
};

type MailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

type MailTransport = {
  sendMail(message: MailMessage): Promise<unknown>;
};

type MailTransportFactory = (options: SmtpTransportOptions) => MailTransport;

type DevelopmentOtpOutput = {
  warn(message: string): void;
  write(email: string, code: string): void;
};

export type OtpSenderConfig = Readonly<{
  environment: RuntimeEnvironment;
  smtp: SmtpConfig | null;
  allowConsoleOtp: boolean;
}>;

const ACTIVATION_EMAIL_UNAVAILABLE_MESSAGE = "Activation email delivery is unavailable.";
const ACTIVATION_EMAIL_FAILED_MESSAGE = "Activation email delivery failed.";

const defaultDevelopmentOutput: DevelopmentOtpOutput = {
  warn(message) {
    console.warn(message);
  },
  write(email, code) {
    console.warn(`[frameq-server] DEVELOPMENT OTP for ${email}: ${code}`);
  },
};

export function createOtpSender(
  config: OtpSenderConfig,
  createTransport: MailTransportFactory = (options) => nodemailer.createTransport(options),
  developmentOutput: DevelopmentOtpOutput = defaultDevelopmentOutput,
) {
  if (config.smtp) {
    const smtp = config.smtp;
    const transporter = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    return async (email: string, code: string) => {
      await transporter.sendMail(buildLoginCodeMessage({ from: smtp.from, to: email, code }));
    };
  }

  if (config.environment === "production") {
    throw new Error("SMTP configuration is required in production.");
  }
  if (!config.allowConsoleOtp) {
    throw new Error("FRAMEQ_ALLOW_CONSOLE_OTP=1 is required when SMTP is absent.");
  }

  developmentOutput.warn(
    "[frameq-server] DEVELOPMENT ONLY: console OTP delivery is enabled; never use this mode in production.",
  );
  return async (email: string, code: string) => {
    developmentOutput.write(email, code);
  };
}

export function buildLoginCodeMessage(input: {
  from: string;
  to: string;
  code: string;
}): MailMessage {
  return {
    from: input.from,
    to: input.to,
    subject: "FrameQ login code",
    text: [
      `Your FrameQ login code is: ${input.code}`,
      "",
      "This code expires in 10 minutes. If you did not request it, you can ignore this email.",
    ].join("\n"),
    html: [
      "<!doctype html>",
      '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#171717">',
      "<h2>FrameQ login code</h2>",
      "<p>Your verification code is:</p>",
      `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${input.code}</p>`,
      "<p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>",
      "</div>",
    ].join(""),
  };
}

export function createActivationCodeSender(
  config: OtpSenderConfig,
  createTransport: MailTransportFactory = (options) => nodemailer.createTransport(options),
): ActivationCodeEmailSender {
  const smtp = config.smtp;
  if (!isCompleteSmtpConfig(smtp)) {
    throw new Error(ACTIVATION_EMAIL_UNAVAILABLE_MESSAGE);
  }

  const transporter = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  return {
    async sendActivationCode(input: SendActivationCodeInput): Promise<void> {
      try {
        await transporter.sendMail(buildActivationCodeMessage({ from: smtp.from, input }));
      } catch (error) {
        throw new Error(ACTIVATION_EMAIL_FAILED_MESSAGE, { cause: error });
      }
    },
  };
}

function buildActivationCodeMessage(options: {
  from: string;
  input: SendActivationCodeInput;
}): MailMessage {
  const deadline = formatActivationDeadline(options.input.redeemBy);
  const copy = ACTIVATION_EMAIL_COPY[options.input.locale];
  const escapedEmail = escapeHtml(options.input.email);
  const escapedCode = escapeHtml(options.input.code);
  const escapedDeadline = escapeHtml(deadline);
  const entitlementLine = formatEntitlementLine(
    options.input.entitlementDays,
    options.input.locale,
  );

  return {
    from: options.from,
    to: options.input.email,
    subject: copy.subject,
    text: [
      copy.heading,
      "",
      `${copy.codeLabel}: ${options.input.code}`,
      `${copy.emailLabel}: ${options.input.email}`,
      `${copy.deadlineLabel}: ${deadline}`,
      entitlementLine,
      `${options.input.llmCredits} AI Credits`,
      "",
      copy.accountNotice,
    ].join("\n"),
    html: [
      "<!doctype html>",
      '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#171717">',
      `<h2>${copy.heading}</h2>`,
      `<p>${copy.intro}</p>`,
      `<p><strong>${copy.codeLabel}:</strong> <span style="font-size:20px;font-weight:700;letter-spacing:1px">${escapedCode}</span></p>`,
      `<p><strong>${copy.emailLabel}:</strong> ${escapedEmail}</p>`,
      `<p><strong>${copy.deadlineLabel}:</strong> ${escapedDeadline}</p>`,
      `<p><strong>${entitlementLine}</strong></p>`,
      `<p><strong>${options.input.llmCredits} AI Credits</strong></p>`,
      `<p>${copy.accountNotice}</p>`,
      "</div>",
    ].join(""),
  };
}

function formatActivationDeadline(redeemBy: Date): string {
  return redeemBy.toISOString();
}

function formatEntitlementLine(days: number, locale: ActivationEmailLocale): string {
  if (locale === "en-US") {
    return `${days}-day entitlement`;
  }
  return `${days} ${ACTIVATION_EMAIL_COPY[locale].entitlementLabel}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isCompleteSmtpConfig(smtp: SmtpConfig | null): smtp is SmtpConfig {
  return Boolean(
    smtp &&
      smtp.host.trim() &&
      smtp.user.trim() &&
      smtp.pass.trim() &&
      smtp.from.trim() &&
      Number.isInteger(smtp.port) &&
      smtp.port > 0,
  );
}

const ACTIVATION_EMAIL_COPY: Record<
  ActivationEmailLocale,
  {
    subject: string;
    heading: string;
    intro: string;
    codeLabel: string;
    emailLabel: string;
    deadlineLabel: string;
    entitlementLabel: string;
    accountNotice: string;
  }
> = {
  "zh-CN": {
    subject: "FrameQ 激活码",
    heading: "FrameQ 激活码",
    intro: "请使用以下信息完成 FrameQ 激活。",
    codeLabel: "完整激活码",
    emailLabel: "绑定邮箱",
    deadlineLabel: "兑换截止时间",
    entitlementLabel: "天权益",
    accountNotice: "仅限当前账号使用，请勿转发。",
  },
  "zh-TW": {
    subject: "FrameQ 啟用碼",
    heading: "FrameQ 啟用碼",
    intro: "請使用以下資訊完成 FrameQ 啟用。",
    codeLabel: "完整啟用碼",
    emailLabel: "綁定信箱",
    deadlineLabel: "兌換截止時間",
    entitlementLabel: "天權益",
    accountNotice: "僅限目前帳號使用，請勿轉寄。",
  },
  "en-US": {
    subject: "Your FrameQ activation code",
    heading: "FrameQ activation code",
    intro: "Use the details below to activate FrameQ.",
    codeLabel: "Full activation code",
    emailLabel: "Bound email",
    deadlineLabel: "Redeem by",
    entitlementLabel: "-day entitlement",
    accountNotice: "This email is only for the current account. Do not forward it.",
  },
};
