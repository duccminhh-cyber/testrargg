from sqlalchemy import Column, Integer, String, DateTime, Enum, Boolean, ForeignKey, Text
from sqlalchemy.orm import declarative_base  # ✅ Sửa import deprecated
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime, timezone  # ✅ Thêm timezone
import enum

Base = declarative_base()

class IngestStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    done = "done"
    error = "error"

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))  # ✅ Sửa utcnow

class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    minio_key = Column(String)
    status = Column(Enum(IngestStatus), default=IngestStatus.pending)
    uploaded_by = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))  # ✅ Sửa utcnow
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))  # ✅ Sửa utcnow
    error_message = Column(String, nullable=True)

class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title = Column(String, nullable=False)
    selected_docs = Column(JSONB, default=[])  # Lưu trữ các file nguồn được chọn cho phiên chat này
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id", ondelete="CASCADE"), index=True, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role = Column(String)
    content = Column(Text)  # ✅ Dùng Text thay String cho nội dung dài
    sources = Column(JSONB, nullable=True)  # ✅ Dùng JSONB thay String thô
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))  # ✅ Sửa utcnow