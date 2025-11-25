# utils.py
from typing import List, Dict, Any
import json
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, Range, MatchValue
from openai import OpenAI

# =====================
#  CONFIG
# =====================

QDRANT_URL = "http://localhost:6333"
QDRANT_COLLECTION = "feedback_vectors"

# NVIDIA / LLM config
NVIDIA_API_KEY = "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"
LLM_MODEL = "meta/llama-4-maverick-17b-128e-instruct"
EMBED_MODEL = "nvidia/llama-3.2-nemoretriever-300m-embed-v2"
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"

# =====================
#  CLIENTS
# =====================

client = QdrantClient(url=QDRANT_URL)
llm = OpenAI(api_key=NVIDIA_API_KEY, base_url=NVIDIA_BASE_URL)


# =========================================================
# NVIDIA / LLM
# =========================================================

def embed(text: str) -> List[float]:
    """
    Returns an embedding vector for the given text.
    """
    v = llm.embeddings.create(
        model=EMBED_MODEL,
        input=[text],
        encoding_format="float",
        extra_body={"input_type": "query"},
    )
    return v.data[0].embedding


def ask_llm(system_prompt: str, user_prompt: str, max_tokens: int = 3000):
    response = llm.chat.completions.create(
        model=LLM_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.2,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content.strip()


# =========================================================
# SEARCH IN QDRANT
# =========================================================
def search_feedback(vector, limit=200) -> List[Dict[str, Any]]:
    """Semantic search returning list of records {score,payload}."""
    results = client.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=vector,
        limit=limit
    )
    final = []
    for r in results:
        final.append({
            "score": float(r.score),
            "payload": dict(r.payload)
        })
    return final


def filter_by_rating(min_rating: int, max_rating: int = None, limit=200):
    if max_rating is None:
        max_rating = min_rating

    hits = client.scroll(
        collection_name=QDRANT_COLLECTION,
        scroll_filter={
            "must": [{
                "range": {
                    "Level": {
                        "gte": min_rating,
                        "lte": max_rating
                    }
                }
            }]
        },
        limit=limit
    )[0]

    return [dict(h.payload) for h in hits]



def trim_text_list(texts, max_tokens=70000):
    """
    Cuts text list so that total estimated tokens <= max_tokens.
    Token estimate: ~4 chars per token (very safe for Hebrew).
    """
    trimmed = []
    total_chars = 0
    max_chars = max_tokens * 4  # conservative rule: 4 chars ≈ 1 token

    for t in texts:
        if t is None:
            continue
        if total_chars + len(t) > max_chars:
            break
        trimmed.append(t)
        total_chars += len(t)

    return trimmed


# =========================================================
# DYNAMIC CUTOFF WITH LLM FILTERING
# =========================================================
LLM_FILTER_PROMPT = """
You are an LLM performing STRICT semantic filtering.

INPUT YOU RECEIVE:
1. A user query.
2. A ranked list of feedback items AFTER an engineering-based cutoff.
   That means the list you see is already the most relevant subset.
   Your job is to remove items that are STILL off-topic.

INSTRUCTIONS:
- Identify which items are NOT relevant to the query.
- Relevance must be based ONLY on meaning.
- Ignore the similarity score except as a hint.
- Be strict. If only one item is truly relevant, keep that one.
- Return ONLY a Python list of integers — the 1-based indices to remove.
- No explanations. No markdown. No extra text.

Examples of valid outputs:
[3,7,11]
[]
[1]

BEGIN.
"""

from typing import List, Dict, Any

def trim_lines_safe(lines, max_tokens=70000):
    """
    Cuts ranked lines so that total estimated tokens <= max_tokens.
    Uses 4 chars ≈ 1 token heuristic for Hebrew.
    """
    trimmed = []
    total_chars = 0
    max_chars = max_tokens * 4

    for line in lines:
        if total_chars + len(line) > max_chars:
            break
        trimmed.append(line)
        total_chars += len(line)

    return trimmed


def dynamic_cutoff(
    query: str,
    results: List[Dict[str, Any]],
    min_keep: int = 3,
    drop_ratio: float = 0.02
) -> List[Dict[str, Any]]:

    n = len(results)
    if n == 0:
        return []

    # ========= FIRST PASS: ENGINEERING CUTOFF =========
    scores = [float(r["score"]) for r in results]
    cutoff = n

    for i in range(1, n):
        prev = scores[i - 1]
        curr = scores[i]
        if prev == 0:
            continue

        drop = (prev - curr) / prev
        if drop > drop_ratio and i >= min_keep:
            cutoff = i
            break

    initial_filtered = results[:cutoff]

    if len(initial_filtered) < min_keep:
        initial_filtered = results[:min_keep]

    print("Initial Filtered Results after Engineering Cutoff:", initial_filtered)

    # ========= SECOND PASS: LLM RANK FILTER =========
    lines = []
    for idx, r in enumerate(initial_filtered, start=1):
        text = r["payload"].get("Text", "").replace("\n", " ").strip()
        score = r["score"]
        lines.append(f"{idx}. [score={score:.3f}] {text}")

    # keep LLM safe (prevent token overflow)
    safe_lines = trim_lines_safe(lines, max_tokens=60000)
    ranked_block = "\n".join(safe_lines)

    system_prompt = (
        "You are a strict semantic relevance filter for vector search results.\n"
        "Your task:\n"
        "Given a ranked list of feedback items, decide which indices should be removed "
        "because they are NOT semantically relevant to the user query.\n\n"
        "Rules:\n"
        "- You must return ONLY a valid Python list of integers (e.g., [1, 3]).\n"
        "- Do NOT return explanations, markdown, or additional text.\n"
        "- Each index refers to the 1-based index in the ranked list.\n"
        "- If all items are relevant, return [].\n"
        "- Remove only items that clearly do not match the semantic meaning of the query.\n"
    )

    user_prompt = (
        f"User query:\n{query}\n\n"
        f"Ranked search results:\n{ranked_block}\n\n"
        "Return a Python list of indexes to remove. "
        "If none should be removed, return []."
    )

    llm_answer = ask_llm(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=100
    )

    # ========= PARSE OUTPUT =========
    try:
        remove_indices = eval(llm_answer)
        if not isinstance(remove_indices, list):
            remove_indices = []
    except:
        remove_indices = []

    final_filtered = [
        r for idx, r in enumerate(initial_filtered, start=1)
        if idx not in remove_indices
    ]

    if len(final_filtered) < min_keep:
        final_filtered = initial_filtered[:min_keep]

    return final_filtered


# נניח שכבר יש לך:
# qdrant = QdrantClient(...)
# QDRANT_COLLECTION = "feedback_vectors"

def get_all_feedback(limit: int = 5000) -> List[Dict[str, Any]]:
    """
    מחזיר עד `limit` פידבקים מה-collection,
    בפורמט זהה ל-search_feedback:
    [
      {
        "score": float,      # כאן נשים 1.0 כי אין חיפוש סמנטי
        "payload": {
            "ID": ...,
            "Text": ...,
            "Level": ...,
            "service": ...,
            "office": ...
        }
      },
      ...
    ]
    """
    all_results: List[Dict[str, Any]] = []
    offset = None
    page_size = 256
    remaining = limit

    while remaining > 0:
        batch_limit = min(page_size, remaining)
        points, offset = client.scroll(
            collection_name=QDRANT_COLLECTION,
            limit=batch_limit,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )

        if not points:
            break

        for p in points:
            # p.payload הוא ה-payload המקורי ששמרת באינדוקס
            all_results.append(
                {
                    "score": 1.0,       # אין ציון סמנטי – נותנים קבוע
                    "payload": p.payload
                }
            )

        remaining -= len(points)
        if offset is None:
            break

    return all_results
