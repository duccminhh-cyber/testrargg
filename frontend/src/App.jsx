import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API = "/api";

// ═══════════════════════════════════════════════════════════
// FIX BUG 1: Error Boundary bắt lỗi từ ReactMarkdown
// Functional component KHÔNG thể là Error Boundary → phải dùng class
// Không có cái này: ReactMarkdown crash → toàn bộ cây React sập → trắng màn hình
// ═══════════════════════════════════════════════════════════
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
      // Fallback: hiển thị plain text thay vì trắng màn hình
      return <span style={{ whiteSpace: "pre-wrap" }}>{this.props.fallback}</span>;
    }
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════
// FIX BUG 2: Bọc ReactMarkdown bằng Error Boundary + bật lại remarkGfm
// remarkGfm cần thiết vì Gemini trả về GFM: bảng, **bold**, strikethrough...
// Tháo remarkGfm ra sẽ render sai, và một số syntax có thể gây crash
// ═══════════════════════════════════════════════════════════
function SafeMarkdown({ content }) {
  return (
    <MarkdownErrorBoundary fallback={content}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        className="markdown-content"
      >
        {content}
      </ReactMarkdown>
    </MarkdownErrorBoundary>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (token) fetchHistory();
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function fetchHistory() {
    try {
      const res = await fetch(`${API}/chat/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (err) {
      console.error("Lỗi load lịch sử", err);
    }
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
          alert("Đăng ký xong rồi, đăng nhập đi m!");
          setIsRegistering(false);
        } else {
          localStorage.setItem("token", data.access_token);
          setToken(data.access_token);
        }
      } else {
        alert(data.detail || "Có biến rồi!");
      }
    } catch (err) {
      alert("Server sập hoặc lỗi mạng!");
    }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    // ═══════════════════════════════════════════════════════
    // FIX BUG 3: Lưu question vào biến riêng TRƯỚC khi clear input
    // setInput("") là async → nếu dùng thẳng `input` trong body fetch
    // sau khi setInput(""), giá trị vẫn đúng (closure), NHƯNG nếu React
    // batch update và re-render trước khi fetch → input có thể bị "" rồi
    // Lưu vào const là cách an toàn nhất, không có risk gì
    // ═══════════════════════════════════════════════════════
    const question = input.trim();

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API}/chat/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question }), // Dùng biến đã lưu, 100% an toàn
      });
      const data = await res.json();
      if (res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.answer ?? "",
            sources: JSON.stringify(data.sources ?? []),
          },
        ]);
      } else {
        // Hiển thị lỗi từ server thay vì im lặng
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ Lỗi từ server: ${data.detail || "Không xác định"}`,
            sources: "[]",
          },
        ]);
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "⚠️ Không thể kết nối server. Kiểm tra lại mạng hoặc backend.",
          sources: "[]",
        },
      ]);
    } finally {
      // Dùng finally để loading luôn được tắt, kể cả khi throw
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div style={styles.authContainer}>
        <div style={styles.authCard}>
          <h2 style={{ textAlign: "center", color: "#1e293b" }}>
            {isRegistering ? "Tạo tài khoản UET" : "Hệ thống RAG Học vụ"}
          </h2>
          <form onSubmit={handleAuth} style={styles.form}>
            <input
              style={styles.input}
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              style={styles.input}
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button style={styles.primaryBtn} type="submit">
              {isRegistering ? "Đăng ký" : "Vào Chat"}
            </button>
          </form>
          <p
            onClick={() => setIsRegistering(!isRegistering)}
            style={styles.toggleAuth}
          >
            {isRegistering ? "Đã có nick? Đăng nhập" : "Chưa có nick? Đăng ký ngay"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.appContainer}>
      <header style={styles.header}>
        <b style={{ fontSize: 18, color: "#2563eb" }}>🎓 UET Assistant</b>
        <button
          style={styles.logoutBtn}
          onClick={() => {
            localStorage.removeItem("token");
            setToken("");
          }}
        >
          Đăng xuất
        </button>
      </header>

      <main style={styles.chatArea}>
        {messages.map((msg, idx) => {
          const safeContent = msg.content ? String(msg.content) : "";
          const isUser = msg.role === "user";
          const isAssistant = msg.role === "assistant";

          return (
            <div
              key={idx}
              style={isUser ? styles.msgWrapperUser : styles.msgWrapperBot}
            >
              <div style={styles.avatar}>{isUser ? "👤" : "🤖"}</div>
              <div style={{ maxWidth: "100%", minWidth: 0 }}>
                <div style={isUser ? styles.userBubble : styles.botBubble}>
                  {isUser ? (
                    safeContent
                  ) : (
                    // SafeMarkdown bọc Error Boundary + remarkGfm
                    <SafeMarkdown content={safeContent} />
                  )}
                </div>

                {/* Hiển thị Nguồn (Citation) — chỉ với assistant */}
                {isAssistant && msg.sources && (
                  <div style={styles.sourceContainer}>
                    {(() => {
                      let parsed = [];
                      try {
                        parsed =
                          typeof msg.sources === "string"
                            ? JSON.parse(msg.sources)
                            : msg.sources;
                      } catch (e) {
                        return null;
                      }
                      if (!Array.isArray(parsed) || parsed.length === 0)
                        return null;
                      return parsed.map((src, sIdx) => (
                        <span key={sIdx} style={styles.sourceTag}>
                          📄 {src?.filename || "Tài liệu"} (Trang{" "}
                          {src?.page || "?"})
                        </span>
                      ));
                    })()}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {loading && (
          <div style={styles.loading}>🤖 Bot đang đọc tài liệu...</div>
        )}
        <div ref={bottomRef} />
      </main>

      <footer style={styles.footer}>
        <form onSubmit={sendMessage} style={styles.inputGroup}>
          <input
            style={styles.chatInput}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Hỏi tôi bất cứ gì về quy chế học vụ..."
            disabled={loading}
          />
          <button style={styles.sendBtn} type="submit" disabled={loading}>
            {loading ? "..." : "Gửi"}
          </button>
        </form>
      </footer>
    </div>
  );
}

const styles = {
  appContainer: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "#f8fafc",
  },
  header: {
    padding: "15px 25px",
    background: "#fff",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0, // Fix: header không bị co lại
  },
  chatArea: {
    flex: 1,
    overflowY: "auto",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  msgWrapperUser: {
    alignSelf: "flex-end",
    display: "flex",
    flexDirection: "row-reverse",
    gap: "12px",
    maxWidth: "85%",
  },
  msgWrapperBot: {
    alignSelf: "flex-start",
    display: "flex",
    gap: "12px",
    maxWidth: "85%",
  },
  avatar: {
    width: 35,
    height: 35,
    borderRadius: "50%",
    background: "#e2e8f0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    flexShrink: 0, // Fix: avatar không bị co khi content dài
  },
  userBubble: {
    background: "#2563eb",
    color: "#fff",
    padding: "12px 18px",
    borderRadius: "18px 18px 2px 18px",
    boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)",
    wordBreak: "break-word", // Fix: tránh overflow ngang
  },
  botBubble: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    padding: "15px 20px",
    borderRadius: "2px 18px 18px 18px",
    color: "#1e293b",
    lineHeight: "1.6",
    boxShadow: "0 2px 4px rgba(0,0,0,0.02)",
    wordBreak: "break-word", // Fix: tránh overflow ngang với code/url dài
    overflowX: "auto",       // Fix: bảng markdown có thể scroll ngang
  },
  sourceContainer: {
    marginTop: "8px",
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
  },
  sourceTag: {
    fontSize: "11px",
    background: "#f1f5f9",
    color: "#64748b",
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid #e2e8f0",
  },
  footer: {
    padding: "20px",
    background: "#fff",
    borderTop: "1px solid #e2e8f0",
    flexShrink: 0, // Fix: footer không bị co lại
  },
  inputGroup: {
    display: "flex",
    gap: "10px",
    maxWidth: "900px",
    margin: "0 auto",
  },
  chatInput: {
    flex: 1,
    padding: "12px 20px",
    borderRadius: "25px",
    border: "1px solid #cbd5e1",
    outline: "none",
    fontSize: "14px",
  },
  sendBtn: {
    padding: "10px 25px",
    borderRadius: "25px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontWeight: "bold",
    cursor: "pointer",
    opacity: 1,
  },

  // Auth
  authContainer: {
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f1f5f9",
  },
  authCard: {
    background: "#fff",
    padding: "40px",
    borderRadius: "16px",
    boxShadow: "0 10px 25px rgba(0,0,0,0.05)",
    width: "350px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "15px",
    marginTop: "20px",
  },
  input: { padding: "12px", borderRadius: "8px", border: "1px solid #ddd" },
  primaryBtn: {
    padding: "12px",
    borderRadius: "8px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontWeight: "bold",
    cursor: "pointer",
  },
  toggleAuth: {
    textAlign: "center",
    marginTop: "15px",
    color: "#2563eb",
    cursor: "pointer",
    fontSize: "14px",
  },
  logoutBtn: {
    padding: "6px 15px",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
    background: "#fff",
    cursor: "pointer",
  },
  loading: {
    textAlign: "center",
    color: "#64748b",
    fontSize: "13px",
    fontStyle: "italic",
  },
};
