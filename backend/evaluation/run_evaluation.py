import argparse
import json
import os
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from urllib import request
from urllib.error import HTTPError, URLError


ROOT = Path(__file__).resolve().parent
EVAL_SET = ROOT / "evaluation_set.json"
EXPECTED_COUNTS = {"grounded_qa": 20, "out_of_scope": 10, "summary": 10}
REFUSAL_MARKERS = (
    "khong du thong tin",
    "khong tim thay",
    "khong co thong tin",
    "vui long chon",
)


def normalize(text):
    text = unicodedata.normalize("NFD", text or "")
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text.lower()


def load_cases():
    data = json.loads(EVAL_SET.read_text(encoding="utf-8"))
    return data["cases"]


def validate_static(cases):
    counts = Counter(case["category"] for case in cases)
    errors = []
    for category, expected in EXPECTED_COUNTS.items():
        if counts[category] != expected:
            errors.append(f"{category}: expected {expected}, got {counts[category]}")

    seen = set()
    for case in cases:
        case_id = case.get("id")
        if not case_id or case_id in seen:
            errors.append(f"duplicate or missing id: {case_id}")
        seen.add(case_id)
        if not case.get("question"):
            errors.append(f"{case_id}: missing question")
        if case["category"] in ("grounded_qa", "summary"):
            if not case.get("requires_sources"):
                errors.append(f"{case_id}: grounded/summary cases must require sources")
            if not case.get("expected_keywords"):
                errors.append(f"{case_id}: missing expected_keywords")
        if case["category"] == "out_of_scope" and not case.get("must_refuse"):
            errors.append(f"{case_id}: out_of_scope cases must set must_refuse")

    return errors


def post_json(url, payload, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=body, headers=headers, method="POST")
    with request.urlopen(req, timeout=180) as res:
        return res.read().decode("utf-8")


def call_chat(api_url, token, question, doc_ids):
    raw = post_json(
        f"{api_url.rstrip('/')}/chat/query",
        {"question": question, "selected_doc_ids": doc_ids},
        token=token,
    )
    answer_parts = []
    sources = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("type") == "chunk":
            answer_parts.append(event.get("data", ""))
        elif event.get("type") == "sources":
            sources = event.get("data") or []
    return "".join(answer_parts), sources


def has_refusal(answer):
    answer_norm = normalize(answer)
    return any(marker in answer_norm for marker in REFUSAL_MARKERS)


def source_is_valid(source):
    return bool(source.get("filename")) and source.get("page") not in (None, "")


def keyword_matches(answer, keywords):
    answer_norm = normalize(answer)
    return [kw for kw in keywords if normalize(kw) in answer_norm]


def evaluate_api(cases, api_url, token, doc_ids):
    errors = []
    for case in cases:
        answer, sources = call_chat(api_url, token, case["question"], doc_ids)
        valid_sources = [src for src in sources if source_is_valid(src)]

        if case.get("requires_sources") and not valid_sources:
            errors.append(f"{case['id']}: expected sources with filename and page")

        if case.get("requires_sources") and "[S" not in answer and "trang" not in normalize(answer):
            errors.append(f"{case['id']}: answer has sources payload but no citation text")

        if case.get("must_refuse") and not has_refusal(answer):
            errors.append(f"{case['id']}: expected refusal, got: {answer[:160]}")

        keywords = case.get("expected_keywords") or []
        if keywords:
            matches = keyword_matches(answer, keywords)
            min_matches = 1 if len(keywords) < 3 else 2
            if len(matches) < min_matches:
                errors.append(f"{case['id']}: weak keyword coverage {matches}/{keywords}")

    no_doc_answer, no_doc_sources = call_chat(
        api_url,
        token,
        "Tài liệu này nói về kiến trúc gì?",
        [],
    )
    if no_doc_sources:
        errors.append("no_selected_documents: expected empty sources")
    if not has_refusal(no_doc_answer):
        errors.append(f"no_selected_documents: expected select-document/refusal message, got: {no_doc_answer[:160]}")

    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", action="store_true", help="Run live API evaluation instead of static validation only.")
    parser.add_argument("--api-url", default=os.getenv("RAG_EVAL_API_URL", "http://localhost/api"))
    parser.add_argument("--token", default=os.getenv("RAG_EVAL_TOKEN"))
    parser.add_argument("--doc-ids", default=os.getenv("RAG_EVAL_DOC_IDS", ""))
    args = parser.parse_args()

    cases = load_cases()
    errors = validate_static(cases)
    if args.api:
        doc_ids = [int(item.strip()) for item in args.doc_ids.split(",") if item.strip()]
        if not args.token:
            errors.append("RAG_EVAL_TOKEN is required for --api")
        if not doc_ids:
            errors.append("RAG_EVAL_DOC_IDS is required for --api")
        if not errors:
            try:
                errors.extend(evaluate_api(cases, args.api_url, args.token, doc_ids))
            except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
                errors.append(f"api evaluation failed: {exc}")

    if errors:
        print("Evaluation failed:")
        for err in errors:
            print(f"- {err}")
        return 1

    mode = "api" if args.api else "static"
    print(f"Evaluation passed ({mode}) with {len(cases)} cases.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
