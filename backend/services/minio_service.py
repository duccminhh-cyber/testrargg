import os
import io
from dotenv import load_dotenv
load_dotenv()
from minio import Minio
from minio.error import S3Error

# Sửa thành localhost và chuẩn pass minioadmin123
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin123")
BUCKET_NAME = os.getenv("MINIO_BUCKET_NAME", "documents")

def get_minio_client():
    return Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=False, # Vì chạy local không có HTTPS
    )

def ensure_bucket():
    client = get_minio_client()
    if not client.bucket_exists(BUCKET_NAME):
        client.make_bucket(BUCKET_NAME)

def upload_file(key: str, data: bytes, content_type: str = "application/pdf"):
    ensure_bucket()
    client = get_minio_client()
    client.put_object(
        BUCKET_NAME, key,
        data=io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )

def download_file(key: str) -> bytes:
    client = get_minio_client()
    response = client.get_object(BUCKET_NAME, key)
    return response.read()

def delete_file(key: str):
    try:
        client = get_minio_client()
        client.remove_object(BUCKET_NAME, key)
    except S3Error as e:
        print(f"Lỗi khi xóa file: {e}")

def download_file_to_path(key: str, file_path: str):
    client = get_minio_client()
    client.fget_object(BUCKET_NAME, key, file_path)