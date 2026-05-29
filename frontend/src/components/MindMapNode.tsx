import { motion } from "framer-motion";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { HierarchyPointNode } from "d3-hierarchy";
import type { TreeNode } from "../types";
import { useAdmin } from "../store";
import { useCreateNode, useDeleteNode, useUpdateNode } from "../hooks";

interface Props {
  node: HierarchyPointNode<TreeNode>;
  expanded: boolean;
  hasChildrenInData: boolean;
  focused: boolean;
  focusedDepth: number | null;
  onToggle: (id: number) => void;
  ensureExpanded: (id: number) => void;
  // Initial screen-space coordinates the node should mount at. For freshly
  // visible children, the caller passes the parent's prior position so they
  // appear to fly out from there as the tree unfolds.
  initialX: number;
  initialY: number;
}

// Rough width per character for the node-label font. CJK glyphs are ~font-size
// wide; ASCII is narrower. Used so node boxes hug their label.
function estimateBoxWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    const wide = ch.charCodeAt(0) > 0x2e80;
    w += wide ? fontSize : fontSize * 0.58;
  }
  return Math.max(w, fontSize * 2);
}

export function MindMapNode({
  node,
  expanded,
  hasChildrenInData,
  focused,
  focusedDepth,
  onToggle,
  ensureExpanded,
  initialX,
  initialY,
}: Props) {
  const { isAdmin } = useAdmin();
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.data.title);
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState("");

  const create = useCreateNode();
  const update = useUpdateNode();
  const remove = useDeleteNode();

  // Screen coordinates: d3-tree's x is vertical, y is horizontal.
  const x = node.y;
  const y = node.x;

  const depth = node.depth;
  const isRoot = depth === 0;
  const isTrunk = depth <= 1;

  // Focus scaling: the actively-focused node grows; same-depth siblings shrink.
  // Other depths stay neutral.
  const sameDepthSibling =
    focusedDepth != null && focusedDepth === depth && !focused;
  const focusScale = focused ? 1.18 : sameDepthSibling ? 0.85 : 1;

  const fontSize = isRoot ? 14 : isTrunk ? 13 : 12;
  const padX = isTrunk ? 12 : 10;
  const padY = isTrunk ? 7 : 6;
  const textW = estimateBoxWidth(node.data.title, fontSize);
  const boxW = textW + padX * 2;
  const boxH = fontSize + padY * 2;

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAddTitle("");
    setAddOpen(true);
  };

  const submitAdd = () => {
    const title = addTitle.trim();
    if (!title) return;
    create.mutate(
      { parent_id: node.data.id, title },
      { onSuccess: () => ensureExpanded(node.data.id) }
    );
    setAddOpen(false);
    setAddTitle("");
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRoot) return;
    if (!window.confirm(`"${node.data.title}" 와 모든 하위 노드를 삭제할까요?`))
      return;
    remove.mutate(node.data.id);
  };

  const submitEdit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== node.data.title) {
      update.mutate({ id: node.data.id, title: next });
    } else {
      setDraft(node.data.title);
    }
  };

  const labelFontWeight = isRoot ? 600 : isTrunk ? 500 : 400;

  return (
    <>
      <motion.g
        initial={{ x: initialX, y: initialY, opacity: 0, scale: 0.6 }}
        animate={{ x, y, opacity: 1, scale: focusScale }}
        exit={{ opacity: 0, scale: 0.5 }}
        transition={{
          x: { type: "spring", stiffness: 180, damping: 22 },
          y: { type: "spring", stiffness: 180, damping: 22 },
          scale: { type: "spring", stiffness: 220, damping: 24 },
          opacity: { duration: 0.3 },
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <rect
          x={-boxW / 2}
          y={-boxH / 2}
          width={boxW}
          height={boxH}
          rx={boxH / 2}
          ry={boxH / 2}
          fill="white"
          stroke="#1f1f1f"
          strokeWidth={isRoot ? 1.8 : isTrunk ? 1.4 : 1.1}
          style={{
            cursor: hasChildrenInData ? "pointer" : "default",
            filter: hover ? "drop-shadow(0 1px 3px rgba(0,0,0,0.08))" : "none",
            transition: "filter 160ms ease",
          }}
          onClick={() => hasChildrenInData && onToggle(node.data.id)}
        />

        {/* Tiny indicator that the node holds collapsed children */}
        {hasChildrenInData && !expanded && (
          <circle
            cx={boxW / 2 - padX * 0.55}
            cy={0}
            r={2.2}
            fill="#1f1f1f"
            pointerEvents="none"
          />
        )}

        {/* Label OR inline editor — both occupy the same visual footprint as
            the rect so the box never grows. */}
        {editing ? (
          <foreignObject
            x={-boxW / 2}
            y={-boxH / 2}
            width={boxW}
            height={boxH}
            style={{ overflow: "visible" }}
          >
            <input
              className="node-edit-input"
              size={1}
              style={{
                boxSizing: "border-box",
                width: `${boxW}px`,
                height: `${boxH}px`,
                minWidth: 0,
                fontSize: `${fontSize}px`,
                fontWeight: labelFontWeight,
                lineHeight: `${boxH}px`,
                textAlign: "center",
                border: "none",
                background: "transparent",
                padding: 0,
                outline: "none",
                letterSpacing: "-0.01em",
                color: "#1f1f1f",
                display: "block",
              }}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={submitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitEdit();
                if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(node.data.title);
                }
              }}
            />
          </foreignObject>
        ) : (
          <text
            x={0}
            y={fontSize * 0.36}
            fill="#1f1f1f"
            fontSize={fontSize}
            fontWeight={labelFontWeight}
            textAnchor="middle"
            style={{
              userSelect: "none",
              letterSpacing: "-0.01em",
              pointerEvents: "none",
            }}
          >
            {node.data.title}
          </text>
        )}

        {/* Invisible hover bridge — fills the gap between the box and the
            action buttons so moving the cursor from one to the other doesn't
            trigger mouseleave on the group. */}
        {isAdmin && hover && !editing && (
          <rect
            x={boxW / 2}
            y={-Math.max(boxH / 2, 16)}
            width={140}
            height={Math.max(boxH, 32)}
            fill="white"
            fillOpacity={0}
            pointerEvents="all"
          />
        )}

        {/* Admin hover buttons */}
        {isAdmin && hover && !editing && (
          <foreignObject
            x={boxW / 2 + 6}
            y={-14}
            width={120}
            height={28}
            style={{ overflow: "visible" }}
          >
            <div className="node-actions">
              <button
                title="자식 추가"
                onClick={handleAdd}
                aria-label="자식 추가"
              >
                ＋
              </button>
              <button
                title="이름 수정"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(true);
                  setDraft(node.data.title);
                }}
                aria-label="이름 수정"
              >
                ✎
              </button>
              {!isRoot && (
                <button
                  className="danger"
                  title="삭제"
                  onClick={handleDelete}
                  aria-label="삭제"
                >
                  ×
                </button>
              )}
            </div>
          </foreignObject>
        )}
      </motion.g>

      {/* 노드 추가 모달 — SVG 바깥 body에 portal로 렌더 */}
      {addOpen && createPortal(
        <div className="modal-backdrop" onClick={() => setAddOpen(false)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); submitAdd(); }}
          >
            <h2>새 노드 추가</h2>
            <p className="modal-sub">"{node.data.title}" 하위</p>
            <input
              type="text"
              autoFocus
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              placeholder="노드 이름 입력"
              maxLength={200}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setAddOpen(false); setAddTitle(""); }
              }}
            />
            <div className="row">
              <button
                type="button"
                onClick={() => { setAddOpen(false); setAddTitle(""); }}
              >
                취소
              </button>
              <button
                type="submit"
                className="primary"
                disabled={!addTitle.trim() || create.isPending}
              >
                {create.isPending ? "추가 중…" : "추가"}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </>
  );
}
