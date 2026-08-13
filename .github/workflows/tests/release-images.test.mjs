import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const workflowUrl = new URL("../release-images.yml", import.meta.url)

assert.equal(existsSync(workflowUrl), true, "release-images.yml must exist")

const { parse } = await import("yaml")
const source = readFileSync(workflowUrl, "utf8")
const workflow = parse(source)

function steps(jobName) {
  const job = workflow.jobs?.[jobName]
  assert.ok(job, `missing ${jobName} job`)
  assert.match(String(job["runs-on"]), /^ubuntu-/)
  assert.doesNotMatch(JSON.stringify(job["runs-on"]), /self-hosted/i)
  return job.steps ?? []
}

function findStep(jobSteps, predicate, message) {
  const step = jobSteps.find(predicate)
  assert.ok(step, message)
  return step
}

test("release runs only for version tags with least-privilege publishing permissions", () => {
  assert.equal(typeof workflow.on, "object")
  assert.equal(workflow.on?.workflow_dispatch?.inputs?.ref?.required, true)
  assert.equal(workflow.on?.workflow_dispatch?.inputs?.ref?.type, "string")
  assert.equal(workflow.on.push, undefined)
  assert.equal(workflow.permissions?.contents, "read")
  assert.equal(workflow.permissions?.packages, undefined)
  assert.equal(workflow.permissions?.["id-token"], undefined)
  assert.equal(workflow.jobs?.build?.permissions?.contents, "read")
  assert.equal(workflow.jobs?.build?.permissions?.packages, "write")
  assert.equal(workflow.jobs?.build?.permissions?.["id-token"], "write")
  assert.doesNotMatch(source, /pull_request|self-hosted|CLOUDFLARE|cloudflare/)

  const allowedSecrets = source.match(/secrets\.[A-Z0-9_]+/g) ?? []
  assert.deepEqual([...new Set(allowedSecrets)], ["secrets.GITHUB_TOKEN"])
})

test("build matrix publishes web, migrator, backup, and agent for amd64 and arm64", () => {
  const build = workflow.jobs?.build
  const include = build?.strategy?.matrix?.include
  assert.equal(Array.isArray(include), true)
  assert.deepEqual(include.map((entry) => entry.name).sort(), ["agent", "backup", "migrator", "web"])

  const byName = Object.fromEntries(include.map((entry) => [entry.name, entry]))
  assert.deepEqual(byName.web, {
    name: "web",
    repository: "crm-web",
    context: ".",
    file: "Dockerfile",
    target: "runner",
  })
  assert.deepEqual(byName.migrator, {
    name: "migrator",
    repository: "crm-migrator",
    context: ".",
    file: "Dockerfile",
    target: "migrator",
  })
  assert.deepEqual(byName.backup, {
    name: "backup",
    repository: "crm-backup",
    context: "docker/backup",
    file: "docker/backup/Dockerfile",
    target: "",
  })
  assert.deepEqual(byName.agent, {
    name: "agent",
    repository: "crm-deployment-agent",
    context: ".",
    file: "apps/deployment-agent/Dockerfile",
    target: "runtime",
  })

  const buildSteps = steps("build")
  findStep(buildSteps, (step) => /docker\/setup-qemu-action@/.test(step.uses ?? ""), "missing QEMU setup")
  findStep(buildSteps, (step) => /docker\/setup-buildx-action@/.test(step.uses ?? ""), "missing Buildx setup")
  const publish = findStep(buildSteps, (step) => /docker\/build-push-action@/.test(step.uses ?? ""), "missing image build/push")
  assert.equal(publish.id, "build-push")
  assert.equal(publish.with?.platforms, "linux/amd64,linux/arm64")
  assert.equal(publish.with?.provenance, "mode=max")
  assert.equal(publish.with?.sbom, true)
  assert.match(publish.with?.outputs ?? "", /push-by-digest=true/)
  assert.match(publish.with?.outputs ?? "", /name-canonical=true/)

  const scanIndex = buildSteps.findIndex((step) => /aquasecurity\/trivy-action@/.test(step.uses ?? ""))
  const signIndex = buildSteps.findIndex((step) => /cosign sign/.test(step.run ?? ""))
  const publishIndex = buildSteps.findIndex((step) => /imagetools create/.test(step.run ?? ""))
  assert.ok(scanIndex > buildSteps.indexOf(publish), "scan must consume the pushed digest")
  assert.ok(signIndex > scanIndex, "signing must happen only after scan")
  assert.ok(publishIndex > signIndex, "mutable tags must publish only after scan and signing")
  assert.match(buildSteps[publishIndex].run, /env\.TARGET_REF/)
  assert.match(buildSteps[publishIndex].run, /SOURCE_COMMIT/)
})

test("each immutable digest is scanned, SBOMed, signed, and verified", () => {
  const buildSteps = steps("build")
  const image = findStep(buildSteps, (step) => step.id === "image", "missing immutable reference validation")
  assert.match(image.env?.DIGEST ?? "", /steps\.build-push\.outputs\.digest/)
  assert.match(image.run ?? "", /\^sha256:\[0-9a-f\]\{64\}\$/)

  const trivy = findStep(buildSteps, (step) => /aquasecurity\/trivy-action@/.test(step.uses ?? ""), "missing Trivy scan")
  assert.match(trivy.with?.["image-ref"] ?? "", /steps\.image\.outputs\.ref/)
  assert.equal(String(trivy.with?.["exit-code"]), "1")
  assert.match(trivy.with?.severity ?? "", /HIGH/)
  assert.match(trivy.with?.severity ?? "", /CRITICAL/)

  const sbom = findStep(buildSteps, (step) => /anchore\/sbom-action@/.test(step.uses ?? ""), "missing SBOM generation")
  const prepareEvidenceIndex = buildSteps.findIndex((step) => /mkdir -p release/.test(step.run ?? ""))
  const sbomIndex = buildSteps.indexOf(sbom)
  assert.ok(prepareEvidenceIndex >= 0 && prepareEvidenceIndex < sbomIndex, "evidence directory must exist before SBOM output")
  assert.match(sbom.with?.image ?? "", /steps\.image\.outputs\.ref/)
  assert.equal(sbom.with?.format, "spdx-json")
  assert.match(sbom.with?.["output-file"] ?? "", /\.spdx\.json/)

  const signing = findStep(buildSteps, (step) => /cosign sign/.test(step.run ?? ""), "missing Cosign signing")
  assert.match(signing.run, /cosign sign --yes/)
  assert.match(signing.run, /cosign verify/)
  assert.match(signing.run, /--certificate-identity/)
  assert.match(
    signing.env?.WORKFLOW_IDENTITY ?? "",
    /^https:\/\/github\.com\/\$\{\{\s*github\.workflow_ref\s*\}\}$/,
  )
  assert.match(signing.run, /https:\/\/token\.actions\.githubusercontent\.com/)
})

test("release manifest records immutable provenance for all images", () => {
  const manifestSteps = steps("manifest")
  const compose = findStep(manifestSteps, (step) => /release-manifest\.json/.test(step.run ?? ""), "missing release manifest composition")
  for (const field of ["image", "digest", "source_commit", "workflow_identity", "build_time"]) {
    assert.match(compose.run, new RegExp(field))
  }
  assert.match(compose.run, /length == 4/)

  const upload = findStep(manifestSteps, (step) => /actions\/upload-artifact@/.test(step.uses ?? ""), "missing manifest upload")
  assert.match(upload.with?.path ?? "", /release-manifest\.json/)
  assert.equal(upload.with?.["if-no-files-found"], "error")
})

test("all third-party actions use immutable commit pins", () => {
  const uses = [...source.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1])
  assert.ok(uses.length >= 8)
  for (const action of uses) {
    if (action.startsWith("./")) continue
    assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/, `action is not SHA-pinned: ${action}`)
  }
})
