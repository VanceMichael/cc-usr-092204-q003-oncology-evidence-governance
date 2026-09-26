import { createServer } from "node:http";
import { loadContext, loadDecisionPoints, loadValidationRuns } from "./catalog.js";
import { impactByEvidence, traceResult } from "./governance.js";

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  try {
    if (url.pathname === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (url.pathname === "/context") {
      sendJson(response, 200, await loadContext());
      return;
    }
    if (url.pathname === "/decision-points") {
      sendJson(response, 200, await loadDecisionPoints());
      return;
    }
    if (url.pathname === "/validation-runs") {
      sendJson(response, 200, await loadValidationRuns());
      return;
    }
    // 指南撤回影响定位：/impact?evidence=EV-NCCN-REC-2024-F3
    if (url.pathname === "/impact") {
      const evidence = url.searchParams.get("evidence");
      if (!evidence) {
        sendJson(response, 400, { error: "缺少 evidence 参数" });
        return;
      }
      sendJson(
        response,
        200,
        impactByEvidence(await loadDecisionPoints(), await loadValidationRuns(), evidence)
      );
      return;
    }
    // 结论追溯：/trace?run=RUN-2026-0132&decision=CDP-REC-002
    if (url.pathname === "/trace") {
      const run = url.searchParams.get("run");
      const decision = url.searchParams.get("decision");
      if (!run || !decision) {
        sendJson(response, 400, { error: "缺少 run 或 decision 参数" });
        return;
      }
      sendJson(
        response,
        200,
        traceResult(await loadDecisionPoints(), await loadValidationRuns(), run, decision)
      );
      return;
    }
    response.writeHead(404);
    response.end();
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(8000, "127.0.0.1");
