export type Category = "project" | "hobby" | "study" | "travel";

export interface TreeNode {
  id: number;
  parent_id: number | null;
  title: string;
  category: Category | null;
  sort_order: number;
  children: TreeNode[];
}
