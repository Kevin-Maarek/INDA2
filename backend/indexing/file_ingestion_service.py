import os
import pandas as pd
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance
from openai import OpenAI
from typing import List
import logging
import math
import time

# ========================
# LOGGING
# ========================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("INGEST")


# ========================
# CONFIG
# ========================

QDRANT_URL = "http://localhost:6333"
QDRANT_COLLECTION = "feedback_vectors"

EMBED_MODEL = "nvidia/llama-3.2-nemoretriever-300m-embed-v2"
NVIDIA_API_KEY = "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"
EMBED_BASE_URL = "https://integrate.api.nvidia.com/v1"

BATCH_SIZE_EMBEDDING = 16       # כמה טקסטים בבת אחת ל-NVIDIA
SLEEP_BETWEEN_BATCHES = 0.25    # הגנה מ-Rate Limit
# שים לב: Qdrant insertion קורה אחרי כל batch, לא אחרי כל הקובץ.


# ========================
# CLIENTS
# ========================

client = OpenAI(api_key=NVIDIA_API_KEY, base_url=EMBED_BASE_URL)
qdrant = QdrantClient(url=QDRANT_URL)

app = FastAPI(title="File Ingestion Service")


# ========================
# UTIL FUNCTIONS
# ========================

def get_embeddings_batch(texts: List[str]) -> List[List[float]]:
    """
    EMBEDDING BATCH MODE:
    מקבל רשימה של טקסטים → מחזיר רשימת וקטורים.
    """
    logger.info(f"Requesting embedding batch of size {len(texts)}")

    resp = client.embeddings.create(
        model=EMBED_MODEL,
        input=texts,
        encoding_format="float",
        extra_body={"input_type": "passage"}
    )

    # הגנה מול NVIDIA rate limit
    time.sleep(SLEEP_BETWEEN_BATCHES)

    return [d.embedding for d in resp.data]


def split_email_format(service_name: str):
    try:
        before = service_name.split("@")[0]
        after = service_name.split("@")[1].split(".")[0]
        return before, after
    except:
        return "", ""


def build_payload(row):
    return {
        "ID": row["ID"],
        "Level": row["Level"],
        "Text": row["Text"],
        "service": row["service"],
        "office": row["office"]
    }


def build_embedding_text(row):
    return (
        f"ציון: {row['Level']}\n"
        f"שירות: {row['service']}\n"
        f"משרד: {row['office']}\n"
        f"פידבק: {row['Text']}"
    )


def ensure_collection(dim: int):
    try:
        qdrant.get_collection(QDRANT_COLLECTION)
        return
    except:
        pass

    logger.info(f"Creating Qdrant collection {QDRANT_COLLECTION} (dim={dim})")

    qdrant.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(size=dim, distance=Distance.COSINE)
    )


# ========================
# API ROUTE
# ========================

@app.post("/upload_csv")
async def upload_csv(file: UploadFile = File(...)):
    logger.info(f"Received file: {file.filename}")

    try:
        df = pd.read_csv(file.file)
        logger.info(f"Loaded CSV: {df.shape[0]} rows")
    except Exception as e:
        return JSONResponse({"error": f"CSV load failed: {e}"}, status_code=400)

    # Required columns
    for col in ["ID", "Level", "Text", "ServiceName"]:
        if col not in df.columns:
            return JSONResponse({"error": f"Missing column: {col}"}, status_code=400)

    # Split service/office
    df["service"], df["office"] = zip(*df["ServiceName"].apply(split_email_format))
    df = df[["ID", "Level", "Text", "service", "office"]]

    # Build text for embedding
    df["embedding_text"] = df.apply(build_embedding_text, axis=1)

    total_rows = len(df)
    logger.info(f"Preparing embeddings for {total_rows} rows...")

    vector_dim = None
    total_inserted = 0

    # ITERATE streaming batches
    for batch_start in range(0, total_rows, BATCH_SIZE_EMBEDDING):

        batch_end = batch_start + BATCH_SIZE_EMBEDDING
        batch_df = df.iloc[batch_start:batch_end]

        batch_texts = batch_df["embedding_text"].tolist()
        batch_vectors = get_embeddings_batch(batch_texts)

        # Initialize collection on first embedding
        if vector_dim is None:
            vector_dim = len(batch_vectors[0])
            ensure_collection(vector_dim)
            logger.info(f"Collection ensured with dim={vector_dim}")

        # Build Qdrant Points
        points = []
        for i, (idx, row) in enumerate(batch_df.iterrows()):
            vector = batch_vectors[i]
            payload = build_payload(row)

            points.append(
                PointStruct(
                    id=str(row["ID"]),
                    vector=vector,
                    payload=payload
                )
            )

        # Insert batch to Qdrant
        qdrant.upsert(collection_name=QDRANT_COLLECTION, points=points)
        total_inserted += len(points)

        logger.info(f"Inserted {total_inserted}/{total_rows}")

    logger.info(f"✔ Ingestion complete. Total inserted: {total_inserted}")
    return {"status": "success", "inserted": total_inserted}
