import os
import json
from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
from prometheus_fastapi_instrumentator import Instrumentator

from models import Base, User, Document, IngestStatus, ChatMessage
from database import engine, SessionLocal, get_db
from services.minio_service import upload_file, delete_file, get_file_stream  # ✅ 1 dòng import duy nhất
from services.rag_service import query_rag, delete_document_vectors, ensure_collection
from celery_worker import ingest_document_task
import uuid

SECRET_KEY = os.getenv("SECRET_KEY", "supersecretkey")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

app = FastAPI(title="RAG API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app)

class UserRegister(BaseModel):
    username: str
    password: str

class ChatRequest(BaseModel):
    question: str

def verify_password(plain, hashed):
    return pwd_context.verify(plain, hashed)

def hash_password(password):
    return pwd_context.hash(password)

def create_token(data: dict):
    to_encode = data.copy()
    to_encode["exp"] = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

def require_admin(current_user: User = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    return current_user

# ── Auth Routes ───────────────────────────────────────────────
@app.post("/api/auth/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    token = create_token({"sub": user.username})
    return {"access_token": token, "token_type": "bearer", "is_admin": user.is_admin}

@app.post("/api/auth/register")
def register(user: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    new_user = User(username=user.username, hashed_password=hash_password(user.password))
    db.add(new_user)
    db.commit()
    return {"message": "User created successfully"}

# ── Chat Routes ───────────────────────────────────────────────
@app.post("/api/chat/query")
def chat_query(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is required")

    recent_messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == current_user.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(6)
        .all()
    )
    recent_messages = list(reversed(recent_messages))
    chat_history = [
        {"role": msg.role, "content": msg.content}
        for msg in recent_messages
    ]

    user_msg = ChatMessage(user_id=current_user.id, role="user", content=question)
    db.add(user_msg)

    result = query_rag(question, chat_history=chat_history)

    answer = result.get("answer", "")
    sources = result.get("sources", [])

    bot_msg = ChatMessage(
        user_id=current_user.id,
        role="bot",
        content=answer,
        sources=sources if sources else []
    )
    db.add(bot_msg)
    db.commit()

    return result

@app.get("/api/chat/history")
def get_chat_history(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == current_user.id)
        .order_by(ChatMessage.created_at.asc())
        .offset(skip).limit(limit)
        .all()
    )
    result = []
    for msg in messages:
        role = "assistant" if msg.role == "bot" else msg.role
        msg_dict = {
            "role": role,
            "content": msg.content or "",
        }
        if role == "assistant":
            msg_dict["sources"] = msg.sources if msg.sources else []
        result.append(msg_dict)
    return result

# ── Document Routes ───────────────────────────────────────────
@app.post("/api/documents/upload")
def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    content = file.file.read()
    safe_filename = os.path.basename(file.filename)
    minio_key = f"docs/{uuid.uuid4()}/{safe_filename}"
    upload_file(minio_key, content)

    doc = Document(
        filename=safe_filename,
        minio_key=minio_key,
        status=IngestStatus.pending,
        uploaded_by=current_user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    ingest_document_task.delay(doc.id)
    return {"id": doc.id, "filename": doc.filename, "status": doc.status}

@app.get("/api/documents")
def list_documents(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    docs = db.query(Document).offset(skip).limit(limit).all()
    return [
        {
            "id": d.id,
            "filename": d.filename,
            "status": d.status,
            "created_at": d.created_at,
            "error_message": d.error_message,
        }
        for d in docs
    ]

@app.get("/api/documents/{doc_id}/status")
def document_status(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"id": doc.id, "status": doc.status, "error_message": doc.error_message}

# ✅ by-filename PHẢI đặt TRƯỚC {doc_id}/file
@app.get("/api/documents/by-filename/{filename}")
def get_doc_by_filename(
    filename: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(Document.filename == filename).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"id": doc.id, "filename": doc.filename}

@app.get("/api/documents/{doc_id}/file")
def get_document_file(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        file_stream = get_file_stream(doc.minio_key)
        return StreamingResponse(
            file_stream,
            media_type="application/pdf",
            # ✅ Bỏ filename đi hoàn toàn — iframe không cần tên file
            headers={"Content-Disposition": "inline"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể tải file: {str(e)}")

@app.delete("/api/documents/{doc_id}")
def delete_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.status == IngestStatus.processing:
        raise HTTPException(status_code=400, detail="Tài liệu đang được xử lý, không thể xóa lúc này.")
    delete_file(doc.minio_key)
    delete_document_vectors(doc_id)
    db.delete(doc)
    db.commit()
    return {"message": "Deleted"}

# ── Admin Routes ──────────────────────────────────────────────
@app.get("/api/admin/users")
def list_users(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    users = db.query(User).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "is_admin": u.is_admin,
            "created_at": u.created_at,
        }
        for u in users
    ]

@app.post("/api/admin/users")
def create_user(body: dict, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    username = body.get("username")
    password = body.get("password")
    is_admin = body.get("is_admin", False)
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    user = User(
        username=username,
        hashed_password=hash_password(password),
        is_admin=is_admin,
    )
    db.add(user)
    db.commit()
    return {"message": "User created"}

@app.delete("/api/admin/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.username == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete default admin")
    try:
        db.query(ChatMessage).filter(ChatMessage.user_id == user_id).delete()
        user_docs = db.query(Document).filter(Document.uploaded_by == user_id).all()
        for doc in user_docs:
            delete_file(doc.minio_key)
            delete_document_vectors(doc.id)
            db.delete(doc)
        db.delete(user)
        db.commit()
        return {"message": "Deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Lỗi hệ thống khi xóa user: {str(e)}")

# ── Startup ───────────────────────────────────────────────────
@app.on_event("startup")
def startup_event():
    """Khởi tạo DB, Qdrant collection và tài khoản admin mặc định."""
    Base.metadata.create_all(bind=engine)
    ensure_collection()
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.username == "admin").first():
            admin = User(
                username="admin",
                hashed_password=hash_password("admin123"),
                is_admin=True,
            )
            db.add(admin)
            db.commit()
    finally:
        db.close()