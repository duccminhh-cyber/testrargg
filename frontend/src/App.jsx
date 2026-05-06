import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API = "/api";

class MarkdownErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error) {
    console.error("ReactMarkdown crash:", error);
  }
  render() {
    if (this.state.hasError) {
      return <span style={{ whiteSpace: "pre-wrap" }}>{this.props.fallback}</span>;
    }
    return this.props.children;
  }
}

function SafeMarkdown({ content }) {
  return (
    <MarkdownErrorBoundary fallback={content}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} className="markdown-content">
        {content}
      </ReactMarkdown>
    </MarkdownErrorBoundary>
  );
}

// ✅ Format giờ hiển thị
const formatTime = () =>
  new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

// ✅ Format ngày hiển thị
const formatDate = () =>
  new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" });
function PDFModal({ modal, onClose, token }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loadingPdf, setLoadingPdf] = useState(true);

  useEffect(() => {
    if (!modal) return;
    setLoadingPdf(true);
    setBlobUrl(null);

    fetch(modal.url, {
      headers: { Authorization: `Bearer ${token}` }  // ✅ Gửi token
    })
      .then(res => res.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        setBlobUrl(`${url}#page=${modal.page}`);  // ✅ Scroll đến đúng trang
        setLoadingPdf(false);
      })
      .catch(() => setLoadingPdf(false));

    // Cleanup blob URL khi đóng modal
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl.split("#")[0]);
    };
  }, [modal]);

  if (!modal) return null;

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.container} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>📄</span>
            <div>
              <div style={modalStyles.title}>{modal.filename}</div>
              <div style={modalStyles.subtitle}>Trang {modal.page}</div>
            </div>
          </div>
          <button style={modalStyles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* ✅ Loading state */}
        {loadingPdf ? (
          <div style={modalStyles.loading}>
            <div>⏳ Đang tải tài liệu...</div>
          </div>
        ) : (
          <iframe
            src={blobUrl}
            style={modalStyles.iframe}
            title={modal.filename}
          />
        )}
      </div>
    </div>
  );
}


const modalStyles = {
  overlay: {
    position: "fixed", inset: 0,
    background: "rgba(0,0,0,0.65)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000,
    backdropFilter: "blur(4px)",
  },
  container: {
    background: "#fff",
    borderRadius: 14,
    width: "82vw", height: "88vh",
    display: "flex", flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
  },
  header: {
    padding: "12px 16px",
    background: "#1e3a8a",
    display: "flex", justifyContent: "space-between", alignItems: "center",
    flexShrink: 0,
  },
  title: { color: "#fff", fontWeight: 700, fontSize: 14 },
  subtitle: { color: "#93c5fd", fontSize: 11 },
  closeBtn: {
    width: 30, height: 30,
    borderRadius: 7,
    border: "none",
    background: "rgba(255,255,255,0.15)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 14,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  iframe: { flex: 1, border: "none", width: "100%", height: "100%" },
};
export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const [pdfModal, setPdfModal] = useState(null);

  useEffect(() => {
    if (token) fetchHistory();
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function fetchHistory() {
    const maxRetries = 5;
    const retryDelay = 2000; // 2 giây

    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(`${API}/chat/history`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setMessages(data);
          return; // ✅ Thành công thì dừng
        }
      } catch (err) {
        console.log(`Retry ${i + 1}/${maxRetries} fetch history...`);
      }
      // Chờ 2s rồi thử lại
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
    console.error("Không thể load lịch sử sau nhiều lần thử");
  }

  async function handleAuth(e) {
    e.preventDefault();
    const endpoint = isRegistering ? "/auth/register" : "/auth/login";
    const body = isRegistering
      ? JSON.stringify({ username, password })
      : new URLSearchParams({ username, password });

    try {
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: isRegistering ? { "Content-Type": "application/json" } : {},
        body,
      });
      const data = await res.json();
      if (res.ok) {
        if (isRegistering) {
          alert("Đăng ký thành công! Hãy đăng nhập.");
          setIsRegistering(false);
        } else {
          localStorage.setItem("token", data.access_token);
          setToken(data.access_token);
        }
      } else {
        alert(data.detail || "Đăng nhập thất bại!");
      }
    } catch (err) {
      alert("Không thể kết nối server. Kiểm tra lại mạng!");
    }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const question = input.trim();
    const time = formatTime();

    setMessages((prev) => [...prev, { role: "user", content: question, time }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API}/chat/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.answer ?? "",
            sources: JSON.stringify(data.sources ?? []),
            time: formatTime(),
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ Lỗi từ server: ${data.detail || "Không xác định"}`,
            sources: "[]",
            time: formatTime(),
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "⚠️ Không thể kết nối server. Kiểm tra lại mạng hoặc backend.",
          sources: "[]",
          time: formatTime(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }
  async function handleSourceClick(src) {
  try {
    const res = await fetch(
      `/api/documents/by-filename/${encodeURIComponent(src.filename)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return alert("Không tìm thấy tài liệu!");
    const doc = await res.json();
    setPdfModal({
      url: `/api/documents/${doc.id}/file`,
      page: src.page || 1,
      filename: src.filename,
    });
  } catch {
    alert("Không thể mở tài liệu!");
  }
}

  // ── Login / Register ──────────────────────────────────────
  if (!token) {
    return (
      <div style={styles.authContainer}>
        <div style={styles.authCard}>
          {/* Logo */}
          <div style={styles.authLogoWrap}>
            <div style={styles.authLogo}>🎓</div>
          </div>
          <h2 style={styles.authTitle}>
            {isRegistering ? "Tạo tài khoản" : "UET Assistant"}
          </h2>
          <p style={styles.authSubtitle}>
            {isRegistering
              ? "Điền thông tin bên dưới để đăng ký"
              : "Trợ lý học vụ thông minh của UET"}
          </p>
          <form onSubmit={handleAuth} style={styles.form}>
            <div style={styles.inputWrap}>
              <span style={styles.inputIcon}>👤</span>
              <input
                style={styles.input}
                placeholder="Tên đăng nhập"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div style={styles.inputWrap}>
              <span style={styles.inputIcon}>🔒</span>
              <input
                style={styles.input}
                type="password"
                placeholder="Mật khẩu"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button style={styles.primaryBtn} type="submit">
              {isRegistering ? "Đăng ký" : "Đăng nhập"}
            </button>
          </form>
          <p onClick={() => setIsRegistering(!isRegistering)} style={styles.toggleAuth}>
            {isRegistering ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký"}
          </p>
        </div>
      </div>
    );
  }

  // ── Chat UI ───────────────────────────────────────────────
  return (
    <div style={styles.appContainer}>
      {/* Header */}
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={styles.headerLogo}>🎓</div>
          <div>
            <div style={styles.headerTitle}>UET Assistant</div>
            <div style={styles.headerSubtitle}>Trợ lý học vụ thông minh</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* ✅ Avatar user */}
          <div style={styles.userAvatar}>
            {username ? username[0].toUpperCase() : "U"}
          </div>
          <button
            style={styles.logoutBtn}
            onClick={() => {
              localStorage.removeItem("token");
              setToken("");
              setMessages([]);
            }}
          >
            Đăng xuất
          </button>
        </div>
      </header>

      {/* Chat Area */}
      <main style={styles.chatArea}>
        {/* ✅ Date divider */}
        {messages.length > 0 && (
          <div style={styles.dateDivider}>
            <span style={styles.dateDividerText}>{formatDate()}</span>
          </div>
        )}

        {/* Welcome message khi chưa có tin nhắn */}
        {messages.length === 0 && (
          <div style={styles.welcomeWrap}>
            <div style={styles.welcomeIcon}>🎓</div>
            <h3 style={styles.welcomeTitle}>Xin chào! Tôi là UET Assistant</h3>
            <p style={styles.welcomeSubtitle}>
              Hãy hỏi tôi về quy chế học vụ, điều kiện tốt nghiệp, học phí và các thông tin liên quan.
            </p>
            <div style={styles.suggestionWrap}>
              {[
                "Điều kiện xét tốt nghiệp là gì?",
                "Quy định về nghỉ học như thế nào?",
                "Cách tính điểm GPA?",
              ].map((s, i) => (
                <button
                  key={i}
                  style={styles.suggestionBtn}
                  onClick={() => setInput(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const safeContent = msg.content ? String(msg.content) : "";
          const isUser = msg.role === "user";
          const isAssistant = msg.role === "assistant";

          return (
            <div
              key={idx}
              style={isUser ? styles.msgWrapperUser : styles.msgWrapperBot}
            >
              <div style={isUser ? styles.avatarUser : styles.avatarBot}>
                {isUser ? (username ? username[0].toUpperCase() : "U") : "🤖"}
              </div>
              <div style={{ maxWidth: "100%", minWidth: 0 }}>
                <div style={isUser ? styles.userBubble : styles.botBubble}>
                  {isUser ? safeContent : <SafeMarkdown content={safeContent} />}
                </div>

                {/* Sources */}
                {isAssistant && msg.sources && (
                  <div style={styles.sourceContainer}>
                    {(() => {
                      let parsed = [];
                      try {
                        parsed =
                          typeof msg.sources === "string"
                            ? JSON.parse(msg.sources)
                            : msg.sources;
                      } catch {
                        return null;
                      }
                      if (!Array.isArray(parsed) || parsed.length === 0) return null;
                      return parsed.map((src, sIdx) => (
                        <span
                          key={sIdx}
                          style={{ ...styles.sourceTag, cursor: "pointer" }}
                          onClick={() => handleSourceClick(src)}
                          title="Click để xem tài liệu gốc"
                        >
                          📄 {src?.filename} · Tr.{src?.page}
                        </span>
                      ));
                    })()}
                  </div>
                )}

                {/* ✅ Timestamp */}
                {msg.time && (
                  <div style={{
                    fontSize: 11,
                    color: "#94a3b8",
                    marginTop: 3,
                    textAlign: isUser ? "right" : "left",
                  }}>
                    {msg.time}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* ✅ Typing indicator */}
        {loading && (
          <div style={styles.msgWrapperBot}>
            <div style={{ ...styles.avatarBot, animation: "spin 1s linear infinite" }}>
              🤖
            </div>
            <div style={{ ...styles.botBubble, padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={styles.spinner} />
              <span style={{ color: "#94a3b8", fontSize: 13, fontStyle: "italic" }}>
                Đang đọc tài liệu...
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        <form onSubmit={sendMessage} style={styles.inputGroup}>
          <input
            style={styles.chatInput}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Hỏi về quy chế, học phí, lịch học..."
            disabled={loading}
          />
          {/* ✅ Visual feedback khi disabled */}
          <button
            style={{
              ...styles.sendBtn,
              opacity: loading || !input.trim() ? 0.5 : 1,
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              transform: loading ? "scale(0.95)" : "scale(1)",
              transition: "all 0.15s ease",
            }}
            type="submit"
            disabled={loading || !input.trim()}
          >
            {loading ? "⏳" : "➤"}
          </button>
        </form>
      </footer>
      <PDFModal modal={pdfModal} onClose={() => setPdfModal(null)} token={token} />
    </div>
  );
}

const styles = {
  appContainer: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "#f1f5f9",
  },

  // ── Header ──
  header: {
    padding: "12px 20px",
    background: "#1e3a8a",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0,
  },
  headerLogo: {
    width: 34,
    height: 34,
    borderRadius: 8,
    background: "rgba(255,255,255,0.15)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
  },
  headerTitle: { fontSize: 15, fontWeight: 700, color: "#fff" },
  headerSubtitle: { fontSize: 11, color: "#93c5fd" },
  userAvatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#3b82f6",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    color: "#fff",
    fontWeight: 700,
  },
  logoutBtn: {
    padding: "5px 12px",
    borderRadius: 7,
    border: "1px solid rgba(255,255,255,0.25)",
    background: "rgba(255,255,255,0.1)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
  },

  // ── Chat ──
  chatArea: {
    flex: 1,
    overflowY: "auto",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  dateDivider: { textAlign: "center", margin: "4px 0" },
  dateDividerText: {
    fontSize: 11,
    color: "#94a3b8",
    background: "#e2e8f0",
    padding: "2px 12px",
    borderRadius: 10,
  },

  // ── Welcome ──
  welcomeWrap: {
    textAlign: "center",
    padding: "40px 20px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
  },
  welcomeIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    background: "#1e3a8a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 32,
  },
  welcomeTitle: { fontSize: 20, fontWeight: 700, color: "#1e293b", margin: 0 },
  welcomeSubtitle: { fontSize: 14, color: "#64748b", maxWidth: 400, margin: 0 },
  suggestionWrap: { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 8 },
  suggestionBtn: {
    padding: "8px 14px",
    borderRadius: 20,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 500,
  },

  // ── Messages ──
  msgWrapperUser: {
    alignSelf: "flex-end",
    display: "flex",
    flexDirection: "row-reverse",
    gap: 10,
    maxWidth: "80%",
  },
  msgWrapperBot: {
    alignSelf: "flex-start",
    display: "flex",
    gap: 10,
    maxWidth: "80%",
  },
  avatarUser: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "#3b82f6",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    color: "#fff",
    fontWeight: 700,
    flexShrink: 0,
  },
  avatarBot: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "#1e3a8a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    flexShrink: 0,
  },
  userBubble: {
    background: "linear-gradient(135deg, #1d4ed8, #3b82f6)",
    color: "#fff",
    padding: "10px 16px",
    borderRadius: "16px 16px 4px 16px",
    boxShadow: "0 2px 8px rgba(37,99,235,0.25)",
    wordBreak: "break-word",
    fontSize: 14,
  },
  botBubble: {
    background: "#fff",
    border: "0.5px solid #e2e8f0",
    padding: "12px 18px",
    borderRadius: "4px 16px 16px 16px",
    color: "#1e293b",
    lineHeight: "1.6",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
    wordBreak: "break-word",
    overflowX: "auto",
    fontSize: 14,
  },
  sourceContainer: {
    marginTop: 6,
    display: "flex",
    flexWrap: "wrap",
    gap: 5,
  },
  sourceTag: {
    fontSize: 11,
    background: "#eff6ff",
    color: "#1d4ed8",
    padding: "3px 9px",
    borderRadius: 6,
    border: "0.5px solid #bfdbfe",
  },

  // ── Footer ──
  footer: {
    padding: "14px 20px",
    background: "#fff",
    borderTop: "0.5px solid #e2e8f0",
    flexShrink: 0,
  },
  inputGroup: {
    display: "flex",
    gap: 10,
    maxWidth: "900px",
    margin: "0 auto",
    background: "#f8fafc",
    border: "0.5px solid #e2e8f0",
    borderRadius: 14,
    padding: "6px 8px",
    alignItems: "center",
  },
  chatInput: {
    flex: 1,
    padding: "8px 12px",
    border: "none",
    outline: "none",
    fontSize: 14,
    background: "transparent",
    color: "#1e293b",
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 9,
    border: "none",
    background: "#1e3a8a",
    color: "#fff",
    fontWeight: "bold",
    fontSize: 15,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  // ── Auth ──
  authContainer: {
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #0f172a, #1e3a8a)",
  },
  authCard: {
    background: "#fff",
    padding: "40px",
    borderRadius: 20,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
    width: 360,
  },
  authLogoWrap: { display: "flex", justifyContent: "center", marginBottom: 16 },
  authLogo: {
    width: 56,
    height: 56,
    borderRadius: 14,
    background: "#1e3a8a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 28,
  },
  authTitle: {
    textAlign: "center",
    color: "#0f172a",
    fontSize: 22,
    fontWeight: 700,
    margin: "0 0 6px",
  },
  authSubtitle: {
    textAlign: "center",
    color: "#64748b",
    fontSize: 13,
    margin: "0 0 24px",
  },
  form: { display: "flex", flexDirection: "column", gap: 14 },
  inputWrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  inputIcon: { fontSize: 16, flexShrink: 0 },
  input: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: 14,
    color: "#1e293b",
  },
  primaryBtn: {
    padding: "12px",
    borderRadius: 10,
    border: "none",
    background: "#1e3a8a",
    color: "#fff",
    fontWeight: 700,
    fontSize: 15,
    cursor: "pointer",
  },
  toggleAuth: {
    textAlign: "center",
    marginTop: 16,
    color: "#2563eb",
    cursor: "pointer",
    fontSize: 13,
  },
  spinner: {
  width: 18,
  height: 18,
  borderRadius: "50%",
  border: "2px solid #e2e8f0",
  borderTopColor: "#1e3a8a",
  animation: "spin 0.8s linear infinite",
  flexShrink: 0,
  },
  
};