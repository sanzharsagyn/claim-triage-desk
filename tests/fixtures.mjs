// A hand-written model answer for claim CL-2026-01042, plus deliberate mistakes the validator must catch.
export const RAW_CLAIM1 = {
  facts: [
    { doc_id: "form", kind: "injury_date", value: "2026-01-12", quote: "Datum úrazu: 12. 1. 2026", confidence: 0.99 },
    { doc_id: "form", kind: "benefit_requested", value: "hospital", quote: "pobyt v nemocnici", confidence: 0.97 },
    { doc_id: "form", kind: "benefit_requested", value: "sick_leave", quote: "pracovní neschopnost", confidence: 0.97 },
    { doc_id: "disch", kind: "admission_date", value: "2026-01-12", quote: "Přijata: 12. 1. 2026", confidence: 0.99 },
    { doc_id: "disch", kind: "discharge_date", value: "2026-01-14", quote: "Propuštěna: 14. 1. 2026", confidence: 0.99 },
    { doc_id: "disch", kind: "injury_date", value: "2026-01-12", quote: "Dnes odpoledne pád na led", confidence: 0.9, note: "\"Dnes\" in a report written on the admission date" },
    { doc_id: "disch", kind: "diagnosis_code", value: "S52.5", quote: "S52.5 Zlomenina dolního konce vřetenní kosti vpravo", confidence: 0.99 },
    { doc_id: "dpn", kind: "sick_leave_start", value: "2026-01-12", quote: "Začátek DPN: 12. 1. 2026", confidence: 0.99 },
    { doc_id: "dpn", kind: "sick_leave_end", value: "2026-02-22", quote: "Ukončení DPN: 22. 2. 2026", confidence: 0.99 },
    { doc_id: "dpn", kind: "diagnosis_code", value: "S52.5", quote: "Diagnóza: S52.5", confidence: 0.99 },
  ],
  instructions_found: [],
};
export const RAW_BAD = {
  facts: [
    { doc_id: "form", kind: "injury_date", value: "2026-01-13", quote: "Datum úrazu: 13. 1. 2026", confidence: 0.9 },   // invented quote
    { doc_id: "form", kind: "injury_date", value: "12. 1. 2026", quote: "Datum úrazu: 12. 1. 2026", confidence: 0.9 }, // not ISO
    { doc_id: "nope", kind: "injury_date", value: "2026-01-12", quote: "Datum úrazu: 12. 1. 2026", confidence: 0.9 },  // unknown doc
    { doc_id: "disch", kind: "diagnosis_code", value: "fracture", quote: "Zlomenina", confidence: 0.9 },              // not ICD-10
    { doc_id: "disch", kind: "salary", value: "1", quote: "Přijata", confidence: 0.9 },                               // unknown kind
    { doc_id: "form", kind: "benefit_requested", value: "everything", quote: "pobyt v nemocnici", confidence: 0.9 },  // unknown benefit
    { doc_id: "disch", kind: "discharge_date", value: "2026-02-30", quote: "Propuštěna: 14. 1. 2026", confidence: 0.9 }, // impossible date
  ],
  instructions_found: [],
};
export function anthropicResponse(input, usage) {
  return { id: "msg_test", type: "message", role: "assistant", stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "toolu_1", name: "record_extraction", input: input }],
    usage: usage || { input_tokens: 2400, output_tokens: 900 } };
}
