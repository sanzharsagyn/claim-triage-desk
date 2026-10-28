"""Minimal Python client for the Claim Triage Desk API. Standard library only.

    python examples/claimdesk_client.py https://sanzhar.sanzarsagyn.workers.dev CL-2026-02755
    python examples/claimdesk_client.py https://sanzhar.sanzarsagyn.workers.dev --file scan.jpg

The API returns only facts whose quotes were found in the document (or, for a scan, in the
model's transcription, which is returned too). Everything the model said that failed a check
is in "rejected" with the reason, so a calling system can show it to a person instead of hiding it.
"""
from __future__ import annotations

import base64
import json
import mimetypes
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

FILE_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code, self.message = status, code, message


@dataclass
class Fact:
    doc_id: str
    kind: str
    value: str
    quote: str
    confidence: float
    currency: str | None = None
    note: str | None = None


class ClaimDesk:
    def __init__(self, base_url: str, timeout: float = 90):
        self.base = base_url.rstrip("/")
        self.timeout = timeout

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={"content-type": "application/json", "user-agent": "claimdesk-python/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read())
            except ValueError:
                err = {}
            raise ApiError(e.code, err.get("error", "http_error"), err.get("message", str(e))) from None

    def health(self) -> dict:
        return self._call("GET", "/api/v1/health")

    def extract_sample(self, claim_id: str, model: str = "haiku") -> dict:
        return self._call("POST", "/api/v1/extract", {"claimId": claim_id, "model": model})

    def extract(self, docs: list[dict]) -> dict:
        """docs: [{"id": "er", "title": "...", "text": "..."}] or file documents from file_doc()."""
        return self._call("POST", "/api/v1/extract", {"docs": docs})

    def feedback(self, ai: str, decision: str, claim_id: str = "") -> dict:
        return self._call("POST", "/api/v1/feedback", {"claimId": claim_id, "ai": ai, "decision": decision})

    def metrics(self, days: int = 14) -> dict:
        return self._call("GET", f"/api/v1/metrics?days={days}")

    @staticmethod
    def file_doc(path: str | Path, doc_id: str = "doc1", title: str | None = None) -> dict:
        p = Path(path)
        mime = mimetypes.guess_type(p.name)[0] or ""
        if mime not in FILE_TYPES:
            raise ValueError(f"{p.name}: use JPEG, PNG, WebP or PDF")
        return {"id": doc_id, "title": title or p.stem, "file": {"mime": mime, "data": base64.b64encode(p.read_bytes()).decode()}}

    @staticmethod
    def facts(result: dict) -> list[Fact]:
        keep = Fact.__dataclass_fields__
        return [Fact(**{k: v for k, v in f.items() if k in keep}) for f in result.get("facts", [])]


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    desk = ClaimDesk(argv[1])
    try:
        r = desk.extract([desk.file_doc(argv[3])]) if argv[2] == "--file" else desk.extract_sample(argv[2])
    except ApiError as e:
        print(e, file=sys.stderr)
        return 1
    for f in desk.facts(r):
        print(f"{f.doc_id:<6} {f.kind:<18} {f.value:<12} {f.confidence:.2f}  “{f.quote}”")
    print(f"\n{len(r['facts'])} facts, {len(r['rejected'])} rejected, {len(r['injections'])} instructions flagged · {r['model']} · ${r.get('costUsd', 0):.4f}{' · cached' if r.get('cached') else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
