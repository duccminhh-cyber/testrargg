from sqlalchemy import Column, Integer, String, DateTime, Enum, Boolean, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
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
    created_at = Column(DateTime, default=datetime.utcnow)

class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String)
    minio_key = Column(String)          # đường dẫn trong MinIO
    status = Column(Enum(IngestStatus), default=IngestStatus.pending)
    uploaded_by = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    error_message = Column(String, nullable=True)
class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True, index=True)
    
    # DÒNG MỚI THÊM VÀO: Khóa ngoại nối với bảng users
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True) 
    
    role = Column(String)
    content = Column(String)
    sources = Column(String, nullable=True) # Nhớ có nullable=True
    created_at = Column(DateTime, default=datetime.utcnow)