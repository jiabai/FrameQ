# EasyDownload MITM/CA/Admin Reference

## Purpose

This note records how EasyDownload implements the chain of `local CA generation -> PEM persistence -> OS trust store install -> Windows UAC elevation -> macOS admin password prompt -> Linux trust anchor drop`. It is preserved as engineering reference only.

The current FrameQ product boundary in [docs/SECURITY.md 2026-06-26 Public Link Fallback Safety Boundary](../../SECURITY.md) explicitly forbids migrating this chain into the product default path:

> FrameQ must not migrate EasyDownload's WeChat MITM, certificate authority installation, system proxy changes, or administrator-elevation behavior.

This reference must therefore be read as **technical reconnaissance for a hypothetical future decision, not as a recipe to implement**. Anyone reading this doc should be aware that adopting any of the behaviors below in the FrameQ product path would require a coordinated amendment of [docs/SECURITY.md](../../SECURITY.md), [AGENTS.md](../../AGENTS.md) core beliefs, and at least one product spec. No such amendment is planned in the active ExecPlan set.

## Source

- Local reference project: `lib-external/EasyDownload`
- License: MIT, see `lib-external/EasyDownload/LICENSE`
- Primary files reviewed:
  - `lib-external/EasyDownload/internal/proxy/cert.go` — core CA generation and PEM persistence
  - `lib-external/EasyDownload/internal/proxy/cert_windows.go` — Windows CryptoAPI install/uninstall
  - `lib-external/EasyDownload/internal/proxy/cert_darwin.go` — macOS `security` toolchain
  - `lib-external/EasyDownload/internal/proxy/cert_stub.go` — non-Windows non-Darwin placeholder
  - `lib-external/EasyDownload/internal/proxy/darwin_exec.go` — macOS privileged helper used for install/uninstall
  - `lib-external/EasyDownload/internal/utils/admin_windows.go` — UAC elevation via `ShellExecuteW`
  - `lib-external/EasyDownload/internal/utils/admin_other.go` — POSIX `geteuid` check, no real elevation helper
  - `lib-external/EasyDownload/internal/proxy/server.go` — `goproxy`-based MITM HTTP/HTTPS server that consumes the CA

## Why This Reference Exists

FrameQ is a Tauri 2 + Python desktop client. EasyDownload is a Go + Wails project that solves a different product problem (general media downloader, including WeChat Channels via MITM). Three concerns motivate keeping a written record of EasyDownload's MITM/CA/admin chain even though the behavior is out of scope:

1. The pattern is well-trodden and a future FrameQ maintainer may be tempted to copy it. Documenting the actual risks and the OS-level blast radius prevents silent reintroduction.
2. Some components (PEM file layout, key generation, system CA verification query) are useful even for non-MITM purposes such as self-hosted mTLS or local dev CAs. The reference is careful to mark which parts are MITM-coupled and which are not.
3. Linux support is incomplete in EasyDownload (only a stub file). FrameQ's Tauri 2 + Python stack would have to design this from scratch and would benefit from a written target.

## 1. CA 证书生成

EasyDownload generates a self-signed RSA CA in-process, with no external CA, no CSR submission, and no payment.

- Algorithm: Go standard library `crypto/rsa` 2048-bit key, `crypto/x509.CreateCertificate` self-sign.
- Subject: `O=EasyDownload`, `C=CN`, `CN=EasyDownload Root CA`.
- Validity: `NotAfter = NotBefore + 10 years`.
- Key usage: `KeyUsageCertSign | KeyUsageDigitalSignature | KeyUsageCRLSign`.
- Extended key usage: `ServerAuth | ClientAuth`.
- `IsCA: true`, `BasicConstraintsValid: true`.
- Source: [`cert.go` `GenerateCACert`](file:///d:/Github/FrameQ/lib-external/EasyDownload/internal/proxy/cert.go#L43-L103).

EasyDownload does not implement certificate pinning bypass or per-host scoping. The CA can sign certificates for any hostname, which is the reason it must never be installed into the system trust store for the FrameQ product.

## 2. 私钥/证书落盘

The CA key and certificate are written as two PEM files in a private directory:

- `ca.crt` — `BEGIN CERTIFICATE` block, DER bytes from `x509.CreateCertificate`.
- `ca.key` — `BEGIN RSA PRIVATE KEY` block, PKCS#1 from `x509.MarshalPKCS1PrivateKey`.
- Default dir: configured per `CertManager` instance (e.g. under app-local data, not under the install path).
- Permissions: 0o755 on the directory, no explicit file permission tightening on Linux/macOS.
- `CertExists()` returns true only if both files are present and readable.
- Source: [`cert.go` `NewCertManager` / `EnsureCertDir` / `CertExists` / `GenerateCACert`](file:///d:/Github/FrameQ/lib-external/EasyDownload/internal/proxy/cert.go#L11-L17) and [lines around the file writes](file:///d:/Github/FrameQ/lib-external/EasyDownload/internal/proxy/cert.go#L103-L141).

FrameQ-relevance beyond MITM: the PEM layout is identical to what `cryptography` and `pyOpenSSL` produce. If FrameQ ever stores a self-generated CA for a non-MITM purpose (e.g., signing a local mTLS pair for a self-hosted AI service), this layout is a reasonable starting point. The key handling must still be tightened (0o600 on the key, parent dir 0o700, never written to a network share).

## 3. Windows CA 安装

EasyDownload uses the Windows CryptoAPI directly through `golang.org/x/sys/windows`:

- `IsCertInstalled` — opens `LocalMachine\ROOT` first, then falls back to `CurrentUser\ROOT`. Searches by subject CN (`EasyDownload Root CA`) and bytewise-encodes the match against `cert.Raw`.
- `InstallCert` — opens `LocalMachine\ROOT` with `CERT_SYSTEM_STORE_LOCAL_MACHINE`, builds a `CertCreateCertificateContext` from the DER bytes, and calls `CertAddCertificateContextToStore` with `CERT_STORE_ADD_REPLACE_EXISTING`.
- `UninstallCert` — same store path; iterates matches and calls `CertDeleteCertificateFromStore`.
- Source: [`cert_windows.go`](file:///d:/Github/FrameQ/lib-external/EasyDownload/internal/proxy/cert_windows.go).

Properties that matter for the FrameQ security review:

- The store is `LocalMachine\ROOT`. On a multi-user Windows machine, the CA is trusted by **every** user account, not just the user who ran the installer.
- Removing the app does not remove the CA. A `UninstallCert` only runs if the user explicitly triggers an uninstall flow that calls it; the FrameQ installer or uninstaller must mirror this on every supported Windows version.
- The CryptoAPI path requires admin. EasyDownload does not attempt the lower-trust `CurrentUser\ROOT` for the install; install always elevates.

## 4. Windows 管理员提权

EasyDownload detects and requests UAC elevation as a separate utility:

- `IsAdmin()` opens the current process token, queries `TokenElevation` (information class 20), and returns `TokenIsElevated != 0`. This is the correct API for "is UAC active" rather than "is the user in the Administrators group".
- `RestartAsAdmin()` uses `Shell32!ShellExecuteW` with the `runas` verb to relaunch the current executable. It uses the executable directory as the working directory to reduce DLL hijacking risk, and parses `os.Args[1:]` to preserve arguments.
- `ShellExecuteW` return codes `<= 32` are translated to localized error messages (code 5 = access denied or user cancelled UAC).
- `CanRestartAsAdmin()` is hardcoded `true` on Windows.
- Source: [`admin_windows.go`](file:///d:/Github/FrameQ/lib-external/EasyDownload/internal/utils/admin_windows.go).

For the FrameQ product path the safer pattern is: never run the GUI as admin; spawn a dedicated helper subprocess that takes a single, narrow CLI argument (e.g. `--install-frameq-ca <path>`), prompts UAC once via `ShellExecuteW`, and exits. EasyDownload's `RestartAsAdmin` relaunches the whole application, which is broader than necessary for CA install.

## 5. macOS CA 安装

EasyDownload uses the `security` CLI rather than a native API:

- `IsCertInstalled()` — runs `/usr/bin/security verify-cert -c <path> -p basic -l -L -q`. If the CA is not in any keychain the command fails.
- `InstallCert()` — if not already installed, runs `/usr/bin/security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain <path>` with **administrator privileges** via the helper described below.
- `UninstallCert()` — `/usr/bin/security remove-trusted-cert -d <path>` with the same helper.
- Source: [`cert_darwin.go`](file:///d:/Github/FrameQ/lib-external/EasyDownload/internal/proxy/cert_darwin.go).

The privileged helper (`darwin_exec.go`):

- If `os.Geteuid() == 0`, runs `/bin/sh -c <script>` directly.
- Otherwise, wraps the script in AppleScript and runs `osascript -e 'do shell script "<script>" with administrator privileges'`. This pops the standard macOS admin password dialog. The helper detects `user canceled` and surfaces a structured error.
- Source: [`darwin_exec.go`](file:///d:/Github/FrameQ/lib-external/EasyDownload/internal/proxy/darwin_exec.go).

macOS-specific concerns for the FrameQ security review:

- The System keychain write affects every user on the machine. There is no per-user scope for a `trustRoot` install.
- The `osascript` prompt asks for the user's **password**, not just Touch ID, so the install cannot be silently re-prompted via biometrics.
- `security` does not provide an automatic rollback; the uninstall path must be invoked from the app's own uninstall flow.

## 6. Linux CA 安装

EasyDownload ships only a stub for non-Windows, non-Darwin platforms:

```text
//go:build !windows && !darwin

// InstallCert is not implemented outside Windows yet.
func (cm *CertManager) InstallCert() error {
    return fmt.Errorf("certificate installation is not supported on this platform yet")
}
```

Source: [`cert_stub.go`](file:///d:/Github/FrameQ/lib-external/EasyDownload/internal/proxy/cert_stub.go).

The non-Windows admin helper is also a stub:

```text
//go:build !windows

// CanRestartAsAdmin returns false on non-Windows platforms.
func CanRestartAsAdmin() bool {
    return false
}
```

Source: [`admin_other.go`](file:///d:/Github/FrameQ/lib-external/EasyDownload/internal/utils/admin_other.go).

A real Linux port would have to cover the major distribution families because there is no single shared trust store API:

| Family | Drop path | Activation |
|---|---|---|
| Debian / Ubuntu / Mint | `/usr/local/share/ca-certificates/frameq.crt` | `update-ca-certificates` |
| RHEL / Fedora / CentOS Stream | `/etc/pki/ca-trust/source/anchors/frameq.crt` | `update-ca-trust` |
| Arch / Manjaro | `/etc/ca-certificates/trust-source/anchors/frameq.crt` | `trust extract-compat` |
| OpenSUSE Leap / Tumbleweed | `/etc/pki/trust/anchors/frameq.crt` | `update-ca-certificates` |
| Alpine | `/usr/local/share/ca-certificates/frameq.crt` | `update-ca-certificates` |
| NixOS | nix module, not drop-path | nix rebuild |

All of these require root. The FrameQ port would have to detect the family at install time (`/etc/os-release` + path probing) and document which families are supported. The default FrameQ product plan does not support Linux desktop for the MVP, so this is only a hypothetical design point.

## Python Equivalents (Tauri 2 + Python)

The FrameQ worker is Python. If a future decision ever authorized a non-MITM use of this chain, the Python equivalent of each component is:

| Concern | Python tool | Notes |
|---|---|---|
| CA generation | `cryptography.x509.CertificateBuilder` | Same RSA-2048 / 10-year / `BasicConstraints(ca=True)` parameters as EasyDownload |
| PEM persistence | `cryptography.hazmat.primitives.serialization` + `pathlib` | Enforce `0o600` on the key file in FrameQ (EasyDownload does not) |
| Windows CA install | `subprocess` calling `certutil -addstore -f Root <path>` **or** `win32crypt` / `ctypes` wrapping `CertAddCertificateContextToStore` | `certutil` is the lowest-dependency option; `win32crypt` is more robust |
| Windows admin elevation | `subprocess` with `ShellExecuteW` via `ctypes.windll.shell32.ShellExecuteW(..., "runas", ...)` | FrameQ should elevate only a narrow helper subprocess, not the GUI |
| Windows UAC detection | `ctypes` calling `GetTokenInformation(TokenElevation)` | Same logic as `admin_windows.go IsAdmin` |
| macOS CA install | `subprocess` calling `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain <path>` | Same `security` toolchain as EasyDownload |
| macOS admin elevation | `subprocess` calling `osascript -e 'do shell script "..." with administrator privileges'` | Same AppleScript wrapper as `darwin_exec.go` |
| macOS verification | `subprocess` calling `security verify-cert -c <path> -p basic -l -L -q` | Same command as `cert_darwin.go IsCertInstalled` |
| Linux family detection | `pathlib.Path("/etc/os-release").read_text()` parsed as key=value | Lightweight; do not shell out to `lsb_release` |
| Linux CA install | `subprocess` of the per-family drop path + `update-ca-certificates` / `update-ca-trust` / `trust extract-compat` | Root required; FrameQ would also need to document the supported family list |
| Linux CA uninstall | Symmetric: remove the file, run the activation command | Must also remove from any NSS / Firefox user DBs if user opted in |

These are pointers, not a recommendation to implement. The product boundary in [docs/SECURITY.md](../../SECURITY.md) still applies.

## Security and Compliance Boundaries

- The FrameQ product path must not add a CA to the OS trust store, must not set a system-wide proxy, and must not request admin elevation. See [docs/SECURITY.md 2026-06-26 Public Link Fallback Safety Boundary](../../SECURITY.md) and [docs/references/easydownload-transcription-migration.md](file:///d:/Github/FrameQ/docs/references/easydownload-transcription-migration.md) (Do not migrate list).
- Even if a future use case is justified (for example, FrameQ hosting a self-signed mTLS service for an on-device AI component), the CA must be **per-user scoped** and never installed into `LocalMachine\ROOT`, `/Library/Keychains/System.keychain`, or the system-wide `/etc/ssl/certs` family. The MITM pattern is not the only pattern that touches CA libraries; per-user or per-app trust is materially safer.
- The MITM proxy itself ([`server.go`](file:///d:/Github/FrameQ/lib-external/EasyDownload/internal/proxy/server.go) using `goproxy`) is out of scope. The FrameQ worker must not include or wrap a general-purpose CONNECT-decrypting proxy.
- Logs and history must never include the CA private key, the public CA certificate, system trust store paths, or admin elevation prompts. This extends the existing [docs/SECURITY.md](../SECURITY.md) "Logs and history" rules.
- Distribution impact: a public installer that asks the user to install a system CA will be flagged by Windows SmartScreen, common EDR products, and some app store review pipelines. The FrameQ installer plan in [docs/design-docs/2026-06-17-installer-distribution-plan.md](../design-docs/2026-06-17-installer-distribution-plan.md) currently assumes no such prompt; reintroducing one would invalidate the installer trust model.

## Implementation Pointers (Hypothetical Only)

If a future FrameQ ExecPlan ever adds a narrow, non-MITM use of self-signed CAs, the suggested code locations would be:

- `worker/frameq_worker/ca/__init__.py` — package entry point guarded by a config flag and the security boundary check.
- `worker/frameq_worker/ca/generator.py` — `cryptography`-based CA generation, modeled after `cert.go`.
- `worker/frameq_worker/ca/store_pem.py` — PEM persistence with 0o600/0o700 permissions.
- `worker/frameq_worker/ca/install_windows.py` — `certutil` wrapper.
- `worker/frameq_worker/ca/install_darwin.py` — `security` wrapper.
- `worker/frameq_worker/ca/install_linux.py` — family detection + per-family drop.
- `worker/frameq_worker/ca/elevate_windows.py` — UAC helper using `ctypes`.
- `worker/frameq_worker/ca/elevate_darwin.py` — `osascript` helper.

Until the [docs/SECURITY.md](../../SECURITY.md) boundary is amended for a specific named use case, none of these files should be added to the worker tree.
