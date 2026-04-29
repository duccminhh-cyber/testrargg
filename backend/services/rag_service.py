import os
from dotenv import load_dotenv
load_dotenv()

from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import PyMuPDFLoader 
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough

# Đổi qdrant thành localhost
QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
COLLECTION_NAME = os.getenv("QDRANT_COLLECTION_NAME", "rag_documents_v2")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

_embeddings = None

def get_embeddings():
    global _embeddings
    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(model_name="keepitreal/vietnamese-sbert")
    return _embeddings

def get_qdrant_client():
    return QdrantClient(url=QDRANT_URL)

def ensure_collection():
    client = get_qdrant_client()
    existing = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME not in existing:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=768, distance=Distance.COSINE),
        )

def ingest_pdf(file_path: str, doc_id: int, filename: str):
    # ĐÃ BỎ ensure_collection() Ở ĐÂY ĐỂ TỐI ƯU
    loader = PyMuPDFLoader(file_path)
    pages = loader.load()
    
    for page in pages:
        if "page" in page.metadata:
            page.metadata["page"] = page.metadata["page"] + 1

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
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

def delete_document_vectors(doc_id: int):
    from qdrant_client.models import Filter, FieldCondition, MatchValue
    client = get_qdrant_client()
    client.delete(
        collection_name=COLLECTION_NAME,
        points_selector=Filter(
            must=[FieldCondition(key="metadata.doc_id", match=MatchValue(value=doc_id))]
        ),
    )

def query_rag(question: str, k: int = 3):
    # ĐÃ BỎ ensure_collection() Ở ĐÂY ĐỂ TRÁNH LAG KHI CHAT
    vectorstore = QdrantVectorStore(
        client=get_qdrant_client(),
        collection_name=COLLECTION_NAME,
        embedding=get_embeddings(),
    )
    retriever = vectorstore.as_retriever(search_kwargs={"k": k})

    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=GOOGLE_API_KEY
    )

    prompt = ChatPromptTemplate.from_template(
        "Bạn là trợ lý học vụ thông minh của UET.\n"
        "Hãy trả lời câu hỏi dựa trên ngữ cảnh được cung cấp một cách chi tiết và trình bày đẹp bằng Markdown (sử dụng list, in đậm, hoặc bảng nếu cần).\n"
        "Nếu thông tin không có trong ngữ cảnh, hãy nói 'Tôi không tìm thấy thông tin này trong tài liệu'.\n\n"
        "Ngữ cảnh (Context):\n{context}\n\n"
        "Câu hỏi: {question}"
    )

    retrieved_docs = retriever.invoke(question)

    def format_docs(docs):
        formatted = []
        for doc in docs:
            f = f"[Nguồn: {doc.metadata.get('filename')}, Trang: {doc.metadata.get('page')}]\nNội dung: {doc.page_content}"
            formatted.append(f)
        return "\n\n---\n\n".join(formatted)

    chain = (
        {"context": lambda _: format_docs(retrieved_docs), "question": RunnablePassthrough()}
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