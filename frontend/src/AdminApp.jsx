import { useState, useEffect } from "react";

const API = "/api";

// ✅ Config badge 4 trạng thái
const STATUS_STYLE = {
  done:       { bg: "#dcfce7", color: "#166534", label: "✓ Hoàn thành" },
  processing: { bg: "#dbeafe", color: "#1e40af", label: "⟳ Đang xử lý" },
  pending:    { bg: "#fef9c3", color: "#854d0e", label: "⏳ Chờ xử lý"  },
  error:      { bg: "#fee2e2", color: "#991b1b", label: "✗ Lỗi"         },
};

export default function AdminApp() {
  const [token, setToken] = useState(localStorage.getItem("adminToken") || "");
  const [tab, setTab] = useState("documents");
  const [documents, setDocuments] = useState([]);
  const [users, setUsers] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [refreshing, setRefreshing] = useState(false); // ✅ Trạng thái refresh

  // Form đổi mật khẩu admin
  const [currentPassword, setCurrentPassword] = useState("");
  const [adminNewUsername, setAdminNewUsername] = useState("");
  const [adminNewPassword, setAdminNewPassword] = useState("");

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (token) {
      fetchDocuments();
      fetchUsers();
    }
  }, [token]);

  async function adminLogin(e) {
    e.preventDefault();
    const form = new URLSearchParams({
      username: e.target.username.value,
      password: e.target.password.value,
    });
    const res = await fetch(`${API}/auth/login`, { method: "POST", body: form });
    const data = await res.json();
    if (res.ok) {
      if (!data.is_admin) {
        alert("Tài khoản này không có quyền Admin!");
        return;
      }
      localStorage.setItem("adminToken", data.access_token);
      setToken(data.access_token);
    } else {
      alert("Sai tài khoản hoặc mật khẩu!");
    }
  }

  const fetchDocuments = async () => {
    const res = await fetch(`${API}/documents`, { headers });
    if (res.ok) setDocuments(await res.json());
  };

  const fetchUsers = async () => {
    const res = await fetch(`${API}/admin/users`, { headers });
    if (res.ok) setUsers(await res.json());
  };

  // ✅ Refresh với loading indicator
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchDocuments();
    setRefreshing(false);
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API}/documents/upload`, {
      method: "POST",
      headers,
      body: formData,
    });
    if (res.ok) {
      alert("Upload thành công! Worker đang xử lý trong nền.");
      fetchDocuments();
    } else {
      const err = await res.json();
      alert(err.detail || "Upload thất bại!");
    }
    setUploading(false);
    e.target.value = "";
  };

  const deleteDoc = async (id) => {
    if (window.confirm("Xóa file này và toàn bộ Vector Data?")) {
      const res = await fetch(`${API}/documents/${id}`, { method: "DELETE", headers });
      if (res.ok) {
        fetchDocuments();
      } else {
        const err = await res.json();
        alert(err.detail || "Không thể xóa tài liệu này!");
      }
    }
  };

  const deleteUser = async (id) => {
    if (window.confirm("Xóa người dùng này cùng toàn bộ dữ liệu của họ?")) {
      const res = await fetch(`${API}/admin/users/${id}`, { method: "DELETE", headers });
      if (res.ok) {
        fetchUsers();
      } else {
        alert("Lỗi khi xóa người dùng!");
      }
    }
  };

  const createUser = async () => {
    if (!newUsername || !newPassword) return alert("Điền đủ username và password!");
    const res = await fetch(`${API}/admin/users`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername, password: newPassword, is_admin: false }),
    });
    if (res.ok) {
      setNewUsername("");
      setNewPassword("");
      fetchUsers();
    } else {
      const err = await res.json();
      alert(err.detail || "Lỗi tạo user!");
    }
  };

  const updateAdminCredentials = async (e) => {
    e.preventDefault();
    if (!currentPassword) return alert("Vui lòng nhập mật khẩu hiện tại để xác thực!");
    if (!adminNewUsername && !adminNewPassword) return alert("Vui lòng nhập tài khoản hoặc mật khẩu mới!");

    const res = await fetch(`${API}/auth/update-credentials`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: currentPassword,
        new_username: adminNewUsername || null,
        new_password: adminNewPassword || null,
      }),
    });

    const data = await res.json();
    if (res.ok) {
      alert("Cập nhật thành công!");
      setCurrentPassword("");
      setAdminNewUsername("");
      setAdminNewPassword("");
      if (data.access_token) {
        localStorage.setItem("adminToken", data.access_token);
        setToken(data.access_token);
      }
    } else {
      alert(data.detail || "Cập nhật thất bại!");
    }
  };

  // ── Login ─────────────────────────────────────────────────
  if (!token) {
    return (
      <div style={styles.authContainer}>
        <form onSubmit={adminLogin} style={styles.authCard}>
          <div style={styles.authLogoWrap}>
            <div style={styles.authLogo}>⚙️</div>
          </div>
          <h2 style={styles.authTitle}>Quản trị hệ thống</h2>
          <p style={styles.authSubtitle}>Đăng nhập bằng tài khoản Admin</p>
          <input name="username" style={styles.input} placeholder="Tên đăng nhập" />
          <input name="password" type="password" style={styles.input} placeholder="Mật khẩu" />
          <button style={styles.primaryBtn} type="submit">Đăng nhập</button>
        </form>
      </div>
    );
  }

  // ── Admin Layout ──────────────────────────────────────────
  return (
    <div style={styles.adminLayout}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarBrand}>
          <span style={{ fontSize: 20 }}>⚙️</span>
          <span>RAG ADMIN</span>
        </div>

        <nav style={{ flex: 1 }}>
          <div
            style={tab === "documents" ? styles.sideItemActive : styles.sideItem}
            onClick={() => setTab("documents")}
          >
            <span>📂</span> Tài liệu
          </div>
          <div
            style={tab === "users" ? styles.sideItemActive : styles.sideItem}
            onClick={() => setTab("users")}
          >
            <span>👥</span> Người dùng
          </div>
          <div
            style={tab === "settings" ? styles.sideItemActive : styles.sideItem}
            onClick={() => setTab("settings")}
          >
            <span>🔒</span> Bảo mật
          </div>
        </nav>

        {/* ✅ Stats nhỏ ở sidebar */}
        <div style={styles.sideStats}>
          <div style={styles.statItem}>
            <span style={styles.statNum}>{documents.length}</span>
            <span style={styles.statLabel}>Tài liệu</span>
          </div>
          <div style={styles.statDivider} />
          <div style={styles.statItem}>
            <span style={styles.statNum}>{users.length}</span>
            <span style={styles.statLabel}>Người dùng</span>
          </div>
        </div>

        <button
          style={styles.logoutBtn}
          onClick={() => {
            localStorage.removeItem("adminToken");
            setToken("");
          }}
        >
          Đăng xuất
        </button>
      </aside>

      {/* Main */}
      <main style={styles.mainContent}>
        {/* Content Header */}
        <header style={styles.contentHeader}>
          <div>
            <h1 style={styles.contentTitle}>
              {tab === "documents" && "Quản lý Tài liệu RAG"}
              {tab === "users" && "Quản lý Người dùng"}
              {tab === "settings" && "Bảo mật tài khoản"}
            </h1>
            <p style={styles.contentSubtitle}>
              {tab === "documents" && `${documents.length} tài liệu · ${documents.filter(d => d.status === "done").length} đã xử lý`}
              {tab === "users" && `${users.length} người dùng · ${users.filter(u => u.is_admin).length} admin`}
              {tab === "settings" && "Cập nhật tài khoản và mật khẩu quản trị"}
            </p>
          </div>

          {tab === "documents" && (
            <div style={{ display: "flex", gap: 8 }}>
              {/* ✅ Nút refresh */}
              <button
                onClick={handleRefresh}
                style={styles.refreshBtn}
                disabled={refreshing}
              >
                {refreshing ? "⟳ Đang tải..." : "↻ Làm mới"}
              </button>
              <label style={uploading ? { ...styles.uploadBtn, opacity: 0.6 } : styles.uploadBtn}>
                {uploading ? "⟳ Đang xử lý..." : "+ Thêm PDF"}
                <input type="file" hidden onChange={handleUpload} accept=".pdf" disabled={uploading} />
              </label>
            </div>
          )}
        </header>

        {/* Create User Form */}
        {tab === "users" && (
          <div style={styles.createUserCard}>
            <p style={styles.createUserLabel}>Cấp tài khoản mới</p>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                style={styles.formInput}
                placeholder="Tên đăng nhập..."
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
              />
              <input
                style={styles.formInput}
                type="password"
                placeholder="Mật khẩu..."
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button style={styles.uploadBtn} onClick={createUser}>
                + Tạo tài khoản
              </button>
            </div>
          </div>
        )}

        {/* Update Credentials Form */}
        {tab === "settings" && (
          <form style={styles.createUserCard} onSubmit={updateAdminCredentials}>
            <p style={styles.createUserLabel}>Thay đổi thông tin đăng nhập Admin</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 400 }}>
              <input
                style={styles.formInput}
                type="password"
                placeholder="Mật khẩu hiện tại (Bắt buộc) *"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
              <div style={{ height: 1, background: "#f1f5f9", margin: "4px 0" }} />
              <input
                style={styles.formInput}
                placeholder="Tên đăng nhập mới (Tùy chọn)"
                value={adminNewUsername}
                onChange={(e) => setAdminNewUsername(e.target.value)}
              />
              <input
                style={styles.formInput}
                type="password"
                placeholder="Mật khẩu mới (Tùy chọn)"
                value={adminNewPassword}
                onChange={(e) => setAdminNewPassword(e.target.value)}
              />
              <button type="submit" style={{ ...styles.uploadBtn, marginTop: 8 }}>
                ✓ Cập nhật
              </button>
            </div>
          </form>
        )}

        {/* Table */}
        {(tab === "documents" || tab === "users") && (
        <div style={styles.tableCard}>
          <table style={styles.table}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ ...styles.th, width: 60 }}>ID</th>
                <th style={styles.th}>{tab === "documents" ? "Tên File" : "Tên đăng nhập"}</th>
                <th style={styles.th}>Trạng thái / Vai trò</th>
                {tab === "documents" && <th style={styles.th}>Ngày tải lên</th>}
                <th style={{ ...styles.th, width: 100, textAlign: "center" }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {/* ✅ Empty state */}
              {tab === "documents" && documents.length === 0 && (
                <tr>
                  <td colSpan={5} style={styles.emptyState}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                    <div>Chưa có tài liệu nào.</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                      Nhấn "+ Thêm PDF" để upload tài liệu đầu tiên.
                    </div>
                  </td>
                </tr>
              )}
              {tab === "users" && users.length === 0 && (
                <tr>
                  <td colSpan={4} style={styles.emptyState}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
                    <div>Chưa có người dùng nào.</div>
                  </td>
                </tr>
              )}

              {tab === "documents"
                ? documents.map((doc) => {
                    const s = STATUS_STYLE[doc.status] || STATUS_STYLE.pending;
                    return (
                      <tr key={doc.id} style={styles.tr}>
                        <td style={{ ...styles.td, color: "#94a3b8", fontSize: 12 }}>#{doc.id}</td>
                        <td style={styles.td}>
                          <div style={{ fontWeight: 600, color: "#1e293b", fontSize: 14 }}>
                            {doc.filename}
                          </div>
                          {doc.error_message && (
                            <div style={{ fontSize: 11, color: "#ef4444", marginTop: 2 }}>
                              ⚠ {doc.error_message}
                            </div>
                          )}
                        </td>
                        <td style={styles.td}>
                          <span style={{ ...styles.badge, background: s.bg, color: s.color }}>
                            {s.label}
                          </span>
                        </td>
                        <td style={{ ...styles.td, fontSize: 12, color: "#64748b" }}>
                          {doc.created_at
                            ? new Date(doc.created_at).toLocaleDateString("vi-VN")
                            : "—"}
                        </td>
                        <td style={{ ...styles.td, textAlign: "center" }}>
                          <button
                            onClick={() => deleteDoc(doc.id)}
                            style={styles.delBtn}
                            disabled={doc.status === "processing"}
                            title={doc.status === "processing" ? "Đang xử lý, không thể xóa" : "Xóa"}
                          >
                            🗑 Xóa
                          </button>
                        </td>
                      </tr>
                    );
                  })
                : users.map((user) => (
                    <tr key={user.id} style={styles.tr}>
                      <td style={{ ...styles.td, color: "#94a3b8", fontSize: 12 }}>#{user.id}</td>
                      <td style={styles.td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={styles.userAvatar}>
                            {user.username[0].toUpperCase()}
                          </div>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{user.username}</span>
                        </div>
                      </td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.badge,
                          background: user.is_admin ? "#f3e8ff" : "#f1f5f9",
                          color: user.is_admin ? "#7c3aed" : "#475569",
                        }}>
                          {user.is_admin ? "👑 Admin" : "👤 User"}
                        </span>
                      </td>
                      <td style={{ ...styles.td, textAlign: "center" }}>
                        {user.username !== "admin" && (
                          <button style={styles.delBtn} onClick={() => deleteUser(user.id)}>
                            🗑 Xóa
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  adminLayout: { display: "flex", height: "100vh", background: "#f1f5f9" },

  // ── Sidebar ──
  sidebar: {
    width: 240,
    background: "#0f172a",
    color: "#fff",
    padding: "24px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  sidebarBrand: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 32,
    color: "#38bdf8",
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingLeft: 4,
  },
  sideItem: {
    padding: "10px 12px",
    borderRadius: 8,
    cursor: "pointer",
    color: "#94a3b8",
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  sideItemActive: {
    padding: "10px 12px",
    borderRadius: 8,
    cursor: "pointer",
    background: "#1e293b",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  sideStats: {
    marginTop: "auto",
    marginBottom: 16,
    background: "#1e293b",
    borderRadius: 10,
    padding: "14px",
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
  },
  statItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  statNum: { fontSize: 22, fontWeight: 700, color: "#38bdf8" },
  statLabel: { fontSize: 11, color: "#64748b" },
  statDivider: { width: 1, height: 30, background: "#334155" },
  logoutBtn: {
    background: "#ef4444",
    color: "#fff",
    border: "none",
    padding: "10px",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
  },

  // ── Main ──
  mainContent: { flex: 1, padding: 32, overflowY: "auto" },
  contentHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  contentTitle: { fontSize: 22, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" },
  contentSubtitle: { fontSize: 13, color: "#64748b", margin: 0 },

  // ── Create user ──
  createUserCard: {
    background: "#fff",
    borderRadius: 12,
    padding: "16px 20px",
    marginBottom: 20,
    border: "0.5px solid #e2e8f0",
  },
  createUserLabel: { fontSize: 13, fontWeight: 600, color: "#475569", margin: "0 0 10px" },
  formInput: {
    flex: 1,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    outline: "none",
    fontSize: 14,
    color: "#1e293b",
  },

  // ── Table ──
  tableCard: {
    background: "#fff",
    borderRadius: 12,
    border: "0.5px solid #e2e8f0",
    overflow: "hidden",
  },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    padding: "13px 16px",
    borderBottom: "0.5px solid #e2e8f0",
    color: "#475569",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  td: { padding: "14px 16px", borderBottom: "0.5px solid #f1f5f9", fontSize: 14 },
  tr: { transition: "background 0.1s" },
  badge: {
    padding: "4px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    display: "inline-block",
  },
  delBtn: {
    color: "#ef4444",
    border: "none",
    background: "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
    padding: "4px 8px",
    borderRadius: 6,
  },
  refreshBtn: {
    padding: "9px 16px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#fff",
    color: "#475569",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
  },
  uploadBtn: {
    background: "#1e3a8a",
    color: "#fff",
    padding: "9px 18px",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
    border: "none",
  },
  userAvatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#dbeafe",
    color: "#1d4ed8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  emptyState: {
    textAlign: "center",
    padding: "50px 20px",
    color: "#64748b",
    fontSize: 14,
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
    padding: 40,
    borderRadius: 20,
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    width: 340,
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },
  authLogoWrap: { display: "flex", justifyContent: "center", marginBottom: 16 },
  authLogo: {
    width: 56,
    height: 56,
    borderRadius: 14,
    background: "#0f172a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 26,
  },
  authTitle: { textAlign: "center", fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 6px" },
  authSubtitle: { textAlign: "center", fontSize: 13, color: "#64748b", margin: "0 0 24px" },
  input: {
    width: "100%",
    padding: 12,
    marginBottom: 12,
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    boxSizing: "border-box",
    fontSize: 14,
    outline: "none",
  },
  primaryBtn: {
    width: "100%",
    padding: 12,
    borderRadius: 8,
    border: "none",
    background: "#1e3a8a",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 15,
  },
};