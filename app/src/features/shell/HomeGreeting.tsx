import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FrameQMark } from "./FrameQMark";
import { getGreetingPeriod } from "./greetingTime";

export function HomeGreeting({ email }: { email: string | null }) {
  const { t } = useTranslation("shell");
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const interval = window.setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  const name = email?.split("@")[0] || t("account.guest");
  return (
    <h1 className="shell-home-greeting">
      <FrameQMark className="shell-greeting-mark" />
      <span>{t(`home.${getGreetingPeriod(hour)}`, { name })}</span>
    </h1>
  );
}
