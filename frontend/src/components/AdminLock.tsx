import { useState } from "react";
import { verifyAdmin } from "../api";
import { useAdmin } from "../store";

export function AdminLock() {
  const { isAdmin, setAdmin, logout } = useAdmin();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const ok = await verifyAdmin(pw);
      if (ok) {
        setAdmin(pw);
        setOpen(false);
        setPw("");
      } else {
        setErr("비밀번호가 올바르지 않습니다.");
      }
    } catch {
      setErr("서버 오류로 확인할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className={`admin-lock${isAdmin ? " is-admin" : ""}`}>
        <span>{isAdmin ? "관리자 모드" : "보기 모드"}</span>
        <button
          onClick={() => (isAdmin ? logout() : setOpen(true))}
          title={isAdmin ? "로그아웃" : "관리자 로그인"}
          aria-label={isAdmin ? "로그아웃" : "관리자 로그인"}
        >
          {isAdmin ? "🔓" : "🔒"}
        </button>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <h2>관리자 비밀번호</h2>
            <input
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="••••"
              maxLength={32}
            />
            {err && <p className="error">{err}</p>}
            <div className="row">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setPw("");
                  setErr(null);
                }}
              >
                취소
              </button>
              <button type="submit" className="primary" disabled={loading}>
                {loading ? "확인 중..." : "확인"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
