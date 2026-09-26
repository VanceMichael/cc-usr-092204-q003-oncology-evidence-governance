import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validate } from "../src/schema-check.js";
import {
  checkVersionChain,
  checkReferences,
  checkRerunIntegrity,
  impactByEvidence,
  traceResult,
} from "../src/governance.js";
import { loadDecisionPoints, loadValidationRuns } from "../src/catalog.js";

// 规则：修订只新增版本而不覆盖既往依据。
test("决策点版本只增不改：版本连续递增且 current_version 指向最新版本", async () => {
  const doc = await loadDecisionPoints();
  for (const dp of doc.decision_points) {
    assert.deepEqual(checkVersionChain(dp), []);
  }

  const eso = doc.decision_points.find((d) => d.decision_id === "CDP-ESO-001");
  const [v1, v2] = eso.versions;
  // 指南更新后，v1 与其当时依据被完整保留，答案未被改写。
  assert.equal(v1.status, "被取代");
  assert.equal(v1.answer, "含铂双药化疗");
  assert.deepEqual(v1.evidence_refs, ["EV-CSCO-ESO-2023-A1"]);
  assert.equal(v2.answer, "免疫检查点抑制剂联合含铂双药化疗");
  assert.match(v2.change_reason, /只增不改/);
});

// 规则：每个决策点关联已登记的病例与证据。
test("所有病例与证据引用均可在登记目录中解析", async () => {
  const doc = await loadDecisionPoints();
  assert.deepEqual(checkReferences(doc), []);
});

// 规则：争议结论保留少数意见。
test("争议结论保留少数意见并记录持异议的评审人", async () => {
  const doc = await loadDecisionPoints();
  const v2 = doc.decision_points
    .find((d) => d.decision_id === "CDP-ESO-001")
    .versions.find((v) => v.version === "v2");
  assert.equal(v2.minority_opinions.length, 1);
  assert.match(v2.minority_opinions[0].position, /PD-L1低表达/);
  assert.ok(v2.minority_opinions[0].rationale.length > 0);
});

// 规则：专家盲审与利益冲突受控。
test("每个版本完成盲审、全员申报利益冲突，回避意见不计入通过票", async () => {
  const doc = await loadDecisionPoints();
  for (const dp of doc.decision_points) {
    for (const v of dp.versions) {
      assert.equal(v.review.blind, true, `${dp.decision_id} ${v.version} 应为盲审`);
      assert.equal(v.review.conflicts_declared, true);
      assert.ok(v.review.reviewers.length >= 2);
      for (const reviewer of v.review.reviewers) {
        assert.ok(reviewer.conflict_of_interest.length > 0);
      }
    }
  }
  // 存在因利益冲突而回避的评审人。
  const allReviewers = doc.decision_points.flatMap((dp) =>
    dp.versions.flatMap((v) => v.review.reviewers)
  );
  assert.ok(allReviewers.some((r) => r.decision === "回避" && r.conflict_of_interest !== "无"));
});

// 规则：授权范围与稀有组合再识别风险受控。
test("病例授权范围、稀有组合与再识别风险均登记，高风险病例不外溢到教学场景", async () => {
  const doc = await loadDecisionPoints();
  const rare = doc.case_consents.find((c) => c.case_ref === "CASE-REC-0188");
  assert.equal(rare.rare_combination, true);
  assert.equal(rare.reidentification_risk, "高");
  assert.ok(!rare.authorized_scopes.includes("教学展示"));
  // 决策点引用病例时，用途必须落在授权范围内（此处为基准建设/模型验证）。
  for (const dp of doc.decision_points) {
    for (const v of dp.versions) {
      for (const ref of v.case_refs) {
        const consent = doc.case_consents.find((c) => c.case_ref === ref);
        assert.ok(consent.authorized_scopes.includes("基准建设"));
      }
    }
  }
});

// 规则：一次验证冻结完整题集与评分规则，失败重跑不得挑换病例。
test("失败重跑复用原冻结题集、评分规则与冻结日期", async () => {
  const runs = await loadValidationRuns();
  const failed = runs.runs.find((r) => r.run_id === "RUN-2026-0131");
  const rerun = runs.runs.find((r) => r.run_id === "RUN-2026-0132");
  assert.equal(rerun.rerun_of, failed.run_id);
  assert.deepEqual(checkRerunIntegrity(rerun, failed), []);
  // 重跑包含的题目数量与原题集一致（只修复模型，不换题）。
  assert.equal(rerun.frozen_item_set.length, failed.frozen_item_set.length);
});

// 规则：指南撤回后能准确定位受影响结果。
test("撤回的指南条款可定位到受影响题目与运行，并留有作废记录", async () => {
  const doc = await loadDecisionPoints();
  const runs = await loadValidationRuns();
  const impact = impactByEvidence(doc, runs, "EV-NCCN-REC-2024-F3");
  assert.deepEqual(impact.impacted_decisions, ["CDP-REC-002"]);
  assert.deepEqual(
    impact.impacted_runs.map((r) => r.run_id).sort(),
    ["RUN-2026-0131", "RUN-2026-0132"]
  );

  const withdrawn = doc.evidence_catalog.find((e) => e.evidence_id === "EV-NCCN-REC-2024-F3");
  assert.equal(withdrawn.status, "已撤回");
  assert.equal(withdrawn.withdrawn_on, "2026-02-10");

  const invalidated = runs.runs.find((r) => r.run_id === "RUN-2026-0132");
  assert.equal(invalidated.status, "已作废");
  assert.deepEqual(invalidated.invalidation.trigger_evidence, ["EV-NCCN-REC-2024-F3"]);
  assert.deepEqual(invalidated.invalidation.affected_items, ["CDP-REC-002"]);
});

// 规则：任何结论可追溯到当时有效的病例、规则、审签人与变更理由。
test("结论追溯链还原当时有效的病例、证据、评分规则与审签", async () => {
  const doc = await loadDecisionPoints();
  const runs = await loadValidationRuns();
  const trace = traceResult(doc, runs, "RUN-2026-0132", "CDP-REC-002");
  assert.equal(trace.run.scoring_rules, "SR-1.3");
  assert.equal(trace.decision.version, "v1");
  assert.ok(trace.evidence.some((e) => e.evidence_id === "EV-NCCN-REC-2024-F3"));
  assert.ok(trace.cases[0].case_ref === "CASE-REC-0188");
  assert.equal(trace.review.blind, true);
  assert.ok(trace.change_reason.length > 0);
  assert.equal(trace.result.expected_answer, trace.answer);
});

// 规则：医生看到能力边界与证据缺口——评分说明必须给出。
test("逐题结果均给出解释以呈现能力边界或证据缺口", async () => {
  const runs = await loadValidationRuns();
  for (const run of runs.runs) {
    for (const result of run.results) {
      assert.ok(result.explanation.length > 0, `${run.run_id}/${result.decision_id} 缺少解释`);
    }
  }
});

// 契约防线：直接用校验器拒绝一个版本被覆盖（缺少 change_reason）的非法文档。
test("校验器拒绝缺少变更理由的版本结构", async () => {
  const schema = JSON.parse(await readFile(new URL("../contracts/decision-point.schema.json", import.meta.url)));
  const doc = await loadDecisionPoints();
  const tampered = structuredClone(doc);
  delete tampered.decision_points[0].versions[0].change_reason;
  assert.notDeepEqual(validate(tampered, schema), []);
});
