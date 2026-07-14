export function renderLoginPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FrameQ Login</title>
    <style>
      :root {
        color-scheme: light;
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
        background: #f6f7f8;
        color: #171717;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      main {
        width: min(100%, 420px);
        background: #ffffff;
        border: 1px solid #e2e5e9;
        border-radius: 8px;
        padding: 28px;
        box-shadow: 0 18px 55px rgba(17, 24, 39, 0.09);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 24px;
        line-height: 1.2;
        font-weight: 700;
      }
      p {
        margin: 0 0 20px;
        color: #5f6874;
        line-height: 1.6;
      }
      label {
        display: block;
        margin: 16px 0 8px;
        color: #303845;
        font-size: 14px;
        font-weight: 650;
      }
      input {
        width: 100%;
        height: 44px;
        border: 1px solid #cfd6df;
        border-radius: 8px;
        padding: 0 12px;
        font: inherit;
      }
      input:focus {
        outline: 3px solid rgba(36, 99, 235, 0.18);
        border-color: #2463eb;
      }
      button {
        width: 100%;
        height: 44px;
        margin-top: 16px;
        border: 0;
        border-radius: 8px;
        background: #171717;
        color: #ffffff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      button.secondary {
        background: #eef2f6;
        color: #171717;
      }
      button:disabled {
        cursor: wait;
        opacity: 0.62;
      }
      #status {
        min-height: 22px;
        margin-top: 16px;
        color: #5f6874;
        font-size: 14px;
      }
      #status.error {
        color: #b42318;
      }
      #fallback {
        display: none;
        margin-top: 18px;
        word-break: break-all;
        color: #2463eb;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>FrameQ Login</h1>
      <p>输入邮箱获取验证码，验证成功后会自动回到 FrameQ 客户端。</p>
      <form id="login-form">
        <label for="email">邮箱</label>
        <input id="email" name="email" type="email" autocomplete="email" required />
        <button id="send-code" type="button" class="secondary">获取验证码</button>

        <label for="code">验证码</label>
        <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required />
        <button id="verify-code" type="submit">登录 FrameQ</button>
      </form>
      <div id="status" role="status" aria-live="polite"></div>
      <a id="fallback" href="#">打开 FrameQ 客户端</a>
    </main>
    <script>
      const params = new URLSearchParams(window.location.search);
      const state = params.get("state") || "";
      const redirectUri = params.get("redirect_uri") || "frameq://auth/callback";
      const form = document.getElementById("login-form");
      const emailInput = document.getElementById("email");
      const codeInput = document.getElementById("code");
      const sendButton = document.getElementById("send-code");
      const verifyButton = document.getElementById("verify-code");
      const status = document.getElementById("status");
      const fallback = document.getElementById("fallback");

      function setStatus(message, isError = false) {
        status.textContent = message;
        status.className = isError ? "error" : "";
      }

      function assertDesktopLoginRequest() {
        if (!state || !/^[a-zA-Z0-9._~-]{8,160}$/.test(state)) {
          throw new Error("登录请求已失效，请回到 FrameQ 重新发起登录。");
        }
        if (redirectUri !== "frameq://auth/callback") {
          throw new Error("登录回调地址无效，请回到 FrameQ 重新发起登录。");
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
          throw new Error(data.error || "请求失败，请稍后重试。");
        }
        return data;
      }

      sendButton.addEventListener("click", async () => {
        try {
          assertDesktopLoginRequest();
          if (!emailInput.reportValidity()) {
            return;
          }
          sendButton.disabled = true;
          setStatus("正在发送验证码...");
          await postJson("/auth/email/start", {
            email: emailInput.value,
            state,
          });
          setStatus("验证码已发送，请检查邮箱。开发环境会在服务端终端输出验证码。");
          codeInput.focus();
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "请求失败，请稍后重试。", true);
        } finally {
          sendButton.disabled = false;
        }
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          assertDesktopLoginRequest();
          if (!emailInput.reportValidity() || !codeInput.reportValidity()) {
            return;
          }
          verifyButton.disabled = true;
          setStatus("正在验证...");
          const data = await postJson("/auth/email/verify", {
            email: emailInput.value,
            code: codeInput.value,
            state,
          });
          fallback.href = data.redirect_url;
          fallback.style.display = "block";
          fallback.textContent = "点击此处打开 FrameQ 客户端";
          setStatus("验证成功，正在打开 FrameQ 客户端...");
          window.open(data.redirect_url, "_blank");
          setTimeout(() => {
            setStatus("如果没有自动跳转，请点击下方链接打开 FrameQ 客户端。");
          }, 1500);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "验证失败，请重试。", true);
        } finally {
          verifyButton.disabled = false;
        }
      });

      try {
        assertDesktopLoginRequest();
      } catch (error) {
        form.querySelectorAll("input, button").forEach((node) => {
          node.disabled = true;
        });
        setStatus(error instanceof Error ? error.message : "登录请求无效。", true);
      }
    </script>
  </body>
</html>`;
}
