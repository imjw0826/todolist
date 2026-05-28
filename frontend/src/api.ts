import { ref, get, set } from "firebase/database";
import { db } from "./lib/firebase";
import type { Category, TreeNode } from "./types";

// Firebase는 빈 배열을 저장하지 않아 children이 null로 반환될 수 있음.
// 재귀적으로 순회해 children을 항상 배열로 보장한다.
function normalize(node: any): TreeNode {
  return {
    id: node.id,
    parent_id: node.parent_id ?? null,
    title: node.title,
    category: node.category ?? null,
    sort_order: node.sort_order ?? 0,
    children: Array.isArray(node.children)
      ? node.children.map(normalize)
      : [],
  };
}

// ---------- helpers ----------

function findNode(root: TreeNode, id: number): TreeNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

function findParent(root: TreeNode, id: number): TreeNode | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const hit = findParent(child, id);
    if (hit) return hit;
  }
  return null;
}

async function readAll(): Promise<{ next_id: number; tree: TreeNode }> {
  const snapshot = await get(ref(db, "/"));
  const raw = snapshot.val();
  return { next_id: raw.next_id, tree: normalize(raw.tree) };
}

async function writeAll(data: { next_id: number; tree: TreeNode }): Promise<void> {
  await set(ref(db, "/"), data);
}

// ---------- public API ----------

export async function fetchTree(): Promise<TreeNode> {
  const snapshot = await get(ref(db, "tree"));
  return normalize(snapshot.val());
}

/** 비밀번호는 환경 변수와 단순 비교 (보안 목적이 아닌 실수 방지용) */
export async function verifyAdmin(password: string): Promise<boolean> {
  return password === import.meta.env.VITE_ADMIN_PASSWORD;
}

export async function createNode(input: {
  parent_id: number;
  title: string;
  category?: Category | null;
}): Promise<TreeNode> {
  const data = await readAll();
  const parent = findNode(data.tree, input.parent_id);
  if (!parent) throw new Error("부모 노드를 찾을 수 없습니다.");

  const newNode: TreeNode = {
    id: data.next_id,
    parent_id: input.parent_id,
    title: input.title.trim(),
    category: input.category ?? null,
    sort_order: parent.children.length,
    children: [],
  };

  parent.children.push(newNode);
  data.next_id += 1;
  await writeAll(data);
  return newNode;
}

export async function updateNode(
  id: number,
  input: { title?: string; category?: Category | null }
): Promise<TreeNode> {
  const data = await readAll();
  const node = findNode(data.tree, id);
  if (!node) throw new Error("노드를 찾을 수 없습니다.");

  if (input.title !== undefined) node.title = input.title.trim();
  if (input.category !== undefined) node.category = input.category;
  await writeAll(data);
  return node;
}

export async function deleteNode(id: number): Promise<void> {
  const data = await readAll();
  if (data.tree.id === id) throw new Error("루트 노드는 삭제할 수 없습니다.");

  const parent = findParent(data.tree, id);
  if (!parent) throw new Error("노드를 찾을 수 없습니다.");

  parent.children = parent.children.filter((c) => c.id !== id);
  await writeAll(data);
}
