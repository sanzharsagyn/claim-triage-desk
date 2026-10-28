# Evaluation results

Run 2026-10-28T17:22:19.744Z on 33 documents in 11 claims (samples 2026-10-28.1).

| Model | Precision | Recall | Recall on scans | F1 | Quotes rejected | Injections caught | False flags | Decisions correct | Median latency | Cost per claim |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude-haiku-5-5 | 98.1% | 100% | 100% | 99% | 0 | 2/2 | 0 | 11/11 | 3.2 s | $0.00071 |
| claude-sonnet-5-5 | 100% | 100% | 100% | 100% | 0 | 2/2 | 0 | 11/11 | 4.9 s | $0.0151 |

## Misses and extra facts

- haiku · CL-2026-02310: missed none; extra inv|exam_date|2026-08-14
- haiku · CL-2026-02755: missed none; extra disch|exam_date|2026-08-14
