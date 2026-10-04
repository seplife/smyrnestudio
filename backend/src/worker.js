// Exécute une analyse hors du fil principal pour que l'API reste réactive.
import { parentPort, workerData } from "node:worker_threads";
import { AnalysisError, analyze } from "./pipeline.js";

try {
  const result = await analyze(workerData.src, workerData.work, (progression, etape) => parentPort.postMessage({ type: "progress", progression, etape }));
  parentPort.postMessage({ type: "done", result });
} catch (e) {
  parentPort.postMessage({ type: "error", message: e instanceof AnalysisError ? e.message : `Erreur interne : ${e.name}: ${e.message}` });
}
