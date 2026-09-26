import { readFile } from "node:fs/promises";

async function loadJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

export async function loadContext(path = new URL("../fixtures/context.json", import.meta.url)) {
  return loadJson(path);
}

export async function loadEvidences(path = new URL("../fixtures/evidences.json", import.meta.url)) {
  return loadJson(path);
}

export async function loadDecisionPoints(
  path = new URL("../fixtures/decision-points.json", import.meta.url)
) {
  return loadJson(path);
}

export async function loadCases(path = new URL("../fixtures/cases.json", import.meta.url)) {
  return loadJson(path);
}

export async function loadBenchmark(path = new URL("../fixtures/benchmark.json", import.meta.url)) {
  return loadJson(path);
}

export async function loadCatalog() {
  const [context, evidences, decisionPoints, cases, benchmark] = await Promise.all([
    loadContext(),
    loadEvidences(),
    loadDecisionPoints(),
    loadCases(),
    loadBenchmark(),
  ]);
  return {
    context,
    evidences: evidences.evidences,
    decisionPoints: decisionPoints.decision_points,
    cases: cases.cases,
    freezes: benchmark.freezes,
    runs: benchmark.runs,
  };
}

/**
 * 指南（或任意依据）失效/撤回后的影响定位：
 * 找出引用该依据的决策点版本、包含这些版本的冻结题集、以及对应的验证运行。
 */
export function findEvidenceImpact(catalog, evidenceId) {
  const evidence = catalog.evidences.find((item) => item.id === evidenceId);
  if (!evidence) {
    return null;
  }
  const affectedVersions = [];
  for (const point of catalog.decisionPoints) {
    for (const version of point.versions) {
      if (version.evidence_refs.includes(evidenceId)) {
        affectedVersions.push({
          decision_point_id: point.id,
          title: point.title,
          version: version.version,
          effective_from: version.effective_from,
        });
      }
    }
  }
  const affectedKeys = new Set(
    affectedVersions.map((item) => `${item.decision_point_id}@${item.version}`)
  );
  const affectedFreezes = catalog.freezes.filter((freeze) =>
    freeze.items.some((item) => affectedKeys.has(`${item.decision_point_id}@${item.version}`))
  );
  const freezeIds = new Set(affectedFreezes.map((freeze) => freeze.freeze_id));
  const affectedRuns = catalog.runs.filter((run) => freezeIds.has(run.freeze_id));
  return {
    evidence,
    affected_versions: affectedVersions,
    affected_freezes: affectedFreezes.map((freeze) => freeze.freeze_id),
    affected_runs: affectedRuns.map((run) => run.run_id),
  };
}

/**
 * 从一次验证运行中的某道题回溯完整依据链：
 * 当时有效的病例、评分规则、审签人与变更理由。
 */
export function traceConclusion(catalog, runId, decisionPointId) {
  const run = catalog.runs.find((item) => item.run_id === runId);
  if (!run) {
    return null;
  }
  const freeze = catalog.freezes.find((item) => item.freeze_id === run.freeze_id);
  const item = freeze?.items.find((entry) => entry.decision_point_id === decisionPointId);
  if (!freeze || !item) {
    return null;
  }
  const point = catalog.decisionPoints.find((entry) => entry.id === decisionPointId);
  const version = point?.versions.find((entry) => entry.version === item.version);
  if (!point || !version) {
    return null;
  }
  const evidences = version.evidence_refs.map((ref) =>
    catalog.evidences.find((entry) => entry.id === ref)
  );
  const caseIds = evidences
    .filter((entry) => entry && entry.kind === "case_snippet")
    .map((entry) => entry.source);
  const cases = catalog.cases.filter((entry) => caseIds.includes(entry.case_id));
  return {
    run_id: run.run_id,
    model: run.model,
    freeze_id: freeze.freeze_id,
    scoring_rules: freeze.scoring_rules,
    decision_point: {
      id: point.id,
      title: point.title,
      scenario: point.scenario,
      version: version.version,
      conclusion: version.conclusion,
      minority_opinions: version.minority_opinions,
      change_reason: version.change_reason,
      signed_off_by: version.signed_off_by,
      effective_from: version.effective_from,
    },
    evidences,
    cases,
  };
}
