import test from "node:test";
import assert from "node:assert/strict";
import { loadContext, loadDecisionPoints, loadValidationRuns } from "../src/catalog.js";

test("领域资料可以载入", async () => {
  const context = await loadContext();
  assert.ok(context.project);
  assert.ok(context.facts.length >= 3);
  assert.ok(context.actors.length >= 3);
});

test("决策点文档通过契约校验并可载入", async () => {
  const doc = await loadDecisionPoints();
  assert.ok(doc.decision_points.length >= 1);
  assert.ok(doc.evidence_catalog.length >= 1);
  assert.ok(doc.case_consents.length >= 1);
});

test("验证运行记录通过契约校验并可载入", async () => {
  const doc = await loadValidationRuns();
  assert.ok(doc.runs.length >= 1);
});
