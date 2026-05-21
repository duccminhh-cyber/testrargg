import os
import logging
import time
import unicodedata
from dotenv import load_dotenv
load_dotenv()

from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import PyMuPDFLoader
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from sentence_transformers import CrossEncoder  # ✅ Thêm reranker

logger = logging.getLogger(__name__)

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
COLLECTION_NAME = os.getenv("QDRANT_COLLECTION_NAME", "rag_documents_v2")
GITHUB_TOKEN = os.getenv("GITHUB_MODELS_TOKEN") or os.getenv("GITHUB_TOKEN")
CHATGPT_MODEL = os.getenv("CHATGPT_MODEL", "openai/gpt-4.1")

AUTH_ERROR_MESSAGE = (
    "Dịch vụ AI chưa được cấu hình đúng. Hãy tạo GitHub token có quyền "
    "`models: read`, đặt vào biến GITHUB_MODELS_TOKEN trong file .env, rồi "
    "restart backend."
)

def is_auth_error(error: Exception) -> bool:
    err = str(error).lower()
    return "unauthorized" in err or "401" in err or "invalid api key" in err

def get_chat_llm(streaming: bool = False):
    if not GITHUB_TOKEN:
        raise RuntimeError(AUTH_ERROR_MESSAGE)
    return ChatOpenAI(
        model=CHATGPT_MODEL,
        api_key=GITHUB_TOKEN,
        base_url="https://models.github.ai/inference",
        streaming=streaming,
    )

_embeddings = None
_reranker = None  # ✅ Singleton reranker

def get_embeddings():
    global _embeddings
    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(model_name="keepitreal/vietnamese-sbert")
    return _embeddings

def get_reranker():
    """✅ Load reranker một lần, tái sử dụng — chạy được trên CPU"""
    global _reranker
    if _reranker is None:
        logger.info("⏳ Đang load reranker model...")
        # Model nhỏ ~80MB, chạy tốt trên CPU
        _reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
        logger.info("✅ Reranker đã sẵn sàng")
    return _reranker

def get_qdrant_client():
    return QdrantClient(url=QDRANT_URL)

def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFD", text or "")
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text.lower()

def is_document_summary_question(question: str) -> bool:
    q = normalize_text(question)
    summary_terms = ("ve cai gi", "noi dung", "tom tat", "la gi", "noi ve gi")
    doc_terms = ("file", "tai lieu", "pdf", "van ban")
    return any(term in q for term in doc_terms) and any(term in q for term in summary_terms)

def ensure_collection():
    try:
        client = get_qdrant_client()
        existing = [c.name for c in client.get_collections().collections]
        if COLLECTION_NAME not in existing:
            client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=768, distance=Distance.COSINE),
            )
            logger.info(f"✅ Đã tạo collection '{COLLECTION_NAME}'")
        else:
            logger.info(f"ℹ️ Collection '{COLLECTION_NAME}' đã tồn tại")
    except Exception as e:
        logger.error(f"❌ Không thể khởi tạo Qdrant collection: {e}")
        raise

def ingest_pdf(file_path: str, doc_id: int, filename: str):
    try:
        loader = PyMuPDFLoader(file_path)
        pages = loader.load()

        for page in pages:
            if "page" in page.metadata:
                page.metadata["page"] = page.metadata["page"] + 1

        # ✅ Cải tiến 1: chunk_size 800→1000, chunk_overlap 100→150
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=150
        )
        splits = splitter.split_documents(pages)

        for split in splits:
            split.metadata["doc_id"] = doc_id
            split.metadata["filename"] = filename

        vectorstore = QdrantVectorStore(
            client=get_qdrant_client(),
            collection_name=COLLECTION_NAME,
            embedding=get_embeddings(),
        )
        vectorstore.add_documents(splits)
        logger.info(f"✅ Ingest xong '{filename}' ({len(splits)} chunks)")

    except Exception as e:
        logger.error(f"❌ Lỗi ingest PDF '{filename}': {e}")
        raise

def delete_document_vectors(doc_id: int):
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        client = get_qdrant_client()
        client.delete(
            collection_name=COLLECTION_NAME,
            points_selector=Filter(
                must=[FieldCondition(key="metadata.doc_id", match=MatchValue(value=doc_id))]
            ),
        )
        logger.info(f"✅ Đã xóa vectors của doc_id={doc_id}")
    except Exception as e:
        logger.error(f"❌ Lỗi xóa vectors doc_id={doc_id}: {e}")
        raise

def query_rag(question: str, k: int = 5, chat_history: list = [], selected_doc_ids: list = None):
    max_retries = 3
    retry_delays = [20, 40, 60]

    for attempt in range(max_retries):
        try:
            summary_question = is_document_summary_question(question)
            vectorstore = QdrantVectorStore(
                client=get_qdrant_client(),
                collection_name=COLLECTION_NAME,
                embedding=get_embeddings(),
            )

            search_kwargs = {"k": 15}
            if not summary_question:
                search_kwargs["score_threshold"] = 0.4
            if selected_doc_ids:
                from qdrant_client.models import Filter, FieldCondition, MatchAny
                search_kwargs["filter"] = Filter(
                    must=[FieldCondition(key="metadata.doc_id", match=MatchAny(any=selected_doc_ids))]
                )

            retriever = vectorstore.as_retriever(
                search_type="similarity" if summary_question else "similarity_score_threshold",
                search_kwargs=search_kwargs
            )

            # ✅ Không cần streaming=True
            llm = get_chat_llm(streaming=False)

            def format_history(history):
                if not history: return ""
                return "\n".join([
                    f"{'Sinh viên' if m['role'] == 'user' else 'Trợ lý'}: {m['content']}"
                    for m in history
                ])

            prompt = ChatPromptTemplate.from_template(
                "Bạn là trợ lý học vụ thông minh của UET.\n\n"
                "LUẬT QUAN TRỌNG:\n"
                "1. Nếu câu hỏi là lời chào hoặc giao tiếp thông thường, hãy tự giới thiệu thân thiện.\n"
                "2. Với câu hỏi chuyên môn, trả lời chi tiết bằng Markdown DỰA HOÀN TOÀN VÀO NGỮ CẢNH.\n"
                "3. Nếu câu hỏi liên quan đến cuộc trò chuyện trước, dùng Lịch sử hội thoại để hiểu đúng ý.\n"
                "4. Nếu ngữ cảnh trống, hãy nói: 'Tôi chưa có thông tin về vấn đề này trong tài liệu hiện tại'.\n\n"
                "Lịch sử hội thoại gần đây:\n{history}\n\n"
                "Ngữ cảnh từ tài liệu:\n{context}\n\n"
                "Câu hỏi hiện tại: {question}"
            )

            retrieval_query = "tóm tắt nội dung chính của tài liệu" if summary_question else question
            retrieved_docs = retriever.invoke(retrieval_query)

            if summary_question and retrieved_docs:
                retrieved_docs = retrieved_docs[:k]
            elif retrieved_docs and len(retrieved_docs) > k:
                try:
                    reranker = get_reranker()
                    pairs = [[question, doc.page_content] for doc in retrieved_docs]
                    scores = reranker.predict(pairs)
                    ranked = [(score, doc) for score, doc in zip(scores, retrieved_docs) if score > 0]
                    ranked = sorted(ranked, key=lambda x: x[0], reverse=True)
                    retrieved_docs = [doc for _, doc in ranked[:k]]
                except Exception as re:
                    logger.warning(f"Rerank failed: {re}")
                    retrieved_docs = retrieved_docs[:k]
            elif retrieved_docs:
                retrieved_docs = retrieved_docs[:k]

            def format_docs(docs):
                if not docs: return ""
                return "\n\n---\n\n".join([
                    f"[Nguồn: {d.metadata.get('filename')}, Trang: {d.metadata.get('page')}]\nNội dung: {d.page_content}"
                    for d in docs
                ])

            chain = (
                {
                    "context": lambda _: format_docs(retrieved_docs),
                    "history": lambda _: format_history(chat_history),
                    "question": RunnablePassthrough()
                }
                | prompt
                | llm
            )
            response = chain.invoke(question)

            sources = []
            seen = set()
            for d in retrieved_docs:
                pair = (d.metadata.get("filename", "unknown"), d.metadata.get("page", "?"))
                if pair not in seen:
                    sources.append({"filename": pair[0], "page": pair[1]})
                    seen.add(pair)

            return {"answer": response.content, "sources": sources}

        except Exception as e:
            err_str = str(e)

            if "429" in err_str or "rate limit" in err_str.lower() or "quota" in err_str.lower():
                wait = retry_delays[attempt] if attempt < len(retry_delays) else 60
                logger.warning(f"⏳ Rate limit (lần {attempt+1}/{max_retries}), chờ {wait}s...")
                if attempt < max_retries - 1:
                    time.sleep(wait)
                    continue
                return {"answer": "⚠️ Hệ thống đang bận, vui lòng thử lại sau khoảng 1 phút.", "sources": []}

            elif is_auth_error(e):
                return {"answer": AUTH_ERROR_MESSAGE, "sources": []}

            elif "503" in err_str or "unavailable" in err_str.lower():
                wait = retry_delays[attempt] if attempt < len(retry_delays) else 60
                if attempt < max_retries - 1:
                    time.sleep(wait)
                    continue
                return {"answer": "⚠️ Dịch vụ AI tạm thời không khả dụng, vui lòng thử lại sau.", "sources": []}

            else:
                logger.error(f"❌ Lỗi query RAG: {e}")
                return {"answer": "⚠️ Hệ thống gặp sự cố, vui lòng thử lại sau.", "sources": []}
