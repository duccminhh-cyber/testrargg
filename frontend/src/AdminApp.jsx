import { useEffect, useMemo, useState } from "react";

const API = "/api";

const STATUS_STYLE = {
  done: { bg: "#dcfce7", color: "#166534", label: "Hoàn thành" },
  processing: { bg: "#dbeafe", color: "#1e40af", label: "Đang xử lý" },
  pending: { bg: "#fef9c3", color: "#854d0e", label: "Chờ xử lý" },
  error: { bg: "#fee2e2", color: "#991b1b", label: "Lỗi" },
};

function ThemeToggle({ theme, setTheme }) {
  return (
    <button style={styles.themeToggle(theme)} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      <span>{theme === "dark" ? "☀" : "☾"}</span>
      {theme === "dark" ? "Sáng" : "Tối"}
    </button>
  );
}

export default function AdminApp() {
  const [token, setToken] = useState(localStorage.getItem("adminToken") || "");
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "light");
  const [tab, setTab] = useState("documents");
  const [documents, setDocuments] = useState([]);
  const [users, setUsers] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [adminNewUsername, setAdminNewUsername] = useState("");
  const [adminNewPassword, setAdminNewPassword] = useState("");

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  const headers = { Authorization: `Bearer ${token}` };
  const doneDocs = documents.filter((d) => d.status === "done").length;
  const processingDocs = documents.filter((d) => d.status === "processing" || d.status === "pending").length;
  const adminUsers = users.filter((u) => u.is_admin).length;

  const pageTitle = useMemo(() => {
    if (tab === "users") return ["Người dùng", "Quản lý quyền truy cập và tài khoản sử dụng hệ thống."];
    if (tab === "settings") return ["Bảo mật", "Cập nhật thông tin đăng nhập của quản trị viên."];
    return ["Kho tri thức", "Theo dõi tài liệu, trạng thái ingest và chất lượng nguồn RAG."];
  }, [tab]);

  function handleLogout() {
    localStorage.removeItem("adminToken");
    setToken("");
    setDocuments([]);
    setUsers([]);
  }

  async function safeFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    });
    if (res.status === 401) {
      handleLogout();
      return null;
    }
    return res;
  }

  async function fetchDocuments() {
    const res = await safeFetch(`${API}/documents`);
    if (res?.ok) setDocuments(await res.json());
  }

  async function fetchUsers() {
    const res = await safeFetch(`${API}/admin/users`);
    if (res?.ok) setUsers(await res.json());
  }

  useEffect(() => {
    if (!token) return;
    async function init() {
      try {
        await Promise.all([fetchDocuments(), fetchUsers()]);
      } catch {
        setTimeout(init, 1500);
      }
    }
    init();
  }, [token]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchDocuments(), fetchUsers()]);
    setRefreshing(false);
  };

  async function adminLogin(e) {
    e.preventDefault();
    const form = new URLSearchParams({
      username: e.target.username.value,
      password: e.target.password.value,
    });
    const res = await fetch(`${API}/auth/login`, { method: "POST", body: form });
    const data = await res.json();
    if (res.ok && data.is_admin) {
      localStorage.setItem("adminToken", data.access_token);
      setToken(data.access_token);
      return;
    }
    alert(data.detail || "Tài khoản không có quyền Admin hoặc thông tin đăng nhập sai.");
  }

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const res = await safeFetch(`${API}/documents/upload`, { method: "POST", body: formData });
    if (res?.ok) await fetchDocuments();
    else if (res) alert((await res.json()).detail || "Upload thất bại.");
    setUploading(false);
    e.target.value = "";
  };

  const deleteDoc = async (id) => {
    if (!window.confirm("Xóa file này và toàn bộ vector data?")) return;
    const res = await safeFetch(`${API}/documents/${id}`, { method: "DELETE" });
    if (res?.ok) fetchDocuments();
    else if (res) alert((await res.json()).detail || "Không thể xóa tài liệu.");
  };

  const deleteUser = async (id) => {
    if (!window.confirm("Xóa người dùng này cùng toàn bộ dữ liệu của họ?")) return;
    const res = await safeFetch(`${API}/admin/users/${id}`, { method: "DELETE" });
    if (res?.ok) fetchUsers();
  };

  const createUser = async () => {
    if (!newUsername || !newPassword) return alert("Điền đủ username và password.");
    const res = await safeFetch(`${API}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername, password: newPassword, is_admin: false }),
    });
    if (res?.ok) {
      setNewUsername("");
      setNewPassword("");
      fetchUsers();
    } else if (res) {
      alert((await res.json()).detail || "Lỗi tạo user.");
    }
  };

  const updateAdminCredentials = async (e) => {
    e.preventDefault();
    if (!currentPassword) return alert("Nhập mật khẩu hiện tại để xác thực.");
    if (!adminNewUsername && !adminNewPassword) return alert("Nhập username hoặc password mới.");
    const res = await safeFetch(`${API}/auth/update-credentials`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password: currentPassword,
        new_username: adminNewUsername || null,
        new_password: adminNewPassword || null,
      }),
    });
    const data = await res?.json();
    if (res?.ok) {
      setCurrentPassword("");
      setAdminNewUsername("");
      setAdminNewPassword("");
      if (data?.access_token) {
        localStorage.setItem("adminToken", data.access_token);
        setToken(data.access_token);
      }
    } else if (data) {
      alert(data.detail || "Cập nhật thất bại.");
    }
  };

  if (!token) {
    return (
      <div style={styles.authShell(theme)}>
        <form onSubmit={adminLogin} style={styles.authCard(theme)}>
          <div style={styles.authTop}>
            <div style={styles.brandMark}>R</div>
            <ThemeToggle theme={theme} setTheme={setTheme} />
          </div>
          <h1 style={styles.authTitle(theme)}>RAG Control Center</h1>
          <p style={styles.authSubtitle(theme)}>Đăng nhập để quản trị tài liệu, người dùng và pipeline tri thức.</p>
          <input name="username" style={styles.input(theme)} placeholder="Tên đăng nhập" />
          <input name="password" type="password" style={styles.input(theme)} placeholder="Mật khẩu" />
          <button style={styles.primaryBtn} type="submit">Đăng nhập</button>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.shell(theme)}>
      <aside style={styles.sidebar(theme)}>
        <div style={styles.brand(theme)}>
          <div style={styles.brandMark}>R</div>
          <div>
            <div style={styles.brandTitle(theme)}>RAG Admin</div>
            <div style={styles.brandSub(theme)}>Knowledge Ops</div>
          </div>
        </div>

        <nav style={styles.nav}>
          {[
            ["documents", "▦", "Tài liệu"],
            ["users", "◉", "Người dùng"],
            ["settings", "◈", "Bảo mật"],
          ].map(([key, icon, label]) => (
            <button key={key} style={styles.navItem(theme, tab === key)} onClick={() => setTab(key)}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </nav>

        <div style={styles.sideCard(theme)}>
          <div style={styles.sideMetric(theme)}><b>{documents.length}</b><span>Tài liệu</span></div>
          <div style={styles.sideMetric(theme)}><b>{users.length}</b><span>Người dùng</span></div>
        </div>

        <button style={styles.logoutBtn(theme)} onClick={handleLogout}>Đăng xuất</button>
      </aside>

      <main style={styles.main(theme)}>
        <header style={styles.header(theme)}>
          <div>
            <div style={styles.eyebrow(theme)}>Enterprise RAG Operations</div>
            <h1 style={styles.title(theme)}>{pageTitle[0]}</h1>
            <p style={styles.subtitle(theme)}>{pageTitle[1]}</p>
          </div>
          <div style={styles.headerActions}>
            <ThemeToggle theme={theme} setTheme={setTheme} />
            <button onClick={handleRefresh} style={styles.secondaryBtn(theme)} disabled={refreshing}>
              {refreshing ? "Đang tải..." : "Làm mới"}
            </button>
            {tab === "documents" && (
              <label style={styles.primaryBtn}>
                {uploading ? "Đang xử lý..." : "Thêm PDF"}
                <input type="file" hidden onChange={handleUpload} accept=".pdf" disabled={uploading} />
              </label>
            )}
          </div>
        </header>

        <section style={styles.kpiGrid}>
          <div style={styles.kpi(theme)}><span>Tài liệu sẵn sàng</span><b>{doneDocs}</b><small>{processingDocs} đang xử lý</small></div>
          <div style={styles.kpi(theme)}><span>Người dùng</span><b>{users.length}</b><small>{adminUsers} admin</small></div>
          <div style={styles.kpi(theme)}><span>Chất lượng nguồn</span><b>{documents.length ? Math.round((doneDocs / documents.length) * 100) : 0}%</b><small>PDF ingest hoàn tất</small></div>
        </section>

        {tab === "users" && (
          <section style={styles.panel(theme)}>
            <div style={styles.panelTitle(theme)}>Cấp tài khoản mới</div>
            <div style={styles.formRow}>
              <input style={styles.input(theme)} placeholder="Tên đăng nhập" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
              <input style={styles.input(theme)} type="password" placeholder="Mật khẩu" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <button style={styles.primaryBtn} onClick={createUser}>Tạo tài khoản</button>
            </div>
          </section>
        )}

        {tab === "settings" && (
          <form style={styles.panel(theme)} onSubmit={updateAdminCredentials}>
            <div style={styles.panelTitle(theme)}>Thông tin đăng nhập Admin</div>
            <div style={styles.formColumn}>
              <input style={styles.input(theme)} type="password" placeholder="Mật khẩu hiện tại" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              <input style={styles.input(theme)} placeholder="Tên đăng nhập mới" value={adminNewUsername} onChange={(e) => setAdminNewUsername(e.target.value)} />
              <input style={styles.input(theme)} type="password" placeholder="Mật khẩu mới" value={adminNewPassword} onChange={(e) => setAdminNewPassword(e.target.value)} />
              <button type="submit" style={styles.primaryBtn}>Cập nhật</button>
            </div>
          </form>
        )}

        {(tab === "documents" || tab === "users") && (
          <section style={styles.tablePanel(theme)}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th(theme)}>ID</th>
                  <th style={styles.th(theme)}>{tab === "documents" ? "Tên file" : "Tài khoản"}</th>
                  <th style={styles.th(theme)}>{tab === "documents" ? "Trạng thái" : "Vai trò"}</th>
                  {tab === "documents" && <th style={styles.th(theme)}>Ngày tải lên</th>}
                  <th style={{ ...styles.th(theme), textAlign: "right" }}>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {tab === "documents" ? documents.map((doc) => {
                  const s = STATUS_STYLE[doc.status] || STATUS_STYLE.pending;
                  return (
                    <tr key={doc.id} style={styles.tr(theme)}>
                      <td style={styles.td(theme)}>#{doc.id}</td>
                      <td style={styles.td(theme)}><b>{doc.filename}</b>{doc.error_message && <small style={styles.errorText}>{doc.error_message}</small>}</td>
                      <td style={styles.td(theme)}><span style={{ ...styles.badge, background: s.bg, color: s.color }}>{s.label}</span></td>
                      <td style={styles.td(theme)}>{doc.created_at ? new Date(doc.created_at).toLocaleDateString("vi-VN") : "-"}</td>
                      <td style={{ ...styles.td(theme), textAlign: "right" }}><button style={styles.dangerBtn(theme)} disabled={doc.status === "processing"} onClick={() => deleteDoc(doc.id)}>Xóa</button></td>
                    </tr>
                  );
                }) : users.map((user) => (
                  <tr key={user.id} style={styles.tr(theme)}>
                    <td style={styles.td(theme)}>#{user.id}</td>
                    <td style={styles.td(theme)}><b>{user.username}</b></td>
                    <td style={styles.td(theme)}><span style={{ ...styles.badge, background: user.is_admin ? "#f3e8ff" : "#eef2f7", color: user.is_admin ? "#7c3aed" : "#475569" }}>{user.is_admin ? "Admin" : "User"}</span></td>
                    <td style={{ ...styles.td(theme), textAlign: "right" }}>{user.username !== "admin" && <button style={styles.dangerBtn(theme)} onClick={() => deleteUser(user.id)}>Xóa</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}

const isDark = (theme) => theme === "dark";
const surface = (theme) => isDark(theme) ? "#101a28" : "#ffffff";
const text = (theme) => isDark(theme) ? "#edf4fb" : "#102033";
const muted = (theme) => isDark(theme) ? "#94a3b8" : "#60758c";
const border = (theme) => isDark(theme) ? "#24364b" : "#dbe5ef";

const styles = {
  shell: (theme) => ({ minHeight: "100vh", display: "flex", background: isDark(theme) ? "#07111f" : "#f5f8fb", color: text(theme), fontFamily: "Inter, system-ui, sans-serif" }),
  sidebar: (theme) => ({ width: 280, padding: 18, display: "flex", flexDirection: "column", gap: 16, background: isDark(theme) ? "#08111d" : "#ffffff", borderRight: `1px solid ${border(theme)}` }),
  brand: (theme) => ({ display: "flex", alignItems: "center", gap: 12, padding: "10px 8px 18px", borderBottom: `1px solid ${border(theme)}` }),
  brandMark: { width: 38, height: 38, borderRadius: 8, display: "grid", placeItems: "center", color: "#fff", fontWeight: 900, background: "linear-gradient(135deg,#0ea5e9,#22c55e)" },
  brandTitle: (theme) => ({ color: text(theme), fontWeight: 850, fontSize: 15 }),
  brandSub: (theme) => ({ color: muted(theme), fontSize: 12 }),
  nav: { display: "flex", flexDirection: "column", gap: 8 },
  navItem: (theme, active) => ({ display: "flex", gap: 10, alignItems: "center", padding: "11px 12px", borderRadius: 8, border: `1px solid ${active ? "rgba(14,165,233,.35)" : "transparent"}`, background: active ? "rgba(14,165,233,.12)" : "transparent", color: active ? (isDark(theme) ? "#e0f7ff" : "#0e7490") : muted(theme), cursor: "pointer", textAlign: "left" }),
  sideCard: (theme) => ({ marginTop: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: 12, borderRadius: 8, background: isDark(theme) ? "#101a28" : "#f4f8fb", border: `1px solid ${border(theme)}` }),
  sideMetric: (theme) => ({ display: "flex", flexDirection: "column", gap: 2, color: muted(theme), fontSize: 12 }),
  logoutBtn: (theme) => ({ padding: 11, borderRadius: 8, border: `1px solid ${border(theme)}`, background: isDark(theme) ? "#1b2433" : "#fff", color: text(theme), cursor: "pointer", fontWeight: 750 }),
  main: (theme) => ({ flex: 1, padding: 30, overflowY: "auto", background: isDark(theme) ? "linear-gradient(180deg,#0b1422,#07111f)" : "linear-gradient(180deg,#f8fbfd,#eef4f8)" }),
  header: () => ({ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", marginBottom: 20 }),
  eyebrow: (theme) => ({ fontSize: 12, color: muted(theme), textTransform: "uppercase", fontWeight: 850 }),
  title: (theme) => ({ margin: "3px 0", fontSize: 32, color: text(theme), letterSpacing: 0 }),
  subtitle: (theme) => ({ margin: 0, color: muted(theme), fontSize: 14 }),
  headerActions: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" },
  themeToggle: (theme) => ({ display: "inline-flex", gap: 8, alignItems: "center", padding: "9px 12px", borderRadius: 8, border: `1px solid ${border(theme)}`, background: surface(theme), color: text(theme), cursor: "pointer", fontWeight: 750 }),
  primaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "10px 16px", minHeight: 40, borderRadius: 8, border: 0, background: "linear-gradient(135deg,#0e7490,#22c55e)", color: "#fff", cursor: "pointer", fontWeight: 850 },
  secondaryBtn: (theme) => ({ padding: "10px 14px", borderRadius: 8, border: `1px solid ${border(theme)}`, background: surface(theme), color: text(theme), cursor: "pointer", fontWeight: 750 }),
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 14, marginBottom: 18 },
  kpi: (theme) => ({ padding: 18, borderRadius: 8, background: surface(theme), border: `1px solid ${border(theme)}`, boxShadow: isDark(theme) ? "none" : "0 16px 36px rgba(15,23,42,.06)", display: "flex", flexDirection: "column", gap: 6 }),
  panel: (theme) => ({ padding: 18, borderRadius: 8, background: surface(theme), border: `1px solid ${border(theme)}`, marginBottom: 18 }),
  panelTitle: (theme) => ({ color: text(theme), fontWeight: 850, marginBottom: 12 }),
  formRow: { display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10 },
  formColumn: { display: "grid", maxWidth: 460, gap: 12 },
  input: (theme) => ({ width: "100%", padding: "11px 12px", borderRadius: 8, border: `1px solid ${border(theme)}`, background: isDark(theme) ? "#0b1422" : "#fff", color: text(theme), outline: "none" }),
  tablePanel: (theme) => ({ overflow: "hidden", borderRadius: 8, background: surface(theme), border: `1px solid ${border(theme)}`, boxShadow: isDark(theme) ? "none" : "0 16px 36px rgba(15,23,42,.06)" }),
  table: { width: "100%", borderCollapse: "collapse" },
  th: (theme) => ({ textAlign: "left", padding: "13px 16px", color: muted(theme), fontSize: 12, textTransform: "uppercase", borderBottom: `1px solid ${border(theme)}` }),
  td: (theme) => ({ padding: "15px 16px", color: text(theme), borderBottom: `1px solid ${border(theme)}`, fontSize: 14, verticalAlign: "middle" }),
  tr: () => ({}),
  badge: { padding: "5px 10px", borderRadius: 8, fontSize: 12, fontWeight: 800 },
  dangerBtn: (theme) => ({ padding: "7px 10px", borderRadius: 8, border: `1px solid ${isDark(theme) ? "#7f1d1d" : "#fecaca"}`, background: isDark(theme) ? "#2a1114" : "#fff5f5", color: "#ef4444", cursor: "pointer", fontWeight: 800 }),
  errorText: { display: "block", color: "#ef4444", marginTop: 4 },
  authShell: (theme) => ({ minHeight: "100vh", display: "grid", placeItems: "center", background: isDark(theme) ? "linear-gradient(135deg,#07111f,#102033)" : "linear-gradient(135deg,#e8f7f2,#f8fbfd)" }),
  authCard: (theme) => ({ width: 390, padding: 34, borderRadius: 8, background: surface(theme), border: `1px solid ${border(theme)}`, boxShadow: "0 30px 80px rgba(7,17,31,.22)" }),
  authTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 },
  authTitle: (theme) => ({ color: text(theme), margin: 0, fontSize: 28 }),
  authSubtitle: (theme) => ({ color: muted(theme), lineHeight: 1.6, marginBottom: 22 }),
};
