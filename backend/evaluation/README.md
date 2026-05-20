# RAG Evaluation

This folder contains a small grounding evaluation set:

- 20 grounded QA cases
- 10 out-of-scope cases that must refuse
- 10 summary/general cases

Run static validation:

```powershell
python backend/evaluation/run_evaluation.py
```

Run against the local API after uploading the matching report/PDF:

```powershell
$env:RAG_EVAL_TOKEN="your-user-jwt"
$env:RAG_EVAL_DOC_IDS="1"
python backend/evaluation/run_evaluation.py --api
```

The API mode checks that grounded answers have `sources`, that sources include `filename` and `page`, that citations appear in the answer text, and that no-context/no-selected-document questions do not produce unsupported answers.
