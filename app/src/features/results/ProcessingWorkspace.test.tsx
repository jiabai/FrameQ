// @vitest-environment jsdom

import { fireEvent, render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { createInitialWorkflow, mergeProgressEvent, requestProcessingCancellation, startProcessing } from "../../workflow";
import { initializeI18n } from "../../i18n/i18n";
import { ProcessingWorkspace } from "./ProcessingWorkspace";

afterEach(cleanup);
const initial = () => startProcessing(createInitialWorkflow(), { kind: "url", url: "https://www.bilibili.com/video/BV123?token=private" });

test("uses live progress and safe source copy without preview controls or sample metrics", async () => {
  await initializeI18n("zh-CN");
  const workflow = mergeProgressEvent(initial(), { stage: "video_transcribing", progress: 68, message: { messageCode: "asr.transcribe.running", args: {} } });
  const view = render(<ProcessingWorkspace workflow={workflow} onCancel={() => {}} onRetry={() => {}} onEditSource={() => {}} retryDisabled={false} />);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("68");
  expect(view.container.textContent).toContain("当前流程进度");
  expect(view.container.textContent).toContain("正在本地转写音频");
  expect(view.container.textContent).not.toMatch(/BV123|token=|private|交互预览|05:02|12:00/u);
  expect(view.container.querySelectorAll('.stage-timeline li')).toHaveLength(3);
});

test("cancel confirmation invokes the owner once and waits for actual workflow state", async () => {
  await initializeI18n("zh-CN");
  let cancellations = 0;
  const workflow = initial();
  const onCancel = () => { cancellations += 1; };
  const view = render(<ProcessingWorkspace workflow={workflow} onCancel={onCancel} onRetry={() => {}} onEditSource={() => {}} retryDisabled={false} />);
  fireEvent.click(screen.getByRole("button", { name: "取消处理" }));
  const dialog = screen.getByRole("alertdialog");
  expect(cancellations).toBe(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "取消处理" }));
  expect(cancellations).toBe(1);
  view.rerender(<ProcessingWorkspace workflow={requestProcessingCancellation(workflow)} onCancel={onCancel} onRetry={() => {}} onEditSource={() => {}} retryDisabled={false} />);
  expect(within(screen.getByRole("region", { name: "当前处理任务" })).getByRole("button", { name: "正在取消…" }).hasAttribute("disabled")).toBe(true);
  expect(view.container.textContent).toContain("正在等待处理进程结束");
  expect(view.container.textContent).not.toContain("任务已经停止");
});

test("local errors use the real error presenter and explicit retry action", async () => {
  await initializeI18n("zh-CN");
  let retries = 0;
  const workflow = { ...initial(), stage: "failed" as const, error: { stage: "video_extracting" as const, code: "VIDEO_DOWNLOAD_FAILED", message: "secret raw worker text" } };
  const view = render(<ProcessingWorkspace workflow={workflow} onCancel={() => {}} onRetry={() => { retries += 1; }} onEditSource={() => {}} retryDisabled={false} />);
  expect(view.container.textContent).not.toContain("secret raw worker text");
  expect(screen.getByRole("alert").textContent).toContain("VIDEO_DOWNLOAD_FAILED");
  expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "重新尝试" }));
  expect(retries).toBe(1);
});

test.each(["subtitle.detect.running", "subtitle.detect.found"] as const)("keeps platform subtitle processing truthful for %s", async messageCode => {
  await initializeI18n("zh-CN");
  const workflow = mergeProgressEvent(initial(), { stage: "video_transcribing", progress: 58, message: { messageCode, args: {} } });
  const view = render(<ProcessingWorkspace workflow={workflow} onCancel={() => {}} onRetry={() => {}} onEditSource={() => {}} retryDisabled={false} />);
  expect(view.container.querySelector('.hero-copy p')?.textContent).toContain("字幕");
  expect(view.container.querySelector('.progress-meta')?.textContent).not.toContain("语音识别模型");
  expect(view.container.querySelector('.hero-copy p')?.textContent).not.toContain("识别语音");
});

test.each(["zh-CN", "zh-TW", "en-US"] as const)("renders a complete localized workspace in %s", async locale => {
  await initializeI18n(locale);
  const view = render(<ProcessingWorkspace workflow={initial()} onCancel={() => {}} onRetry={() => {}} onEditSource={() => {}} retryDisabled={false} />);
  expect(view.container.textContent).not.toMatch(/processing\.|undefined|NaN/u);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(view.container.querySelector('.page-heading h1')?.textContent).toBeTruthy();
});
