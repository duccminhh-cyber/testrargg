import os
import tempfile
from dotenv import load_dotenv
load_dotenv()
from celery import Celery
from models import Document, IngestStatus
from services.rag_service import ingest_pdf
from services.minio_service import download_file_to_path
from database import SessionLocal

# Quan trọng: Đổi redis thành localhost
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery("worker", broker=REDIS_URL, backend=REDIS_URL)

@celery_app.task(name="ingest_document")
def ingest_document_task(doc_id: int):
    db = SessionLocal()
    tmp_path = None
    
    try:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if not doc: return

        doc.status = IngestStatus.processing
        db.commit()

        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp_path = tmp.name

        download_file_to_path(doc.minio_key, tmp_path)
        ingest_pdf(file_path=tmp_path, doc_id=doc_id, filename=doc.filename)

        doc.status = IngestStatus.done
        db.commit()

    except Exception as e:
        doc.status = IngestStatus.error
        doc.error_message = str(e)
        db.commit()
        print(f"Lỗi băm file trong Celery: {e}") 
        raise  
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)
        db.close()