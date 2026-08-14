import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflowPath = resolve(
  import.meta.dirname,
  "../deploy-staging.yml",
);
const workflow = readFileSync(workflowPath, "utf8");

assert.match(workflow, /branches:\s*\[main\]/);
assert.doesNotMatch(workflow, /branches:\s*\[staging\]/);
assert.match(workflow, /git -C \"\$DIR\" fetch origin main \"\$\{GITHUB_SHA\}\"/);
assert.match(workflow, /git -C \"\$DIR\" checkout -f \"\$\{GITHUB_SHA\}\"/);

const pointAuthAtTunnel = workflow.indexOf(
  "- name: Point auth at the tunnel URL and recreate web",
);
const healthCheck = workflow.indexOf(
  "- name: Health check (via the public tunnel URL)",
);
const loginCheck = workflow.indexOf(
  "- name: Verify email/password login",
);
const publishAccess = workflow.indexOf("- name: Publish staging access");

assert.ok(pointAuthAtTunnel >= 0, "missing tunnel auth configuration step");
assert.ok(healthCheck > pointAuthAtTunnel, "health check must use the live URL");
assert.ok(loginCheck > healthCheck, "login must be tested after health");
assert.ok(publishAccess > loginCheck, "access details must publish after login test");

const bootstrap = workflow.slice(0, pointAuthAtTunnel);
const publish = workflow.slice(publishAccess);

assert.ok(
  !bootstrap.includes("Demo admin:"),
  "credentials must not be limited to the first bootstrap run",
);
assert.match(publish, /if: always\(\)?|if: always/);
assert.match(publish, /Microsoft SSO is intentionally unavailable/);
assert.doesNotMatch(publish, /get_env DEMO_ADMIN_PASSWORD/);
assert.doesNotMatch(publish, /get_env SEED_SAMPLE_PASSWORD/);
assert.doesNotMatch(publish, /Demo admin:/);
assert.match(publish, /never printed in workflow logs or summaries/);
assert.match(
  workflow,
  /\$URL\/api\/auth\/sign-in\/email/,
  "workflow must prove the published credentials can authenticate",
);
assert.match(workflow, /get_env PLATFORM_MASTER_EMAIL/);
assert.match(workflow, /get_env PLATFORM_MASTER_PASSWORD/);
assert.doesNotMatch(workflow, /get_env DEMO_ADMIN_(?:EMAIL|PASSWORD)/);

console.log("deploy-staging workflow login contract OK");
