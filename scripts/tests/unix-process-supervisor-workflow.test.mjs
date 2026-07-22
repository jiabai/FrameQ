import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = resolve(
  repositoryRoot,
  ".github/workflows/unix-process-supervisor.yml",
);
const supervisorPath = resolve(
  repositoryRoot,
  "app/src-tauri/src/worker_runtime/supervisor.rs",
);
const runnerPath = resolve(
  repositoryRoot,
  "app/src-tauri/src/worker_runtime/runner.rs",
);

test("runs the Unix ProcessSupervisor fixture on macOS without unsupported Linux or privileged product integrations", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
  assert.match(workflow, /runs-on:\s*macos-latest/);
  assert.match(workflow, /timeout-minutes:\s*30/);
  assert.match(workflow, /uses:\s*actions\/checkout@v5/);
  assert.doesNotMatch(workflow, /actions\/checkout@v4|node20/i);
  assert.match(workflow, /uses:\s*dtolnay\/rust-toolchain@stable/);
  assert.match(
    workflow,
    /run:\s*cargo test --manifest-path app\/src-tauri\/Cargo\.toml\s*(?:\r?\n|$)/,
  );

  assert.doesNotMatch(workflow, /pull_request_target:/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /ubuntu|apt-get|libwebkit/i);
  assert.doesNotMatch(workflow, /tauri-action|gh release|WECHAT|LLM|yt-dlp|ffmpeg/i);
});

test("the hosted cargo command includes the direct and watchdog parent-child fixtures", async () => {
  const supervisor = await readFile(supervisorPath, "utf8");
  const runner = await readFile(runnerPath, "utf8");
  const fixture = supervisor.indexOf(
    "unix_termination_stops_a_parent_and_child_in_the_managed_process_group",
  );

  assert.notEqual(fixture, -1);
  const fixtureContext = supervisor.slice(
    Math.max(0, fixture - 300),
    fixture + 2_500,
  );
  assert.match(fixtureContext, /#\[cfg\(unix\)\]/);
  assert.match(fixtureContext, /process_group\(0\)/);
  assert.match(fixtureContext, /terminate_process_tree/);
  assert.match(
    supervisor,
    /send_process_group_signal\(pid, ProcessSignal::Term\)/,
  );
  assert.match(
    supervisor,
    /send_process_group_signal\(pid, ProcessSignal::Kill\)/,
  );
  assert.match(runner, /fn configure_child_process_group/);
  assert.match(runner, /command\.process_group\(0\)/);

  const watchdogFixture = runner.indexOf(
    "watchdog_timeout_terminates_parent_and_descendant_then_admits_second_task",
  );
  assert.notEqual(watchdogFixture, -1);
  const watchdogFixtureContext = runner.slice(
    Math.max(0, watchdogFixture - 300),
    watchdogFixture + 2_500,
  );
  const watchdogDeclaration = runner.slice(
    Math.max(0, watchdogFixture - 100),
    watchdogFixture + 100,
  );
  assert.match(
    watchdogDeclaration,
    /#\[test\]\s+fn watchdog_timeout_terminates_parent_and_descendant_then_admits_second_task\(\)/,
  );
  assert.doesNotMatch(watchdogDeclaration, /#\[cfg/);
  assert.match(watchdogFixtureContext, /WorkerRunOutcome::TimedOut/);
});
