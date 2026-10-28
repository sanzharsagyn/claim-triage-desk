// OpenAPI 3.1 description of the public API, served at /api/openapi.json.
import { KINDS, BENEFITS } from "../public/lib/core.js";

export function openapi(origin) {
  const fact = {
    type: "object",
    required: ["id", "doc_id", "kind", "value", "quote", "span", "confidence"],
    properties: {
      id: { type: "string", example: "f1" },
      doc_id: { type: "string", example: "disch" },
      kind: { type: "string", enum: KINDS },
      value: { type: "string", description: "Dates as YYYY-MM-DD, ICD-10 codes, whole money amounts, or a benefit (" + BENEFITS.join(", ") + ")", example: "2026-01-12" },
      currency: { type: "string", example: "CZK" },
      quote: { type: "string", description: "The exact text in the document (or in the model's transcription of a scan) that supports the value" },
      span: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2, description: "Character offsets of the quote" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      note: { type: "string" },
    },
  };
  const textDoc = { type: "object", required: ["text"], properties: { id: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,20}$" }, title: { type: "string", maxLength: 120 }, text: { type: "string", maxLength: 6000 } } };
  const fileDoc = { type: "object", required: ["file"], properties: { id: { type: "string" }, title: { type: "string" },
    file: { type: "object", required: ["mime", "data"], properties: { mime: { type: "string", enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"] }, data: { type: "string", contentEncoding: "base64", description: "Up to 1.5 MB after decoding. Photos are best sent at about 1568 px on the long side." } } } } };
  const error = { type: "object", properties: { error: { type: "string" }, message: { type: "string" }, upstream: { type: "string" } } };
  return {
    openapi: "3.1.0",
    info: {
      title: "Claim Triage Desk API",
      version: "1.0.0",
      description: "Extracts facts from insurance claim documents with a language model and returns only facts whose quotes were verified in code. Fictional demo: do not send real personal or medical data. Open with rate limits; a production deployment would sit behind the insurer's API gateway and identity provider.",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/v1/health": { get: { summary: "Service status, models and limits", responses: { 200: { description: "OK" } } } },
      "/api/v1/extract": {
        post: {
          summary: "Extract and verify facts",
          description: "Send either a sample claim id, or up to 3 documents of your own (text, or at most 2 images or PDFs). Own documents run on Claude Haiku 5.5, 8 runs a day per IP. Uploaded files are not stored.",
          requestBody: { required: true, content: { "application/json": { schema: { oneOf: [
            { type: "object", required: ["claimId"], properties: { claimId: { type: "string", example: "CL-2026-01042" }, model: { type: "string", enum: ["haiku", "sonnet"], default: "haiku" } } },
            { type: "object", required: ["docs"], properties: { docs: { type: "array", minItems: 1, maxItems: 3, items: { oneOf: [textDoc, fileDoc] } } } },
          ] }, examples: {
            sample: { value: { claimId: "CL-2026-01042", model: "haiku" } },
            text: { value: { docs: [{ id: "er", title: "Emergency report", text: "Datum vyšetření: 15. 3. 2026\nDiagnóza: S62.1 Zlomenina zápěstní kosti" }] } },
          } } } },
          responses: {
            200: { description: "Validated extraction", content: { "application/json": { schema: { type: "object", properties: {
              model: { type: "string" }, modelKey: { type: "string" }, promptVersion: { type: "string" },
              facts: { type: "array", items: fact },
              rejected: { type: "array", description: "Facts the model returned that failed validation, with reasons", items: { type: "object" } },
              injections: { type: "array", description: "Passages that try to instruct the system, flagged by rules and/or the model", items: { type: "object" } },
              transcripts: { type: "array", description: "The model's transcription of each image or PDF", items: { type: "object", properties: { doc_id: { type: "string" }, text: { type: "string" } } } },
              translations: { type: "array", items: { type: "object", properties: { doc_id: { type: "string" }, english: { type: "string" } } } },
              usage: { type: "object" }, costUsd: { type: "number" }, latencyMs: { type: "integer" }, cached: { type: "boolean" }, ranAt: { type: "string", format: "date-time" },
            } } } } },
            400: { description: "Invalid input", content: { "application/json": { schema: error } } },
            429: { description: "Rate limit or daily budget reached", content: { "application/json": { schema: error } } },
            502: { description: "The model call failed", content: { "application/json": { schema: error } } },
            503: { description: "Live mode is off", content: { "application/json": { schema: error } } },
          },
        },
      },
      "/api/v1/feedback": { post: { summary: "Record a handler's decision next to the AI suggestion", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["ai", "decision"], properties: {
        claimId: { type: "string" }, ai: { type: "string", enum: ["approve", "info", "escalate"] }, decision: { type: "string", enum: ["approve", "info", "escalate"] } } } } } }, responses: { 200: { description: "Recorded" } } } },
      "/api/v1/metrics": { get: { summary: "Daily counters: runs, latency, cost, rejected quotes, flagged instructions, overrides",
        parameters: [{ name: "days", in: "query", schema: { type: "integer", minimum: 1, maximum: 30, default: 14 } }], responses: { 200: { description: "OK" } } } },
    },
  };
}
