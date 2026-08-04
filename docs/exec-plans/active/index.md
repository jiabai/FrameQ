# Active Exec Plans

| File | Focus |
|------|-------|
| `2026-08-05-inspiration-profile-generation-preference-boundary-plan.md` | Narrow Inspiration Profile to six stable context fields, make per-run preferences the sole style/avoid owner, atomically migrate v1 app-local preferences to schema v2, and preserve historical task snapshots. |
| `2026-08-04-server-page-i18n-plan.md` | Add a per-page language switcher to `/login`, `/dashboard`, `/admin/login`, and `/admin` toggling between Simplified Chinese (default) and English via a non-sensitive `lang` cookie; new `server/src/i18n.ts` module. Implementation landed; focused i18n tests and integration tests are tracked as open tasks. Version not assigned. |
| `2026-08-03-web-user-dashboard-plan.md` | Add a per-user Web dashboard at `/dashboard` with email-OTP cookie-session login (reusing `desktop_login` OTP and the Admin Web session model); desktop deep-link login unchanged. First cut ships account-and-quota content only. Version not assigned (post-v0.3.0 iteration). |
| `2026-08-03-v0.3.0-desktop-feature-release-plan.md` | Prepare, tag, and publish the v0.3.0 desktop feature release (local-media import, selectable ONNX ASR + on-demand download, streaming ONNX VAD fail-closed, transcript dissection, bundled ONNX runtime integrity). |
