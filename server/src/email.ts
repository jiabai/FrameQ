import nodemailer from "nodemailer";
import type { RuntimeEnvironment, SmtpConfig } from "./runtimeConfig.js";

type SmtpTransportOptions = {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
};

type LoginCodeMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

type MailTransport = {
  sendMail(message: LoginCodeMessage): Promise<unknown>;
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
}): LoginCodeMessage {
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
