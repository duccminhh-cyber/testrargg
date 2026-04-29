import { useState, useEffect } from "react";

const API = "/api";

export default function AdminApp() {
  const [token, setToken] = useState(localStorage.getItem("adminToken") || "");
  const [tab, setTab] = useState("documents");
  const [documents, setDocuments] = useState([]);
  const [users, setUsers] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const headers = { Authorization: `Bearer ${token}` };

  const createUser = async () => {                        // ← sau headers
    if (!newUsername || !newPassword) return alert("Điền đủ username và password!");
    const res = await fetch(`${API}/admin/users`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ username: newUsername, password: newPassword, is_admin: false }),
    });
    if (res.ok) {
      alert("Tạo user thành công!");
      setNewUsername("");
      setNewPassword("");
      fetchUsers();
    } else {
      const err = await res.json();
      alert(err.detail || "Lỗi tạo user!");
    }
  };

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
      password: e.target.password.value
    });
    const res = await fetch(`${API}/auth/login`, { method: "POST", body: form });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem("adminToken", data.access_token);
      setToken(data.access_token);
    } else alert("Sai tài khoản Admin!");
  }

  const fetchDocuments = async () => {
    const res = await fetch(`${API}/documents`, { headers }); // Bỏ chữ /admin/ đi
    if (res.ok) setDocuments(await res.json());
  };

  const fetchUsers = async () => {
    const res = await fetch(`${API}/admin/users`, { headers });
    if (res.ok) setUsers(await res.json());
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API}/documents/upload`, { method: "POST", headers, body: formData });
    if (res.ok) {
      alert("Upload thành công, chờ Worker xử lý!");
      fetchDocuments();
    }
    setUploading(false);
  };

  const deleteDoc = async (id) => {
    if (window.confirm("Xóa file này và toàn bộ Vector Data?")) {
      await fetch(`${API}/documents/${id}`, { method: "DELETE", headers });
      fetchDocuments();
    }
  };

  const deleteUser = async (id) => {
    if (window.confirm("Xóa người dùng này cùng toàn bộ dữ liệu của họ?")) {
      const res = await fetch(`${API}/admin/users/${id}`, { method: "DELETE", headers });
      if (res.ok) {
        alert("Đã xóa thành công!");
        fetchUsers(); // Load lại danh sách
      } else {
        alert("Lỗi khi xóa người dùng!");
      }
    }
  };

  if (!token) {
    return (
      <div style={styles.authContainer}>
        <form onSubmit={adminLogin} style={styles.authCard}>
          <h2 style={{ marginBottom: 20 }}>Quản trị hệ thống</h2>
          <input name="username" style={styles.input} placeholder="Admin Username" />
          <input name="password" type="password" style={styles.input} placeholder="Password" />
          <button style={styles.primaryBtn}>Đăng nhập Quản lý</button>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.adminLayout}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarBrand}>RAG ADMIN</div>
        <div style={tab === 'documents' ? styles.sideItemActive : styles.sideItem} onClick={() => setTab('documents')}>📂 Tài liệu</div>
        <div style={tab === 'users' ? styles.sideItemActive : styles.sideItem} onClick={() => setTab('users')}>👥 Người dùng</div>
        <button style={styles.logoutBtn} onClick={() => { localStorage.removeItem("adminToken"); setToken(""); }}>Thoát</button>
      </aside>

      <main style={styles.mainContent}>
        <header style={styles.contentHeader}>
          <h1>{tab === 'documents' ? "Quản lý Tài liệu RAG" : "Quản lý Người dùng"}</h1>
          {tab === 'documents' && (
            <label style={styles.uploadBtn}>
              {uploading ? "Đang xử lý..." : "+ Thêm PDF mới"}
              <input type="file" hidden onChange={handleUpload} accept=".pdf" disabled={uploading} />
            </label>
          )}
        </header>

        {tab === 'users' && (
          <div style={{ display: "flex", gap: "10px", marginBottom: "20px", background: "#fff", padding: "15px", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)" }}>
            <input
              style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1", outline: "none" }}
              placeholder="Tên đăng nhập mới..."
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
            />
            <input
              style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1", outline: "none" }}
              type="password"
              placeholder="Mật khẩu..."
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
            />
            <button style={styles.uploadBtn} onClick={createUser}>
              + Cấp tài khoản
            </button>
          </div>
        )}

        <div style={styles.tableCard}>
          <table style={styles.table}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>{tab === 'documents' ? "Tên File" : "Tên đăng nhập"}</th>
                <th style={styles.th}>Trạng thái / Vai trò</th>
                <th style={styles.th}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {tab === 'documents' ? documents.map(doc => (
                <tr key={doc.id} style={styles.tr}>
                  <td style={styles.td}>{doc.id}</td>
                  <td style={styles.td}><b>{doc.filename}</b></td>
                  <td style={styles.td}>
                    <span style={{ ...styles.badge, background: doc.status === 'done' ? '#dcfce7' : '#fef9c3' }}>{doc.status}</span>
                  </td>
                  <td style={styles.td}><button onClick={() => deleteDoc(doc.id)} style={styles.delBtn}>Xóa</button></td>
                </tr>
              )) : users.map(user => (
                <tr key={user.id} style={styles.tr}>
                  <td style={styles.td}>{user.id}</td>
                  <td style={styles.td}>{user.username}</td>
                  <td style={styles.td}>{user.is_admin ? "Admin" : "User"}</td>
                  <td style={styles.td}>
                    {user.username !== 'admin' && (
                      <button style={styles.delBtn} onClick={() => deleteUser(user.id)}>Xóa</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

const styles = {
  adminLayout: { display: 'flex', height: '100vh', background: '#f1f5f9' },
  sidebar: { width: '260px', background: '#1e293b', color: '#fff', padding: '20px', display: 'flex', flexDirection: 'column' },
  sidebarBrand: { fontSize: '22px', fontWeight: 'bold', marginBottom: '40px', textAlign: 'center', color: '#38bdf8' },
  sideItem: { padding: '12px 15px', borderRadius: '8px', cursor: 'pointer', marginBottom: '5px', color: '#94a3b8' },
  sideItemActive: { padding: '12px 15px', borderRadius: '8px', cursor: 'pointer', marginBottom: '5px', background: '#334155', color: '#fff', fontWeight: 'bold' },
  mainContent: { flex: 1, padding: '40px', overflowY: 'auto' },
  contentHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' },
  tableCard: { background: '#fff', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '15px', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: '14px' },
  td: { padding: '15px', borderBottom: '1px solid #f1f5f9', fontSize: '14px' },
  badge: { padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' },
  uploadBtn: { background: '#2563eb', color: '#fff', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
  delBtn: { color: '#ef4444', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold' },
  logoutBtn: { marginTop: 'auto', background: '#ef4444', color: '#fff', border: 'none', padding: '10px', borderRadius: '8px', cursor: 'pointer' },
  // Login tương tự App.jsx
  authContainer: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' },
  authCard: { background: '#fff', padding: '40px', borderRadius: '16px', width: '320px' },
  input: { width: '100%', padding: '12px', marginBottom: '15px', borderRadius: '8px', border: '1px solid #ddd', boxSizing: 'border-box' },
  primaryBtn: { width: '100%', padding: '12px', borderRadius: '8px', border: 'none', background: '#2563eb', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }
};