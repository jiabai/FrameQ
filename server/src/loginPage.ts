import {
  buildClientStrings,
  langSwitcherStyles,
  renderLangSwitcher,
  type Locale,
  t,
} from "./i18n.js";
import { basePageCss, designTokenCss } from "./designTokens.js";
import { brandChromeCss, renderFrameHeader } from "./pageChrome.js";

export function renderLoginPage(locale: Locale = "zh-CN"): string {
  const i18n = buildClientStrings(locale);
  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${t(locale, "login.title")}</title>
    <style>
      ${langSwitcherStyles()}
      ${designTokenCss()}
      ${basePageCss()}
      ${brandChromeCss()}
      body {
        display: grid;
        place-items: center;
        padding: 24px;
      }
      main {
        width: min(100%, 420px);
        background: var(--fq-surface);
        border: 1px solid var(--fq-border);
        border-radius: var(--fq-radius);
        padding: 28px;
        box-shadow: var(--fq-shadow-raised);
      }
      .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px 12px;
        margin-bottom: 8px;
      }
      .page-header h1 {
        font-size: 24px;
        line-height: 1.2;
        font-weight: 700;
      }
      p {
        margin: 0 0 20px;
        color: var(--fq-text-soft);
        line-height: 1.6;
      }
      label {
        display: block;
        margin: 16px 0 8px;
        color: var(--fq-text);
        font-size: 14px;
        font-weight: 600;
      }
      button {
        width: 100%;
        min-height: 42px;
        margin-top: 16px;
        border-radius: var(--fq-radius);
        background: var(--fq-primary);
        color: var(--fq-text-on-primary);
        font-weight: 700;
      }
      button:hover {
        background: var(--fq-primary-pressed);
      }
      button.secondary {
        background: var(--fq-surface-soft);
        color: var(--fq-text);
      }
      button.secondary:hover {
        background: var(--fq-surface);
      }
      button:disabled {
        cursor: wait;
        opacity: 0.6;
      }
      #status {
        min-height: 22px;
        margin-top: 16px;
        color: var(--fq-text-soft);
        font-size: 14px;
      }
      #status.error {
        color: var(--fq-danger);
      }
      #fallback {
        display: none;
        margin-top: 18px;
        word-break: break-all;
        color: var(--fq-link);
        font-size: 14px;
      }
      #success-panel {
        display: none;
        text-align: center;
        padding: 8px 0 4px;
      }
      #success-panel h2 {
        margin: 0 0 12px;
        font-size: 22px;
        font-weight: 700;
        color: var(--fq-success);
      }
      #success-panel p {
        margin: 0 0 16px;
        color: var(--fq-text-soft);
        line-height: 1.6;
      }
      #success-panel a.dashboard-link {
        display: inline-block;
        padding: 10px 20px;
        border: 1px solid var(--fq-primary);
        border-radius: var(--fq-radius);
        color: var(--fq-primary);
        text-decoration: none;
        font-weight: 600;
        font-size: 14px;
      }
      #success-panel a.dashboard-link:hover {
        background: var(--fq-primary);
        color: var(--fq-text-on-primary);
      }
    </style>
  </head>
  <body>
    <main>
      ${renderFrameHeader({
        wrapperClass: "page-header",
        title: t(locale, "login.title"),
        rightHtml: renderLangSwitcher(locale),
      })}
      <p id="intro">${t(locale, "login.intro.desktop")}</p>
      <form id="login-form">
        <label for="email">${t(locale, "login.email")}</label>
        <input id="email" name="email" type="email" autocomplete="email" required />
        <button id="send-code" type="button" class="secondary">${t(locale, "login.send_code")}</button>

        <label for="code">${t(locale, "login.code")}</label>
        <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required />
        <button id="verify-code" type="submit">${t(locale, "login.verify_desktop")}</button>
      </form>
      <div id="status" role="status" aria-live="polite"></div>
      <a id="fallback" href="#">${t(locale, "login.fallback")}</a>
      <div id="success-panel">
        <h2>${t(locale, "login.success_title")}</h2>
        <p>${t(locale, "login.success_body")}</p>
        <a class="dashboard-link" href="/dashboard">${t(locale, "login.success_dashboard")}</a>
      </div>
    </main>
    <script>
      const i18n = ${JSON.stringify(i18n)};
      const params = new URLSearchParams(window.location.search);
      const desktopParam = params.get("desktop");
      const redirectUri = params.get("redirect_uri") || "frameq://auth/callback";
      // Desktop mode is the OAuth-style deep-link handshake launched by the desktop client.
      // Everything else (including a plain browser visit to /login) is web mode and lands on /dashboard.
      const desktopMode = desktopParam === "1" && redirectUri === "frameq://auth/callback";
      const state = desktopMode
        ? (params.get("state") || "")
        : (params.get("state") || ("web-" + crypto.randomUUID()));
      const startUrl = desktopMode ? "/auth/email/start" : "/user/auth/email/start";
      const verifyUrl = desktopMode ? "/auth/email/verify" : "/user/auth/email/verify";
      const verifyButtonLabel = desktopMode ? i18n["login.verify_desktop"] : i18n["login.verify_web"];
      const introText = desktopMode
        ? i18n["login.intro.desktop"]
        : i18n["login.intro.web"];
      const form = document.getElementById("login-form");
      const emailInput = document.getElementById("email");
      const codeInput = document.getElementById("code");
      const sendButton = document.getElementById("send-code");
      const verifyButton = document.getElementById("verify-code");
      const status = document.getElementById("status");
      const fallback = document.getElementById("fallback");
      const intro = document.getElementById("intro");
      const successPanel = document.getElementById("success-panel");

      verifyButton.textContent = verifyButtonLabel;
      intro.textContent = introText;

      function setStatus(message, isError = false) {
        status.textContent = message;
        status.className = isError ? "error" : "";
      }

      function assertDesktopLoginRequest() {
        if (!state || !/^[a-zA-Z0-9._~-]{8,160}$/.test(state)) {
          throw new Error(i18n["login.error_state_desktop"]);
        }
        if (redirectUri !== "frameq://auth/callback") {
          throw new Error(i18n["login.error_callback"]);
        }
      }

      function assertLoginRequest() {
        if (!state || !/^[a-zA-Z0-9._~-]{8,160}$/.test(state)) {
          throw new Error(i18n["login.error_state_web"]);
        }
      }

      async function postJson(url, payload) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || i18n["login.error_request"]);
        }
        return data;
      }

      sendButton.addEventListener("click", async () => {
        try {
          if (desktopMode) {
            assertDesktopLoginRequest();
          } else {
            assertLoginRequest();
          }
          if (!emailInput.reportValidity()) {
            return;
          }
          sendButton.disabled = true;
          setStatus(i18n["login.status_sending"]);
          await postJson(startUrl, {
            email: emailInput.value,
            state,
          });
          setStatus(i18n["login.status_sent"]);
          codeInput.focus();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : i18n["login.error_request"], true);
        } finally {
          sendButton.disabled = false;
        }
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          if (desktopMode) {
            assertDesktopLoginRequest();
          } else {
            assertLoginRequest();
          }
          if (!emailInput.reportValidity() || !codeInput.reportValidity()) {
            return;
          }
          verifyButton.disabled = true;
          setStatus(i18n["login.status_verifying"]);
          const data = await postJson(verifyUrl, {
            email: emailInput.value,
            code: codeInput.value,
            state,
          });
          if (desktopMode) {
            // Desktop mode: show success panel and trigger the deep link in the background.
            // The browser stays on this page because frameq:// is a custom scheme
            // the browser cannot navigate to as a document; it hands it off to the OS.
            form.style.display = "none";
            intro.style.display = "none";
            fallback.style.display = "none";
            status.style.display = "none";
            successPanel.style.display = "block";
            try {
              setTimeout(() => {
                window.location.href = data.redirect_url;
              }, 200);
            } catch {
              // Navigation to a custom scheme may throw in some browsers; ignore.
            }
          } else {
            setStatus(i18n["login.status_verified_web"]);
            window.location.href = data.redirect_url;
          }
        } catch (error) {
          setStatus(error instanceof Error ? error.message : i18n["login.error_verify"], true);
        } finally {
          verifyButton.disabled = false;
        }
      });

      try {
        if (desktopMode) {
          assertDesktopLoginRequest();
        } else {
          assertLoginRequest();
        }
      } catch (error) {
        form.querySelectorAll("input, button").forEach((node) => {
          node.disabled = true;
        });
        setStatus(error instanceof Error ? error.message : i18n["login.error_invalid"], true);
      }
    </script>
  </body>
</html>`;
}
