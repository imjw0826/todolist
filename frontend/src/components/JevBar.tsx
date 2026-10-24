import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useCreateNode, useTree } from "../hooks";
import { chooseParent, JevError, listParents } from "../lib/jev";
import { useAdmin, useJevKey, useNodeReveal } from "../store";

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; title: string; path: string; confidence: number }
  // When Jev can't answer, let the user pick the parent and still add it.
  | { kind: "failed"; message: string; title: string };

/**
 * Input bar at the top of the screen. Type an item, and Jev decides which
 * node it belongs under; it is then added there as a new child node.
 */
export function JevBar() {
  const { isAdmin } = useAdmin();
  const { apiKey, setApiKey } = useJevKey();
  const reveal = useNodeReveal((s) => s.reveal);
  const { data: tree } = useTree();
  const create = useCreateNode();

  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [manualId, setManualId] = useState<number | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");

  const parents = useMemo(() => (tree ? listParents(tree) : []), [tree]);
  const busy = status.kind === "busy";
  const canSubmit = isAdmin && !busy && !!tree && !!value.trim();

  const add = async (title: string, parentId: number, confidence: number) => {
    const node = await create.mutateAsync({ parent_id: parentId, title });
    const path = parents.find((p) => p.id === parentId)?.path ?? "";
    setStatus({ kind: "done", title, path, confidence });
    setValue("");
    reveal(node.id, parentId);
  };

  const submit = async () => {
    if (!canSubmit || !tree) return;
    if (!apiKey) {
      setKeyDraft("");
      setKeyOpen(true);
      return;
    }
    const title = value.trim();
    setStatus({ kind: "busy" });
    let placement;
    try {
      placement = await chooseParent(title, tree, apiKey);
    } catch (e) {
      const message = e instanceof JevError ? e.message : "Jev가 위치를 정하지 못했어요.";
      setManualId(parents[0]?.id ?? null);
      setStatus({ kind: "failed", message, title });
      return;
    }
    try {
      await add(title, placement.parentId, placement.confidence);
    } catch {
      // useCreateNode already alerts with the reason.
      setStatus({ kind: "idle" });
    }
  };

  const addManually = async () => {
    if (status.kind !== "failed" || manualId == null) return;
    const { title } = status;
    setStatus({ kind: "busy" });
    try {
      await add(title, manualId, 1);
    } catch {
      setStatus({ kind: "idle" });
    }
  };

  return (
    <>
      <div className="jev-bar-wrap">
        <form
          className={`jev-bar${isAdmin ? "" : " is-locked"}`}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            type="text"
            value={value}
            disabled={!isAdmin || busy}
            maxLength={200}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              isAdmin
                ? "추가할 항목을 입력하면 Jev가 알맞은 자리에 넣어요"
                : "🔒 관리자 모드에서 추가할 수 있어요"
            }
            aria-label="추가할 항목"
          />
          {isAdmin && (
            <>
              <button
                type="button"
                className="jev-icon"
                title="Jev API 키"
                aria-label="Jev API 키 설정"
                onClick={() => {
                  setKeyDraft(apiKey);
                  setKeyOpen(true);
                }}
              >
                ⚙
              </button>
              <button type="submit" className="jev-send" disabled={!canSubmit}>
                {busy ? "찾는 중…" : "추가"}
              </button>
            </>
          )}
        </form>

        {status.kind === "done" && (
          <p className="jev-status">
            <strong>{status.title}</strong> → {status.path} 밑에 추가했어요
            {status.confidence < 1 && ` · ${Math.round(status.confidence * 100)}%`}
          </p>
        )}
        {status.kind === "failed" && (
          <div className="jev-status is-error">
            <span>{status.message}</span>
            <span className="jev-manual">
              직접 고르기
              <select
                value={manualId ?? ""}
                onChange={(e) => setManualId(Number(e.target.value))}
              >
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.path}
                  </option>
                ))}
              </select>
              <button type="button" onClick={addManually}>
                추가
              </button>
            </span>
          </div>
        )}
      </div>

      {keyOpen &&
        createPortal(
          <div className="modal-backdrop" onClick={() => setKeyOpen(false)}>
            <form
              className="modal"
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                setApiKey(keyDraft.trim());
                setKeyOpen(false);
              }}
            >
              <h2>Jev API 키</h2>
              <p className="modal-sub">
                TypeSafe AI에서 발급한 키. 이 기기의 브라우저에만 저장돼요.
              </p>
              <input
                type="text"
                autoFocus
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="row">
                <button type="button" onClick={() => setKeyOpen(false)}>
                  취소
                </button>
                <button type="submit" className="primary">
                  저장
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}
    </>
  );
}
