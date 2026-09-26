import test from "node:test";
import assert from "node:assert/strict";
import {
  loadContext,
  loadCatalog,
  findEvidenceImpact,
  traceConclusion,
} from "../src/catalog.js";

test("领域资料可以载入", async () => {
  const context = await loadContext();
  assert.ok(context.project);
  assert.ok(context.facts.length >= 3);
  assert.ok(context.actors.length >= 3);
});

test("决策点版本只增不改，且每次修订留有变更理由与审签人", async () => {
  const { decisionPoints } = await loadCatalog();
  for (const point of decisionPoints) {
    const numbers = point.versions.map((version) => version.version);
    assert.deepEqual(
      numbers,
      [...numbers].sort((a, b) => a - b),
      `${point.id} 版本号必须按序排列`
    );
    assert.equal(new Set(numbers).size, numbers.length, `${point.id} 版本号不得重复`);
    for (const version of point.versions) {
      assert.ok(version.change_reason, `${point.id}@v${version.version} 缺少变更理由`);
      assert.ok(version.signed_off_by.length >= 1, `${point.id}@v${version.version} 缺少审签人`);
      assert.ok(version.evidence_refs.length >= 1, `${point.id}@v${version.version} 缺少循证依据`);
    }
  }
});

test("所有证据引用均可解析，且现行版本不得引用已撤回依据", async () => {
  const { evidences, decisionPoints } = await loadCatalog();
  const byId = new Map(evidences.map((item) => [item.id, item]));
  for (const point of decisionPoints) {
    const latest = point.versions[point.versions.length - 1];
    for (const version of point.versions) {
      for (const ref of version.evidence_refs) {
        assert.ok(byId.has(ref), `${point.id}@v${version.version} 引用了不存在的依据 ${ref}`);
      }
    }
    for (const ref of latest.evidence_refs) {
      assert.notEqual(
        byId.get(ref).status,
        "retracted",
        `${point.id} 现行版本仍引用已撤回依据 ${ref}`
      );
    }
  }
});

test("指南撤回后可定位受影响的版本、冻结题集与验证运行", async () => {
  const catalog = await loadCatalog();
  const impact = findEvidenceImpact(catalog, "EV-G-010");
  assert.ok(impact);
  assert.deepEqual(
    impact.affected_versions.map((item) => `${item.decision_point_id}@v${item.version}`),
    ["DP-FU-03@v1"]
  );
  assert.deepEqual(impact.affected_freezes, ["FRZ-2024-06"]);
  assert.deepEqual(impact.affected_runs.sort(), ["RUN-2024-0610", "RUN-2024-0701"]);
});

test("失败重跑引用同一冻结题集，不得挑换病例", async () => {
  const { runs, freezes } = await loadCatalog();
  const freezeById = new Map(freezes.map((item) => [item.freeze_id, item]));
  for (const run of runs) {
    if (!run.parent_run_id) continue;
    const parent = runs.find((item) => item.run_id === run.parent_run_id);
    assert.ok(parent, `${run.run_id} 的父运行不存在`);
    assert.equal(run.freeze_id, parent.freeze_id, `${run.run_id} 重跑更换了冻结题集`);
    const items = freezeById.get(run.freeze_id).items;
    assert.ok(items.length >= 1, "冻结题集不得为空");
  }
});

test("病例片段仅在授权范围内使用，已撤销授权不得进入冻结题集", async () => {
  const { cases, decisionPoints, freezes } = await loadCatalog();
  const caseById = new Map(cases.map((item) => [item.case_id, item]));
  const evidenceByCase = new Map();
  const { evidences } = await loadCatalog();
  for (const evidence of evidences) {
    if (evidence.kind === "case_snippet") {
      evidenceByCase.set(evidence.source, evidence.id);
    }
  }
  const usedCases = new Set();
  for (const point of decisionPoints) {
    for (const version of point.versions) {
      for (const ref of version.evidence_refs) {
        for (const [caseId, evidenceId] of evidenceByCase) {
          if (evidenceId === ref) usedCases.add(`${caseId}|${point.scenario}`);
        }
      }
    }
  }
  for (const entry of usedCases) {
    const [caseId, scenario] = entry.split("|");
    const record = caseById.get(caseId);
    assert.ok(record, `${caseId} 缺少治理记录`);
    assert.ok(
      record.consent.scope.includes(scenario),
      `${caseId} 被用于未授权场景 ${scenario}`
    );
  }
  const frozenEvidence = new Set();
  for (const freeze of freezes) {
    for (const item of freeze.items) {
      const point = decisionPoints.find((entry) => entry.id === item.decision_point_id);
      const version = point.versions.find((entry) => entry.version === item.version);
      for (const ref of version.evidence_refs) frozenEvidence.add(ref);
    }
  }
  for (const record of cases) {
    if (!record.consent.withdrawn) continue;
    const evidenceId = evidenceByCase.get(record.case_id);
    assert.ok(
      !evidenceId || !frozenEvidence.has(evidenceId),
      `${record.case_id} 授权已撤销但仍出现在冻结题集中`
    );
  }
});

test("稀有组合病例必须完成再识别风险评估并给出缓释措施", async () => {
  const { cases } = await loadCatalog();
  for (const record of cases) {
    const risk = record.reidentification_risk;
    if (risk.rare_combination) {
      assert.ok(risk.assessed_by && risk.assessed_at, `${record.case_id} 稀有组合未评估`);
    }
    if (risk.risk_level === "medium" || risk.risk_level === "high") {
      assert.ok(risk.mitigation, `${record.case_id} 风险为 ${risk.risk_level} 但缺少缓释措施`);
    }
  }
});

test("申报利益冲突的专家不得出现在相关版本的审签人中", async () => {
  const { cases, decisionPoints, evidences } = await loadCatalog();
  const recusedByCase = new Map();
  for (const record of cases) {
    const recused = record.blind_review.conflicts_of_interest
      .filter((item) => item.action === "recused")
      .map((item) => item.reviewer);
    recusedByCase.set(record.case_id, new Set(recused));
  }
  const caseByEvidence = new Map(
    evidences.filter((item) => item.kind === "case_snippet").map((item) => [item.id, item.source])
  );
  for (const point of decisionPoints) {
    for (const version of point.versions) {
      for (const ref of version.evidence_refs) {
        const caseId = caseByEvidence.get(ref);
        if (!caseId) continue;
        const recused = recusedByCase.get(caseId) ?? new Set();
        for (const signer of version.signed_off_by) {
          assert.ok(
            !recused.has(signer),
            `${signer} 已回避 ${caseId} 却审签了 ${point.id}@v${version.version}`
          );
        }
      }
    }
  }
});

test("任一验证结论可追溯到当时有效的病例、规则、审签人与变更理由", async () => {
  const catalog = await loadCatalog();
  const trace = traceConclusion(catalog, "RUN-2024-0701", "DP-RECTUM-01");
  assert.ok(trace);
  assert.equal(trace.freeze_id, "FRZ-2024-06");
  assert.equal(trace.decision_point.version, 2);
  assert.ok(trace.decision_point.change_reason);
  assert.ok(trace.decision_point.signed_off_by.length >= 1);
  assert.ok(trace.scoring_rules.rule_set_id);
  assert.ok(trace.evidences.every((item) => item && item.id));
  assert.ok(trace.cases.length >= 1, "应能回溯到脱敏病例治理记录");
  assert.equal(trace.cases[0].case_id, "CASE-C001");
});
