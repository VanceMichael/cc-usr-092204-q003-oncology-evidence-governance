import { readFile } from "node:fs/promises";
import { loadValidated } from "./schema-check.js";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const CONTRACTS = new URL("../contracts/", import.meta.url);
const FIXTURES = new URL("../fixtures/", import.meta.url);

export async function loadContext() {
  return loadValidated(
    () => readJson(new URL("./context.json", FIXTURES)),
    await readJson(new URL("./context.schema.json", CONTRACTS)),
    "领域上下文"
  );
}

export async function loadDecisionPoints() {
  return loadValidated(
    () => readJson(new URL("./decision-points.json", FIXTURES)),
    await readJson(new URL("./decision-point.schema.json", CONTRACTS)),
    "临床决策点"
  );
}

export async function loadValidationRuns() {
  return loadValidated(
    () => readJson(new URL("./validation-runs.json", FIXTURES)),
    await readJson(new URL("./validation-run.schema.json", CONTRACTS)),
    "验证运行记录"
  );
}
