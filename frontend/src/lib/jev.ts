import type { TreeNode } from "../types";

// Jev (TypeSafe AI's "System One" model) returns typed decisions instead of
// text. We ask it a single `choice` question: which existing node should this
// new item go under. It only picks a parent; it never edits the tree itself.
//
// The TypeSafe API doesn't accept browser (CORS) calls, so requests go through
// a small relay on Vercel (see /proxy) that forwards them unchanged.
const ENDPOINT = "https://todolist-jev-proxy.vercel.app/api/jev";
const MODEL = "jev-latest";
// A choice question accepts at most this many options.
const MAX_OPTIONS = 255;

export interface ParentOption {
  id: number;
  /** "취미 › 음악" — titles from below the root down to this node. */
  path: string;
}

/** Every node, root first, as a candidate parent. */
export function listParents(root: TreeNode): ParentOption[] {
  const out: ParentOption[] = [{ id: root.id, path: root.title }];
  const walk = (node: TreeNode, trail: string[]) => {
    for (const child of node.children) {
      const path = [...trail, child.title];
      out.push({ id: child.id, path: path.join(" › ") });
      walk(child, path);
    }
  };
  walk(root, []);
  return out;
}

function findNode(root: TreeNode, id: number): TreeNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

// What Jev sees for each option: the path, plus the existing children as
// examples of what already lives there.
function describe(option: ParentOption, root: TreeNode): string {
  const node = findNode(root, option.id);
  const parts =
    option.id === root.id
      ? ["최상위: 기존 어느 분류에도 맞지 않는 새 대분류"]
      : [option.path];
  if (node && node.children.length) {
    const kids = node.children.slice(0, 12).map((c) => c.title);
    parts.push(`이미 있는 하위 항목: ${kids.join(", ")}`);
  }
  return parts.join(" · ");
}

export class JevError extends Error {}

export interface Placement {
  parentId: number;
  confidence: number;
}

export async function chooseParent(
  text: string,
  root: TreeNode,
  apiKey: string
): Promise<Placement> {
  const options = listParents(root).slice(0, MAX_OPTIONS);
  if (options.length === 1) return { parentId: root.id, confidence: 1 };

  const criteria: Record<string, string> = {};
  for (const o of options) criteria[`n${o.id}`] = describe(o, root);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        state: `마인드맵에 새로 추가할 항목: ${text}`,
        questions: {
          parent: {
            type: "choice",
            instructions:
              "이 항목은 마인드맵의 어느 노드 바로 밑에 하위 노드로 들어가야 하나? 주제가 가장 구체적으로 맞는 노드를 고른다.",
            criteria,
          },
        },
      }),
    });
  } catch {
    throw new JevError("Jev에 연결하지 못했어요.");
  }

  if (res.status === 401 || res.status === 403) {
    throw new JevError("Jev API 키가 올바르지 않아요. ⚙에서 확인해 주세요.");
  }
  if (!res.ok) throw new JevError(`Jev 응답 오류 (${res.status})`);

  const answer = (await res.json())?.answers?.parent;
  const key: unknown = answer?.choice;
  const id = typeof key === "string" ? Number(key.slice(1)) : NaN;
  if (!options.some((o) => o.id === id)) {
    throw new JevError("Jev가 알 수 없는 위치를 골랐어요.");
  }
  return { parentId: id, confidence: Number(answer?.confidence ?? 0) };
}
