import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflowPath = resolve(
  import.meta.dirname,
  "../deploy-staging.yml",
);
const workflow = readFileSync(workflowPath, "utf8");

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
assert.match(publish, /get_env DEMO_ADMIN_PASSWORD/);
assert.match(publish, /get_env SEED_SAMPLE_PASSWORD/);
assert.match(publish, /Microsoft SSO is intentionally unavailable/);
assert.match(
  workflow,
  /\$URL\/api\/auth\/sign-in\/email/,
  "workflow must prove the published credentials can authenticate",
);

console.log("deploy-staging workflow login contract OK");
