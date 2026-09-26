// 治理规则与追溯查询：跨决策点文档与验证记录的一致性检查。
// 这些规则超出单文件结构契约，需要跨文档比对。

function versionNumber(version) {
  return Number(version.slice(1));
}

function sameItemSet(a, b) {
  const key = (items) =>
    items
      .map((item) => `${item.decision_id}@${item.version}`)
      .sort()
      .join("|");
  return key(a) === key(b);
}

// 决策点版本链：版本号严格递增、不缺号，current_version 指向最大版本。
export function checkVersionChain(decisionPoint) {
  const errors = [];
  const numbers = decisionPoint.versions.map((v) => versionNumber(v.version));
  for (let i = 1; i < numbers.length; i += 1) {
    if (numbers[i] !== numbers[i - 1] + 1) {
      errors.push(`${decisionPoint.decision_id}：版本序列不连续（${decisionPoint.versions[i - 1].version} 后出现 ${decisionPoint.versions[i].version}）`);
    }
  }
  const max = `v${Math.max(...numbers)}`;
  if (decisionPoint.current_version !== max) {
    errors.push(`${decisionPoint.decision_id}：current_version 为 ${decisionPoint.current_version}，应为最大版本 ${max}`);
  }
  return errors;
}

// 决策点文档内部引用完整性：病例授权、证据条目均须登记，答案须为候选项。
export function checkReferences(decisionDoc) {
  const errors = [];
  const cases = new Set(decisionDoc.case_consents.map((c) => c.case_ref));
  const evidence = new Set(decisionDoc.evidence_catalog.map((e) => e.evidence_id));

  for (const dp of decisionDoc.decision_points) {
    for (const v of dp.versions) {
      for (const ref of v.case_refs) {
        if (!cases.has(ref)) errors.push(`${dp.decision_id} ${v.version}：引用未登记病例 ${ref}`);
      }
      for (const ref of v.evidence_refs) {
        if (!evidence.has(ref)) errors.push(`${dp.decision_id} ${v.version}：引用未登记证据 ${ref}`);
      }
      if (!v.options.includes(v.answer)) {
        errors.push(`${dp.decision_id} ${v.version}：答案不在候选项中`);
      }
    }
  }
  return errors;
}

// 重跑完整性：重跑必须复用原运行的冻结题集与同一评分规则版本。
export function checkRerunIntegrity(rerun, original) {
  const errors = [];
  if (!sameItemSet(rerun.frozen_item_set, original.frozen_item_set)) {
    errors.push(`${rerun.run_id}：重跑题集与原运行 ${original.run_id} 不一致，禁止挑换病例`);
  }
  if (rerun.scoring_rules.version !== original.scoring_rules.version) {
    errors.push(`${rerun.run_id}：评分规则版本与原运行 ${original.run_id} 不一致`);
  }
  if (rerun.frozen_at !== original.frozen_at) {
    errors.push(`${rerun.run_id}：冻结日期与原运行 ${original.run_id} 不一致`);
  }
  return errors;
}

// 依据证据条目定位所有受影响的验证运行（如指南撤回追溯）。
// 返回引用了该证据的冻结题目，以及包含这些题目的运行。
export function impactByEvidence(decisionDoc, runsDoc, evidenceId) {
  const impactedDecisions = new Set();
  for (const dp of decisionDoc.decision_points) {
    for (const v of dp.versions) {
      if (v.evidence_refs.includes(evidenceId)) impactedDecisions.add(dp.decision_id);
    }
  }
  const runs = runsDoc.runs.filter((run) =>
    run.frozen_item_set.some((item) => impactedDecisions.has(item.decision_id))
  );
  return {
    evidence_id: evidenceId,
    impacted_decisions: [...impactedDecisions],
    impacted_runs: runs.map((run) => ({
      run_id: run.run_id,
      status: run.status,
      items: run.frozen_item_set
        .filter((item) => impactedDecisions.has(item.decision_id))
        .map((item) => `${item.decision_id}@${item.version}`),
    })),
  };
}

// 从任意结论（run + 题目）追溯当时有效的病例、证据、答案与审签记录。
export function traceResult(decisionDoc, runsDoc, runId, decisionId) {
  const run = runsDoc.runs.find((r) => r.run_id === runId);
  if (!run) throw new Error(`未找到运行 ${runId}`);
  const frozen = run.frozen_item_set.find((item) => item.decision_id === decisionId);
  if (!frozen) throw new Error(`运行 ${runId} 的冻结题集不含 ${decisionId}`);
  const result = run.results.find((r) => r.decision_id === decisionId && r.version === frozen.version);
  const dp = decisionDoc.decision_points.find((d) => d.decision_id === decisionId);
  const version = dp?.versions.find((v) => v.version === frozen.version);
  if (!version) throw new Error(`决策点 ${decisionId} 的 ${frozen.version} 版本不存在，追溯链断裂`);

  const consents = version.case_refs.map((ref) =>
    decisionDoc.case_consents.find((c) => c.case_ref === ref)
  );
  const evidence = version.evidence_refs.map((id) =>
    decisionDoc.evidence_catalog.find((e) => e.evidence_id === id)
  );

  return {
    run: { run_id: run.run_id, frozen_at: run.frozen_at, scoring_rules: run.scoring_rules.version, status: run.status },
    decision: { decision_id: decisionId, version: frozen.version, title: dp.title },
    answer: version.answer,
    minority_opinions: version.minority_opinions,
    change_reason: version.change_reason,
    cases: consents,
    evidence,
    review: version.review,
    result,
  };
}
