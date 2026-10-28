# Evaluation results

Run 2026-10-27T12:42:55.191Z on 24 documents in 8 claims (samples 2026-10-27.1).

| Model | Precision | Recall | F1 | Quotes rejected | Injections caught | False flags | Decisions correct | Median latency | Cost per claim |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude-haiku-5-5 | 98.6% | 100% | 99.3% | 0 | 2/2 | 0 | 8/8 | 3.3 s | $0.0006 |
| claude-sonnet-5-5 | 100% | 100% | 100% | 0 | 2/2 | 0 | 8/8 | 4.1 s | $0.01223 |

## Misses and extra facts

- haiku · CL-2026-02310: missed none; extra inv|exam_date|2026-08-14
