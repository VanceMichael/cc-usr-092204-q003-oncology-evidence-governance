import { createServer } from "node:http";
import {
  loadCatalog,
  loadContext,
  findEvidenceImpact,
  traceConclusion,
} from "./catalog.js";

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (url.pathname === "/context") {
    sendJson(response, 200, await loadContext());
    return;
  }
  if (url.pathname === "/catalog") {
    sendJson(response, 200, await loadCatalog());
    return;
  }
  if (url.pathname === "/impact") {
    const evidenceId = url.searchParams.get("evidence");
    const impact = evidenceId ? findEvidenceImpact(await loadCatalog(), evidenceId) : null;
    if (!impact) {
      sendJson(response, 404, { error: "evidence not found" });
      return;
    }
    sendJson(response, 200, impact);
    return;
  }
  if (url.pathname === "/trace") {
    const runId = url.searchParams.get("run");
    const decisionPointId = url.searchParams.get("decision_point");
    const trace =
      runId && decisionPointId
        ? traceConclusion(await loadCatalog(), runId, decisionPointId)
        : null;
    if (!trace) {
      sendJson(response, 404, { error: "run or decision point not found in freeze" });
      return;
    }
    sendJson(response, 200, trace);
    return;
  }
  sendJson(response, 404, { error: "not found" });
});

server.listen(8000, "127.0.0.1");
