import os
import logging
import time
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
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
CHATGPT_MODEL = os.getenv("CHATGPT_MODEL", "openai/gpt-4.1")

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
            vectorstore = QdrantVectorStore(
                client=get_qdrant_client(),
                collection_name=COLLECTION_NAME,
                embedding=get_embeddings(),
            )

            # ✅ Cải tiến: Hỗ trợ lọc theo file (NotebookLM style)
            search_kwargs = {"k": 15, "score_threshold": 0.4}
            if selected_doc_ids:
                from qdrant_client.models import Filter, FieldCondition, MatchAny
                search_kwargs["filter"] = Filter(
                    must=[
                        FieldCondition(
                            key="metadata.doc_id",
                            match=MatchAny(any=selected_doc_ids)
                        )
                    ]
                )

            retriever = vectorstore.as_retriever(
                search_type="similarity_score_threshold",
                search_kwargs=search_kwargs
            )

            llm = ChatOpenAI(
                model=CHATGPT_MODEL,
                api_key=GITHUB_TOKEN,
                base_url="https://models.github.ai/inference",
            )

            def format_history(history):
                if not history:
                    return ""
                lines = []
                for msg in history:
                    role = "Sinh viên" if msg["role"] == "user" else "Trợ lý"
                    lines.append(f"{role}: {msg['content']}")
                return "\n".join(lines)

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

            # Lấy docs từ Qdrant
            retrieved_docs = retriever.invoke(question)

            # ✅ Cải tiến 3: Reranking — chỉ giữ top k docs liên quan nhất
            if retrieved_docs and len(retrieved_docs) > k:
                try:
                    reranker = get_reranker()
                    pairs = [[question, doc.page_content] for doc in retrieved_docs]
                    scores = reranker.predict(pairs)
                    # Lọc bỏ các doc rác (điểm rerank < 0) và lấy top k
                    ranked = [(score, doc) for score, doc in zip(scores, retrieved_docs) if score > 0]
                    ranked = sorted(ranked, key=lambda x: x[0], reverse=True)
                    retrieved_docs = [doc for _, doc in ranked[:k]]
                    logger.info(f"✅ Reranked: {len(pairs)} → {len(retrieved_docs)} docs")
                except Exception as re:
                    logger.warning(f"⚠️ Rerank thất bại, dùng top {k} mặc định: {re}")
                    retrieved_docs = retrieved_docs[:k]
            elif retrieved_docs:
                retrieved_docs = retrieved_docs[:k]

            # Không có docs liên quan → trả lời ngay không cần gọi LLM
            if not retrieved_docs:
                chain = (
                    {
                        "context": lambda _: "",
                        "history": lambda _: format_history(chat_history),
                        "question": RunnablePassthrough()
                    }
                    | prompt
                    | llm
                )
                response = chain.invoke(question)
                return {"answer": response.content, "sources": []}

            def format_docs(docs):
                if not docs:
                    return ""
                formatted = []
                for doc in docs:
                    f = f"[Nguồn: {doc.metadata.get('filename')}, Trang: {doc.metadata.get('page')}]\nNội dung: {doc.page_content}"
                    formatted.append(f)
                return "\n\n---\n\n".join(formatted)

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

            sources = [
                {"filename": doc.metadata.get("filename", "unknown"), "page": doc.metadata.get("page", "?")}
                for doc in retrieved_docs
            ]
            unique_sources = []
            seen = set()
            for s in sources:
                pair = (s['filename'], s['page'])
                if pair not in seen:
                    unique_sources.append(s)
                    seen.add(pair)

            return {"answer": response.content, "sources": unique_sources}

        except Exception as e:
            err_str = str(e)

            if "429" in err_str or "rate limit" in err_str.lower() or "quota" in err_str.lower():
                wait = retry_delays[attempt] if attempt < len(retry_delays) else 60
                logger.warning(f"⏳ Rate limit (lần {attempt+1}/{max_retries}), chờ {wait}s...")
                if attempt < max_retries - 1:
                    time.sleep(wait)
                    continue
                return {
                    "answer": "⚠️ Hệ thống đang bận, vui lòng thử lại sau khoảng 1 phút.",
                    "sources": []
                }

            elif "503" in err_str or "unavailable" in err_str.lower():
                wait = retry_delays[attempt] if attempt < len(retry_delays) else 60
                logger.warning(f"⏳ Server 503 (lần {attempt+1}/{max_retries}), chờ {wait}s...")
                if attempt < max_retries - 1:
                    time.sleep(wait)
                    continue
                return {
                    "answer": "⚠️ Dịch vụ AI tạm thời không khả dụng, vui lòng thử lại sau.",
                    "sources": []
                }

            else:
                logger.error(f"❌ Lỗi query RAG: {e}")
                return {
                    "answer": "⚠️ Hệ thống gặp sự cố, vui lòng thử lại sau.",
                    "sources": []
                }

def query_rag_stream(question: str, k: int = 5, chat_history: list = [], selected_doc_ids: list = None):
    import json
    
    yield json.dumps({"type": "status", "data": "🔍 Đang tìm kiếm tài liệu..."}) + "\n"
    
    try:
        vectorstore = QdrantVectorStore(
            client=get_qdrant_client(),
            collection_name=COLLECTION_NAME,
            embedding=get_embeddings(),
        )

        search_kwargs = {"k": 15, "score_threshold": 0.4}
        if selected_doc_ids:
            from qdrant_client.models import Filter, FieldCondition, MatchAny
            search_kwargs["filter"] = Filter(
                must=[FieldCondition(key="metadata.doc_id", match=MatchAny(any=selected_doc_ids))]
            )

        retriever = vectorstore.as_retriever(
            search_type="similarity_score_threshold",
            search_kwargs=search_kwargs
        )

        llm = ChatOpenAI(
            model=CHATGPT_MODEL,
            api_key=GITHUB_TOKEN,
            base_url="https://models.github.ai/inference",
            streaming=True # Quan trọng để stream
        )

        def format_history(history):
            if not history: return ""
            return "\n".join([f"{'Sinh viên' if m['role']=='user' else 'Trợ lý'}: {m['content']}" for m in history])

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

        retrieved_docs = retriever.invoke(question)
        yield json.dumps({"type": "status", "data": f"📑 Tìm thấy {len(retrieved_docs)} đoạn tài liệu có thể liên quan..."}) + "\n"

        if retrieved_docs and len(retrieved_docs) > k:
            yield json.dumps({"type": "status", "data": "⚙️ Đang phân tích và lọc độ phù hợp (Reranking)..."}) + "\n"
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
            return "\n\n---\n\n".join([f"[Nguồn: {d.metadata.get('filename')}, Trang: {d.metadata.get('page')}]\nNội dung: {d.page_content}" for d in docs])

        sources = [{"filename": d.metadata.get("filename", "unknown"), "page": d.metadata.get("page", "?")} for d in retrieved_docs]
        unique_sources = []
        seen = set()
        for s in sources:
            pair = (s['filename'], s['page'])
            if pair not in seen:
                unique_sources.append(s)
                seen.add(pair)
                
        yield json.dumps({"type": "sources", "data": unique_sources}) + "\n"
        
        if not retrieved_docs:
            yield json.dumps({"type": "status", "data": "💬 Đang trả lời (Giao tiếp thông thường)..."}) + "\n"
        else:
            yield json.dumps({"type": "status", "data": "💡 Đang tổng hợp câu trả lời từ tài liệu..."}) + "\n"

        chain = (
            {
                "context": lambda _: format_docs(retrieved_docs),
                "history": lambda _: format_history(chat_history),
                "question": RunnablePassthrough()
            }
            | prompt
            | llm
        )

        for chunk in chain.stream(question):
            yield json.dumps({"type": "chunk", "data": chunk.content}) + "\n"

    except Exception as e:
        logger.error(f"Streaming error: {e}")
        yield json.dumps({"type": "error", "data": str(e)}) + "\n"