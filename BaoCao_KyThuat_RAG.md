# BÁO CÁO KỸ THUẬT DỰ ÁN RAG (Retrieval-Augmented Generation)

Báo cáo này mô tả chi tiết toàn bộ kiến trúc, các công nghệ được sử dụng, cũng như luồng hoạt động (Data Flow) của hệ thống RAG phục vụ hỏi đáp thông minh dựa trên tài liệu. 

---

## 1. TỔNG QUAN KIẾN TRÚC HỆ THỐNG (SYSTEM ARCHITECTURE)

Hệ thống được thiết kế theo kiến trúc **Microservices** và triển khai hoàn toàn bằng **Docker (Docker Compose)**, đảm bảo tính khả dụng cao, dễ mở rộng và đóng gói gọn gàng.

Kiến trúc bao gồm các cụm (clusters) chính:
- **Cụm Cửa ngõ (Entry Point & Proxy):** Nginx, Cloudflare Tunnel.
- **Cụm Frontend (Giao diện người dùng):** ReactJS, Vite.
- **Cụm Backend (Xử lý Core & API):** FastAPI, Celery Worker.
- **Cụm Lưu trữ & CSDL (Storage & Database):** PostgreSQL (RDBMS), Qdrant (VectorDB), MinIO (Object Storage), Redis (Message Broker/Cache).
- **Cụm Giám sát (Monitoring):** Prometheus, Grafana.
- **Dịch vụ AI bên ngoài:** LLM (Google Gemini 2.5 Flash).

---

## 2. CHI TIẾT CÁC CÔNG NGHỆ VÀ MODULE (TECHNOLOGY STACK)

### 2.1. Frontend (Giao diện Người dùng)
- **Công nghệ cốt lõi:** React 19, Vite.
- **Thư viện hỗ trợ:**
  - `react-router-dom`: Quản lý định tuyến (Routing) cho SPA (Single Page Application).
  - `react-markdown` & `remark-gfm`: Render câu trả lời dạng Markdown của LLM một cách đẹp mắt (hỗ trợ bảng biểu, in đậm, danh sách).
- **Vai trò:** Cung cấp giao diện Web trực quan. Phân tách rõ ràng giữa giao diện User (để hỏi đáp/chat) và Admin (để quản trị User, upload và giám sát trạng thái tài liệu PDF). Nginx đóng vai trò phục vụ các file tĩnh (static files) đã được build qua file cấu hình `nginx-spa.conf`.

### 2.2. Backend API (Xử lý logic & API)
- **Công nghệ cốt lõi:** Python 3, FastAPI.
- **Web Server:** Uvicorn (ASGI server chuẩn cho FastAPI).
- **Tính năng nổi bật:**
  - **Bảo mật (Auth):** Xác thực người dùng bằng JWT (JSON Web Tokens) thông qua thư viện `python-jose`, bảo mật mật khẩu lưu trong DB bằng thuật toán băm bcrypt (`passlib[bcrypt]`).
  - **Tương tác CSDL:** Sử dụng `SQLAlchemy` làm ORM (Object-Relational Mapping) giúp tương tác an toàn với PostgreSQL, chống SQL Injection.

### 2.3. Background Task & Message Broker (Hàng đợi & Xử lý nền)
- **Công nghệ:** Celery (Worker) + Redis (Broker).
- **Vai trò:** Xử lý tài liệu (Ingest Document) là một tác vụ nặng tốn nhiều CPU và thời gian. Khi Admin upload PDF, Backend chỉ đơn giản tạo một task và đẩy vào **Redis**. **Celery Worker** sẽ lấy task này và âm thầm chạy ngầm. Thiết kế này giúp API không bị "treo" (block), tăng cường trải nghiệm người dùng đáng kể.

### 2.4. Storage & Databases (Hệ thống Lưu trữ)
Hệ thống sử dụng 3 loại lưu trữ chuyên biệt:
1. **PostgreSQL (v15 - Alpine):** Cơ sở dữ liệu quan hệ chính (RDBMS). Lưu trữ thông tin: Users (tài khoản, quyền), ChatMessages (lịch sử chat, sources tham khảo), Documents (thông tin quản lý file như filename, minio_key, trạng thái xử lý).
2. **MinIO (S3-compatible Object Storage):** Nơi lưu trữ vật lý các file PDF được tải lên. Việc sử dụng Object Storage giúp cô lập dữ liệu file khỏi hệ điều hành, dễ dàng backup và mở rộng (Scale Out).
3. **Qdrant:** Cơ sở dữ liệu Vector (Vector Database). Dùng để lưu trữ hàng nghìn Vector Embeddings của các đoạn văn bản (chunks). Qdrant hỗ trợ tính toán khoảng cách vector (Cosine Distance) cực kỳ nhanh chóng.

### 2.5. AI & RAG Core Engine (Trái tim của hệ thống AI)
Toàn bộ logic RAG được xây dựng trên bộ khung (framework) **LangChain**.
- **Trích xuất dữ liệu (PDF Parsing):** Sử dụng `PyMuPDFLoader` (dựa trên pymupdf) để bóc tách text từ PDF chính xác, đặc biệt bảo toàn tốt định dạng và hỗ trợ lấy số trang (page metadata).
- **Cắt đoạn văn bản (Chunking):** Sử dụng `RecursiveCharacterTextSplitter` chia nhỏ văn bản với `chunk_size = 800` ký tự và `chunk_overlap = 100` ký tự, đảm bảo khi chia cắt không bị mất ngữ nghĩa liên kết giữa các câu.
- **Mô hình nhúng (Embedding Model):** Chạy cục bộ bằng HuggingFace với mô hình `keepitreal/vietnamese-sbert`. Đây là mô hình tinh chỉnh riêng cho Tiếng Việt, xuất ra các vector chuẩn có chiều `size = 768`.
- **Tìm kiếm (Retrieval):** Tìm kiếm top 3 (`k = 3`) đoạn văn bản có độ tương đồng ngữ nghĩa (Cosine Similarity) cao nhất với câu hỏi người dùng thông qua Qdrant.
- **Mô hình Ngôn ngữ (LLM):** `ChatGoogleGenerativeAI` gọi API của **Gemini 2.5 Flash**. Prompt (Câu lệnh) được thiết kế đặc biệt: Giao vai "Trợ lý học vụ UET", yêu cầu trả lời đẹp bằng Markdown, và **bắt buộc** phải trả lời dựa trên Context được nhồi vào. Nếu Context không có thông tin, bot phải thừa nhận không biết, giúp ngăn chặn hiện tượng ảo giác (Hallucination).

### 2.6. Infrastructure & Monitoring (Hạ tầng và Giám sát)
- **Nginx (Load Balancer & API Gateway):** Lắng nghe ở cổng 80 duy nhất. Điều hướng traffic: URL bắt đầu bằng `/api/` sẽ đi tới Backend FastAPI, các URL còn lại đi vào Frontend React.
- **Cloudflare Tunnel:** Expose an toàn toàn bộ hệ thống cục bộ ra mạng Internet mà không cần phải NAT Port trên Router hoặc thiết lập cấu hình Firewall phức tạp.
- **Prometheus & Grafana:** Tích hợp `prometheus-fastapi-instrumentator` vào code FastAPI để sinh ra các Metrics (tốc độ phản hồi, tỷ lệ lỗi, lượng request). Prometheus thu thập (scrape) số liệu này và Grafana (chạy ở cổng 3000) trực quan hóa chúng bằng các Dashboards chuyên nghiệp.

### 2.7. Tự động hóa CI/CD (Continuous Integration)
- **Công nghệ:** GitHub Actions (workflow `ci.yml`).
- **Vai trò:** Mỗi khi có thay đổi code đẩy lên nhánh `main` (Push / Pull Request), hệ thống tự động kích hoạt luồng (Pipeline). Pipeline sẽ dựng môi trường Ubuntu ảo, cài đặt Python 3.11, và tự động sử dụng `flake8` để quét (Linting) toàn bộ thư mục `backend/` nhằm phát hiện sớm các lỗi cú pháp (Syntax error). Đồng thời, tự động giả lập tiến trình `docker-compose build` để đảm bảo file cấu hình Docker và code không gặp sự cố, ngăn chặn rủi ro "bể" ứng dụng trước khi được triển khai lên máy chủ thực tế (Production).

### 2.8. Cơ chế Sao lưu (Automated Backups)
- **Công nghệ:** `prodrigestivill/postgres-backup-local` chạy dưới dạng một container độc lập.
- **Vai trò:** Đảm bảo an toàn dữ liệu (Disaster Recovery). Container `pg-backup` được lập lịch chạy ngầm tự động mỗi 12 giờ một lần (Cron: `@every 12h`). Nhiệm vụ của nó là tự động dump (xuất) toàn bộ cấu trúc và dữ liệu của cơ sở dữ liệu `ragdb` (PostgreSQL) rồi lưu trữ an toàn vào một volume độc lập tên là `db_backups`. Nó cũng tự động dọn dẹp các bản sao lưu cũ, chỉ giữ lại file của 7 ngày gần nhất (`BACKUP_KEEP_DAYS=7`), giúp tối ưu hóa không gian lưu trữ mà vẫn giữ an toàn tuyệt đối cho thông tin người dùng và lịch sử hỏi đáp.

---

## 3. LUỒNG DỮ LIỆU HOẠT ĐỘNG (DATA FLOWS)

### 3.1. Luồng tải lên và xử lý tài liệu (Ingest Data Flow)
1. **Admin** đăng nhập, thao tác upload file PDF trên giao diện Web.
2. **Backend (FastAPI)** tiếp nhận file, gọi hàm upload ghi trực tiếp file gốc lên S3 Bucket của **MinIO**. Đồng thời tạo một record (bản ghi) trong **PostgreSQL** với trạng thái `Pending`.
3. Backend đẩy lệnh (kèm theo Document ID) vào **Redis Message Queue** và lập tức trả về phản hồi thành công (HTTP 200) cho Client.
4. Ở dưới nền, **Celery Worker** nhận lệnh từ Redis và tiến hành chuỗi tác vụ:
   - Tải file từ MinIO về bộ nhớ tạm.
   - Bóc tách văn bản (PyMuPDF).
   - Băm nhỏ văn bản thành các chunks (RecursiveCharacterTextSplitter).
   - Nhúng (Embed) các chunks thông qua `vietnamese-sbert` thành dạng Vectors.
   - Đẩy (Index) toàn bộ Vectors lên **Qdrant** kèm metadata (ID gốc, số trang).
5. Cuối cùng, Celery cập nhật trạng thái trong PostgreSQL thành `Completed`.

### 3.2. Luồng hỏi đáp AI (RAG Chat Flow)
1. **User** gõ câu hỏi (Query) và gửi từ giao diện.
2. **Backend** nhận câu hỏi, đầu tiên lưu câu hỏi này (với role `user`) vào bảng `ChatMessage` trong CSDL để lưu lịch sử cuộc trò chuyện.
3. Chuyển đổi câu hỏi của user thành Vector bằng `vietnamese-sbert`.
4. Truy vấn **Qdrant Vector DB** để tìm kiếm `Top 3` đoạn văn (chunks) có khoảng cách Vector gần nhất với câu hỏi.
5. Định dạng (Format) nội dung 3 đoạn văn này đính kèm cùng Câu hỏi, nhét vào Template Prompt và gửi lên qua API tới **Gemini 2.5 Flash**.
6. Gemini nhận prompt đầy đủ ngữ cảnh, suy luận và sinh ra câu trả lời cuối cùng.
7. Backend thu thập mảng Nguồn (Sources / số trang) từ 3 đoạn văn, lọc bỏ các Nguồn trùng lặp.
8. Lưu câu trả lời của AI (với role `bot` + dữ liệu JSON của sources) vào `ChatMessage`.
9. Trả kết quả (Answer Text + Sources Array) về cho Frontend hiển thị tới người dùng.

---

## 4. CÁC ĐIỂM NỔI BẬT CHÍNH (KEY HIGHLIGHTS FOR PRESENTATION)

1. **Hiệu năng & Trải nghiệm (Performance & UX):** Cơ chế xử lý bất đồng bộ (Asynchronous/Background tasks) bằng Celery/Redis giúp việc "tiêu hóa" (ingest) PDF không làm treo hệ thống. API phản hồi tức thì.
2. **Kiến trúc Sẵn sàng cho Production (Production-ready):** Áp dụng Microservices và Containerization toàn diện (Docker Compose). Có Nginx làm Gateway, tách biệt UI/API, dễ dàng mở rộng. Có hệ thống giám sát sức khỏe (Health checks) và giám sát hiệu năng (Prometheus/Grafana) đạt chuẩn công nghiệp.
3. **Khả năng Tìm kiếm Tiếng Việt Vượt trội:** Thay vì sử dụng mô hình nhúng mặc định của OpenAI hay Google (thường hoạt động kém với ngôn ngữ thứ ba), dự án dùng mô hình nhúng cục bộ `vietnamese-sbert` tối ưu riêng cho Tiếng Việt, tăng độ chính xác của bước Retrieval.
4. **Tối ưu chi phí:** Lưu trữ file bằng MinIO (tự host) thay vì ổ cứng thường; Vector DB dùng Qdrant mã nguồn mở; Embedding chạy local không tốn phí API; chỉ dùng API trả phí (Gemini) ở bước cuối cùng với giá siêu rẻ (hoặc miễn phí).
5. **Hiển thị minh bạch Nguồn trích dẫn (Traceability):** Ứng dụng bóc tách chính xác đến từng trang của PDF gốc, và hiển thị cụ thể [Nguồn, Trang] cùng với câu trả lời, giúp tăng cường độ tin cậy tuyệt đối cho một hệ thống AI học thuật (Chống Hallucination).
6. **Vận hành an toàn & Tự động hóa cao (DevOps/SRE):** Có cơ chế tự động kiểm thử (CI) bắt lỗi code qua GitHub Actions, loại bỏ rủi ro do "bất cẩn" của lập trình viên. CSDL PostgreSQL được thiết lập sao lưu (backup) định kỳ 12 giờ/lần với vòng đời lưu trữ 7 ngày, giúp hệ thống phục hồi nhanh chóng (Disaster Recovery) ngay lập tức nếu có sự cố xảy ra.
