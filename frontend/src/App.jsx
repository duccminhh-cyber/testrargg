import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

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

function preprocessMath(text) {
  if (!text) return "";
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, p1) => `$$${p1}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, p1) => `$${p1}$`);
}

function SafeMarkdown({ content }) {
  const processedContent = preprocessMath(content);
  return (
    <MarkdownErrorBoundary fallback={processedContent}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        className="markdown-content"
      >
        {processedContent}
      </ReactMarkdown>
    </MarkdownErrorBoundary>
  );
}

const formatTime = () =>
  new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

const formatDate = (date) => {
  if (!date) return "Added --";
  return `Added ${new Date(date).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}`;
};

const AnimatedDots = () => {
  const [dots, setDots] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : `${prev}.`));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return <span className="typing-dots">{dots}</span>;
};

function PDFFrame({ modal, token }) {
  const [blobUrl, setBlobUrl] = useState("");
  const [loadingPdf, setLoadingPdf] = useState(true);

  useEffect(() => {
    let nextUrl = "";

    fetch(modal.url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        nextUrl = URL.createObjectURL(blob);
        setBlobUrl(`${nextUrl}#page=${modal.page || 1}`);
        setLoadingPdf(false);
      })
      .catch(() => setLoadingPdf(false));

    return () => {
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [modal, token]);

  if (loadingPdf) return <div className="pdf-modal__loading">Đang tải tài liệu...</div>;

  return <iframe src={blobUrl} title={modal.filename} className="pdf-modal__iframe" />;
}

function PDFModal({ modal, onClose, token }) {
  if (!modal) return null;

  const frameKey = `${modal.url}:${modal.page || 1}`;

  return (
    <div className="pdf-modal" onClick={onClose}>
      <section className="pdf-modal__panel" onClick={(e) => e.stopPropagation()}>
        <header className="pdf-modal__header">
          <div>
            <strong>{modal.filename}</strong>
            <span>Trang {modal.page || 1}</span>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Đóng PDF">
            x
          </button>
        </header>
        <PDFFrame key={frameKey} modal={modal} token={token} />
      </section>
    </div>
  );
}

function InlineDocumentPreview({ doc, token, zoom }) {
  const [blobUrl, setBlobUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!doc) return undefined;

    let nextUrl = "";
    let cancelled = false;

    fetch(`/api/documents/${doc.id}/file`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) throw new Error("Cannot load document");
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        nextUrl = URL.createObjectURL(blob);
        setBlobUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [doc, token]);

  if (!doc) {
    return (
      <div className="document-empty">
        <h2>No document selected</h2>
        <p>Vào Library để chọn tài liệu hoặc tải lại danh sách tài liệu.</p>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="document-empty">
        <h2>{doc.filename}</h2>
        <p>Không thể tải preview file này. Hãy thử mở file bằng nút tải xuống.</p>
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className="document-empty">
        <h2>{doc.filename}</h2>
        <p>Đang tải file đã nạp...</p>
      </div>
    );
  }

  if (doc.ext !== "pdf") {
    return (
      <div className="document-empty">
        <h2>{doc.filename}</h2>
        <p>Preview trực tiếp hỗ trợ tốt nhất với PDF. File này vẫn được dùng làm context khi chat.</p>
      </div>
    );
  }

  return (
    <iframe
      className="document-iframe"
      src={`${blobUrl}#toolbar=0&navpanes=0`}
      title={doc.filename}
      style={{
        transform: `scale(${zoom})`,
        width: `${100 / zoom}%`,
        height: `${100 / zoom}%`,
      }}
    />
  );
}

const navItems = [
  ["chat", "▦", "Dashboard"],
  ["history", "↺", "History"],
  ["settings", "⚙", "Settings"],
];

function getExtension(filename = "") {
  const clean = filename.split("?")[0];
  const ext = clean.includes(".") ? clean.split(".").pop().toLowerCase() : "pdf";
  return ext || "pdf";
}

function getCategory(filename = "") {
  const name = filename.toLowerCase();
  if (name.includes("market") || name.includes("business") || name.includes("report")) return "Economics";
  if (name.includes("history") || name.includes("roman")) return "History";
  if (name.includes("data") || name.includes("csv")) return "Data Science";
  if (name.includes("physics") || name.includes("quantum")) return "Physics";
  if (name.includes("literature") || name.includes("note")) return "Literature";
  if (name.includes("machine") || name.includes("slide") || name.includes("neural")) return "Machine Learning";
  return "Knowledge";
}

function displayTitle(filename = "") {
  const withoutExt = filename.replace(/\.[^/.]+$/, "").replaceAll("_", " ");
  return withoutExt || "Untitled document";
}

function formatBytes(value) {
  if (!value) return "Verified";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeDoc(doc) {
  const filename = doc.filename || doc.name || `Document ${doc.id}`;
  const ext = getExtension(filename);
  return {
    ...doc,
    filename,
    title: displayTitle(filename),
    category: getCategory(filename),
    ext,
    added: formatDate(doc.created_at),
    detail: doc.description || filename,
    metric: doc.status === "done" ? formatBytes(doc.file_size || doc.size) : doc.status || "pending",
  };
}

const sessionKinds = ["TOPIC ANALYSIS", "SYNTHESIS", "DRAFTING"];

function getSessionKind(index) {
  return sessionKinds[index % sessionKinds.length];
}

function getSessionTimeLabel(session) {
  const rawDate = session.updated_at || session.created_at;
  if (!rawDate) return "Last active";

  const date = new Date(rawDate);
  const diffMs = Date.now() - date.getTime();
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;

  if (Number.isNaN(date.getTime())) return "Last active";
  if (diffMs < hourMs) return "Last active now";
  if (diffMs < dayMs) return `Last active ${Math.max(1, Math.round(diffMs / hourMs))}h ago`;
  if (diffMs < 2 * dayMs) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getSessionTitle(session) {
  return session.title || `Session #${session.id}`;
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "dark");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [view, setView] = useState("chat");
  const [documents, setDocuments] = useState([]);
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [activeDocId, setActiveDocId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [botStatus, setBotStatus] = useState("");
  const [thinkStartTime, setThinkStartTime] = useState(null);
  const [thinkTime, setThinkTime] = useState(0);
  const [pdfModal, setPdfModal] = useState(null);
  const [query, setQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortMode, setSortMode] = useState("recent");
  const [syncScroll, setSyncScroll] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [chatWidth, setChatWidth] = useState(34);
  const bottomRef = useRef(null);

  const isLight = theme === "light";

  const normalizedDocs = useMemo(() => documents.map(normalizeDoc), [documents]);
  const selectedDocuments = useMemo(
    () => normalizedDocs.filter((doc) => selectedDocIds.includes(doc.id)),
    [normalizedDocs, selectedDocIds],
  );
  const activeDoc = useMemo(() => {
    if (!normalizedDocs.length) return null;
    return normalizedDocs.find((doc) => doc.id === activeDocId) || selectedDocuments[0] || normalizedDocs[0];
  }, [activeDocId, normalizedDocs, selectedDocuments]);

  const subjects = useMemo(
    () => Array.from(new Set(normalizedDocs.map((doc) => doc.category))).sort(),
    [normalizedDocs],
  );
  const fileTypes = useMemo(
    () => Array.from(new Set(normalizedDocs.map((doc) => doc.ext))).sort(),
    [normalizedDocs],
  );

  const visibleDocs = useMemo(() => {
    const search = query.trim().toLowerCase();
    const docs = normalizedDocs.filter((doc) => {
      const matchesSearch =
        !search ||
        doc.filename.toLowerCase().includes(search) ||
        doc.title.toLowerCase().includes(search) ||
        doc.category.toLowerCase().includes(search);
      const matchesSubject = subjectFilter === "all" || doc.category === subjectFilter;
      const matchesType = typeFilter === "all" || doc.ext === typeFilter;
      return matchesSearch && matchesSubject && matchesType;
    });

    return docs.sort((a, b) => {
      if (sortMode === "name") return a.title.localeCompare(b.title);
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  }, [normalizedDocs, query, subjectFilter, sortMode, typeFilter]);

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    let interval;
    if (loading && thinkStartTime) {
      interval = setInterval(() => {
        setThinkTime(((Date.now() - thinkStartTime) / 1000).toFixed(1));
      }, 100);
    } else {
      setThinkTime(0);
    }
    return () => clearInterval(interval);
  }, [loading, thinkStartTime]);

  useEffect(() => {
    if (token) fetchSessionsAndDocs();
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, botStatus]);

  useEffect(() => {
    if (!activeDocId && normalizedDocs.length) {
      setActiveDocId(normalizedDocs[0].id);
    }
  }, [activeDocId, normalizedDocs]);

  async function fetchSessionsAndDocs() {
    try {
      const [resDocs, resSessions] = await Promise.all([
        fetch(`${API}/documents`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/chat/sessions`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (resDocs.status === 401 || resSessions.status === 401) {
        handleLogout();
        return;
      }

      if (resDocs.ok) {
        const data = await resDocs.json();
        setDocuments(data);
        setActiveDocId((prev) => prev || data[0]?.id || null);
      }

      if (resSessions.ok) {
        setSessions(await resSessions.json());
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function fetchHistory(sessionId) {
    try {
      const res = await fetch(`${API}/chat/history?session_id=${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) setMessages(await res.json());
    } catch (err) {
      console.error(err);
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
          alert("Đăng ký thành công. Hãy đăng nhập.");
          setIsRegistering(false);
        } else {
          localStorage.setItem("token", data.access_token);
          setToken(data.access_token);
        }
      } else {
        alert(data.detail || "Đăng nhập thất bại.");
      }
    } catch {
      alert("Không thể kết nối server.");
    }
  }

  function handleLogout() {
    localStorage.removeItem("token");
    setToken("");
    setMessages([]);
    setDocuments([]);
    setSessions([]);
    setCurrentSessionId(null);
    setSelectedDocIds([]);
  }

  function startNewSession() {
    setCurrentSessionId(null);
    setMessages([]);
    setView("chat");
  }

  function toggleDoc(docId) {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId],
    );
    setActiveDocId(docId);
  }

  function openSession(session) {
    setCurrentSessionId(session.id);
    setSelectedDocIds(session.selected_docs || []);
    setActiveDocId((session.selected_docs || [])[0] || activeDocId);
    setView("chat");
    fetchHistory(session.id);
  }

  async function deleteSession(e, sessionId) {
    e.stopPropagation();
    if (!window.confirm("Xóa cuộc trò chuyện này?")) return;

    try {
      const res = await fetch(`${API}/chat/sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((session) => session.id !== sessionId));
        if (currentSessionId === sessionId) startNewSession();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const question = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: question, time: formatTime() }]);
    setInput("");
    setLoading(true);
    setThinkStartTime(Date.now());
    setBotStatus("Analyzing context");
    setView("chat");

    const assistantMessage = {
      role: "assistant",
      content: "",
      sources: "[]",
      time: formatTime(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const res = await fetch(`${API}/chat/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question,
          selected_doc_ids: selectedDocIds,
          session_id: currentSessionId,
        }),
      });

      if (res.status === 401) {
        handleLogout();
        return;
      }

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let nextAssistant = { ...assistantMessage };
      let aiStartedTyping = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          const parsed = JSON.parse(line);

          if (parsed.type === "session_created") {
            const session = parsed.data;
            setCurrentSessionId(session.id);
            setSessions((prev) => [
              { id: session.id, title: session.title, selected_docs: selectedDocIds },
              ...prev,
            ]);
          } else if (parsed.type === "status") {
            setBotStatus(parsed.data);
          } else if (parsed.type === "sources") {
            nextAssistant = { ...nextAssistant, sources: JSON.stringify(parsed.data) };
          } else if (parsed.type === "chunk") {
            if (!aiStartedTyping) {
              aiStartedTyping = true;
              setThinkStartTime(null);
              setBotStatus("Writing answer");
            }
            nextAssistant = { ...nextAssistant, content: nextAssistant.content + parsed.data };
          } else if (parsed.type === "error") {
            nextAssistant = { ...nextAssistant, content: `${nextAssistant.content}\n\nLỗi: ${parsed.data}` };
          }

          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = nextAssistant;
            return next;
          });
        }
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          ...next[next.length - 1],
          content: "Không thể kết nối server hoặc có lỗi xảy ra.",
        };
        return next;
      });
    } finally {
      setLoading(false);
      setBotStatus("");
      setThinkStartTime(null);
    }
  }

  async function handleSourceClick(src) {
    try {
      const res = await fetch(`/api/documents/by-filename/${encodeURIComponent(src.filename)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        alert("Không tìm thấy tài liệu.");
        return;
      }
      const doc = await res.json();
      setPdfModal({
        url: `/api/documents/${doc.id}/file`,
        page: src.page || 1,
        filename: src.filename,
      });
    } catch {
      alert("Không thể mở tài liệu.");
    }
  }

  async function openDocumentFile(download = false) {
    if (!activeDoc) return;
    try {
      const res = await fetch(`/api/documents/${activeDoc.id}/file`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Cannot open file");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = activeDoc.filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        setPdfModal({ url: `/api/documents/${activeDoc.id}/file`, filename: activeDoc.filename, page: 1 });
      }
    } catch {
      alert("Không thể mở file tài liệu.");
    }
  }

  function startResize(e) {
    e.preventDefault();
    const container = e.currentTarget.parentElement;
    if (!container) return;

    const handleMove = (event) => {
      const rect = container.getBoundingClientRect();
      const nextWidth = ((rect.right - event.clientX) / rect.width) * 100;
      setChatWidth(Math.min(60, Math.max(28, nextWidth)));
    };
    const stopResize = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopResize);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopResize);
  }

  if (!token) {
    return (
      <main className="auth-screen">
        <form className="auth-panel" onSubmit={handleAuth}>
          <div className="auth-brand">
            <span>UET Assistant</span>
            <small>RESEARCHER PRO</small>
          </div>
          <h1>{isRegistering ? "Tạo tài khoản" : "Đăng nhập"}</h1>
          <p>
            {isRegistering
              ? "Tạo tài khoản để sử dụng trợ lý nghiên cứu."
              : "Truy cập thư viện tài liệu và trò chuyện với AI theo ngữ cảnh đã chọn."}
          </p>
          <label>
            Tên đăng nhập
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label>
            Mật khẩu
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegistering ? "new-password" : "current-password"}
            />
          </label>
          <button className="primary-action" type="submit">
            {isRegistering ? "Đăng ký" : "Đăng nhập"}
          </button>
          <button className="link-action" type="button" onClick={() => setIsRegistering((prev) => !prev)}>
            {isRegistering ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <div className={`rag-app theme-${theme}`}>
      <aside className="rag-sidebar">
        <div className="rag-brand">
          <strong>UET Assistant</strong>
          <span>RESEARCHER PRO</span>
        </div>
        <button className="new-chat-btn" type="button" onClick={startNewSession}>
          + New Chat
        </button>
        <section className="sidebar-documents" aria-label="Documents">
          <div className="sidebar-documents__title">Documents</div>
          <div className="sidebar-documents__list">
            {normalizedDocs.map((doc) => {
              const selected = selectedDocIds.includes(doc.id);
              return (
                <div
                  key={doc.id}
                  className={`sidebar-doc ${activeDoc?.id === doc.id ? "is-active" : ""}`}
                  onClick={() => setActiveDocId(doc.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setActiveDocId(doc.id);
                  }}
                  role="button"
                  tabIndex={0}
                  title={doc.filename}
                >
                  <span className={`file-mark file-mark--${doc.ext}`}>{doc.ext.slice(0, 3).toUpperCase()}</span>
                  <span className="sidebar-doc__name">{doc.filename}</span>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleDoc(doc.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Chọn ${doc.filename}`}
                  />
                </div>
              );
            })}
            {!normalizedDocs.length && (
              <div className="sidebar-documents__empty">Chưa có tài liệu.</div>
            )}
          </div>
        </section>
        <nav className="rag-nav">
          {navItems.map(([key, icon, label]) => (
            <button
              key={key}
              type="button"
              className={`rag-nav__item ${view === key ? "is-active" : ""}`}
              onClick={() => setView(key)}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
          <button
            type="button"
            className={`rag-nav__item ${view === "help" ? "is-active" : ""}`}
            onClick={() => setView("help")}
          >
            <span>?</span>
            Help
          </button>
          <button type="button" className="rag-nav__item rag-nav__item--action" onClick={handleLogout}>
            <span>↪</span>
            Logout
          </button>
        </nav>
      </aside>

      {view === "library" && (
        <main className="library-screen">
          <header className="topbar">
            <label className="search-box">
              <span>⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search knowledge base..."
              />
            </label>
            <div className="topbar-icons">
              <button className="icon-btn" type="button" onClick={fetchSessionsAndDocs} aria-label="Làm mới">
                ⚙
              </button>
              <button className="icon-btn" type="button" onClick={() => setView("settings")} aria-label="Tài khoản">
                ◎
              </button>
            </div>
          </header>

          <section className="library-content">
            <div className="library-heading">
              <div>
                <h1>Document Library</h1>
                <p>Select documents to serve as context for your next AI session.</p>
              </div>
              <div className="filters">
                <label>
                  Subject
                  <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
                    <option value="all">All</option>
                    {subjects.map((subject) => (
                      <option key={subject} value={subject}>
                        {subject}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  File Type
                  <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                    <option value="all">All</option>
                    {fileTypes.map((type) => (
                      <option key={type} value={type}>
                        {type.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Date Added
                  <select value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                    <option value="recent">Newest</option>
                    <option value="name">Name</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="doc-grid">
              {visibleDocs.map((doc) => {
                const selected = selectedDocIds.includes(doc.id);
                return (
                  <article
                    key={doc.id}
                    className={`doc-card ${selected ? "is-selected" : ""}`}
                    onClick={() => setActiveDocId(doc.id)}
                  >
                    <div className="doc-card__top">
                      <span className={`file-mark file-mark--${doc.ext}`}>{doc.ext.slice(0, 3).toUpperCase()}</span>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleDoc(doc.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Chọn ${doc.filename}`}
                      />
                    </div>
                    <span className="subject-tag">{doc.category}</span>
                    <h2>{doc.title}</h2>
                    <p>{doc.detail}</p>
                    <footer>
                      <span>{doc.added}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveDocId(doc.id);
                          setPdfModal({ url: `/api/documents/${doc.id}/file`, filename: doc.filename, page: 1 });
                        }}
                      >
                        {doc.metric}
                      </button>
                    </footer>
                  </article>
                );
              })}
              {!visibleDocs.length && (
                <div className="empty-state">
                  <h2>Không có tài liệu phù hợp</h2>
                  <p>Thử đổi bộ lọc hoặc kiểm tra lại dữ liệu đã ingest.</p>
                </div>
              )}
            </div>
          </section>

          <button
            className={`floating-context ${selectedDocIds.length ? "is-visible" : ""}`}
            type="button"
            onClick={() => setView("chat")}
          >
            Start with {selectedDocIds.length} source{selectedDocIds.length > 1 ? "s" : ""}
          </button>
        </main>
      )}

      {view === "chat" && (
        <main className="chat-screen">
          <header className="chat-topbar">
            <div className="chat-topbar__left">
              <div className="active-sources">
                <span>Active Sources:</span>
                {selectedDocuments.map((doc) => (
                  <button
                    key={doc.id}
                    className={activeDoc?.id === doc.id ? "source-chip source-chip--active" : "source-chip"}
                    type="button"
                    onClick={() => {
                      setActiveDocId(doc.id);
                      setView("chat");
                    }}
                  >
                    {doc.filename}
                  </button>
                ))}
              </div>
            </div>
            <div className="topbar-icons">
              <button
                className="icon-btn"
                type="button"
                onClick={() => setTheme(isLight ? "dark" : "light")}
                aria-label={isLight ? "Chuyển sang dark mode" : "Chuyển sang light mode"}
                title={isLight ? "Dark mode" : "Light mode"}
              >
                {isLight ? "☾" : "☼"}
              </button>
              <button className="icon-btn" type="button" onClick={() => setView("settings")} aria-label="Cài đặt">
                ⚙
              </button>
            </div>
          </header>

          <div
            className="split-layout"
            style={{ gridTemplateColumns: `minmax(360px, 1fr) 6px minmax(340px, ${chatWidth}%)` }}
          >
            <section className="document-viewer">
              <header>
                <div>
                  <span>▤</span>
                  <strong>{activeDoc?.filename || "No document selected"}</strong>
                </div>
                <div>
                  <button type="button" className="mini-btn" onClick={() => setZoom((prev) => Math.max(0.8, prev - 0.1))}>
                    −
                  </button>
                  <button type="button" className="mini-btn" onClick={() => setZoom((prev) => Math.min(1.3, prev + 0.1))}>
                    +
                  </button>
                  <button type="button" className="mini-btn" onClick={() => openDocumentFile(true)}>
                    ⇩
                  </button>
                </div>
              </header>
              <div className="pdf-canvas">
                <InlineDocumentPreview key={activeDoc?.id || "empty"} doc={activeDoc} token={token} zoom={zoom} />
              </div>
            </section>

            <div className="resize-divider" role="separator" aria-label="Resize chat panel" onPointerDown={startResize}>
              <span />
            </div>

            <section className="chat-panel">
              <header className="chat-panel__header">
                <strong>▣ UET Assistant</strong>
                <button type="button" className={`sync-btn ${syncScroll ? "is-on" : ""}`} onClick={() => setSyncScroll((prev) => !prev)}>
                  ⇄ SYNC
                </button>
              </header>
              <div className="chat-messages">
                {!messages.length && (
                  <div className="assistant-card">
                    <span className="assistant-label">✣ Assistant Summary</span>
                    <div className="assistant-bubble">
                      <p>
                        Based on the selected source, the current context is{" "}
                        <strong>{activeDoc?.title || "your document"}</strong>.
                      </p>
                      <p>Ask a question and the assistant will answer flexibly using retrieved context when available.</p>
                    </div>
                  </div>
                )}

                {messages.map((msg, idx) => {
                  const isUser = msg.role === "user";
                  const safeContent = msg.content || "";
                  return (
                    <div key={`${msg.role}-${idx}`} className={isUser ? "message-row message-row--user" : "message-row"}>
                      <span className="message-label">{isUser ? "You ◎" : "✣ Assistant"}</span>
                      <div className={isUser ? "message-bubble message-bubble--user" : "message-bubble"}>
                        {isUser ? safeContent : <SafeMarkdown content={safeContent} />}
                      </div>
                      {msg.time && <small className="message-time">{msg.time}</small>}
                    </div>
                  );
                })}

                {loading && (
                  <div className="status-line">
                    <span>☊</span>
                    <em>
                      {botStatus || "Analyzing context"}
                      <AnimatedDots />
                      {thinkStartTime && <small> ({thinkTime}s)</small>}
                    </em>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              <form className="chat-input" onSubmit={sendMessage}>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask a question about the document..."
                  disabled={loading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) sendMessage(e);
                  }}
                />
                <div className="chat-input__footer">
                  <div>
                    <button type="button" onClick={fetchSessionsAndDocs} aria-label="Tải lại tài liệu">
                      ⇱
                    </button>
                    <button type="button" onClick={() => openDocumentFile(false)} aria-label="Mở tài liệu">
                      ▣
                    </button>
                  </div>
                  <button type="submit" disabled={loading || !input.trim()}>
                    Send ▷
                  </button>
                </div>
                <p>AI can make mistakes. Verify important information.</p>
              </form>
            </section>
          </div>
        </main>
      )}

      {view === "history" && (
        <main className="history-screen">
          <section className="recent-session">
            <h1>
              <span>▱</span>
              Recent Session
            </h1>
            <div className="recent-session__card">
              {sessions.map((session, index) => {
                const docCount = (session.selected_docs || []).length;
                return (
                  <article
                    key={session.id}
                    className="recent-session__item"
                    onClick={() => openSession(session)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") openSession(session);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <button
                      type="button"
                      className="recent-session__delete"
                      onClick={(e) => deleteSession(e, session.id)}
                      aria-label="Xóa session"
                      title="Xóa session"
                    >
                      x
                    </button>
                    <span className="recent-session__kind">
                      <i>□</i>
                      {getSessionKind(index)}
                    </span>
                    <strong>{getSessionTitle(session)}</strong>
                    <span className="recent-session__meta">
                      <b>{docCount || 1} Docs</b>
                      <small>{getSessionTimeLabel(session)}</small>
                    </span>
                  </article>
                );
              })}
              {!sessions.length && (
                <div className="recent-session__empty">Chưa có lịch sử trò chuyện.</div>
              )}
            </div>
          </section>
        </main>
      )}

      {view === "settings" && (
        <main className="utility-screen">
          <h1>Settings</h1>
          <p>Thiết lập thao tác nhanh cho giao diện nghiên cứu.</p>
          <section className="settings-panel">
            <label>
              <input type="checkbox" checked={syncScroll} onChange={(e) => setSyncScroll(e.target.checked)} />
              Sync document viewer
            </label>
            <button type="button" onClick={fetchSessionsAndDocs}>
              Refresh documents and sessions
            </button>
            <button type="button" onClick={handleLogout}>
              Logout
            </button>
          </section>
        </main>
      )}

      {view === "help" && (
        <main className="utility-screen">
          <h1>Help</h1>
          <p>Chọn tài liệu trong Library, bấm Start, rồi đặt câu hỏi trong khung chat.</p>
        </main>
      )}

      <PDFModal modal={pdfModal} onClose={() => setPdfModal(null)} token={token} />
    </div>
  );
}
