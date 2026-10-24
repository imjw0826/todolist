import { create } from "zustand";

interface AdminState {
  isAdmin: boolean;
  password: string;
  setAdmin: (password: string) => void;
  logout: () => void;
}

const STORAGE_KEY = "mindmap.admin.password";

export const useAdmin = create<AdminState>((set) => ({
  isAdmin: !!sessionStorage.getItem(STORAGE_KEY),
  password: sessionStorage.getItem(STORAGE_KEY) ?? "",
  setAdmin: (password) => {
    sessionStorage.setItem(STORAGE_KEY, password);
    set({ isAdmin: true, password });
  },
  logout: () => {
    sessionStorage.removeItem(STORAGE_KEY);
    set({ isAdmin: false, password: "" });
  },
}));

// Lets code outside the map (the Jev input bar) ask it to open the branch a
// node was added to and pan to the new node.
interface RevealState {
  request: { nodeId: number; parentId: number } | null;
  reveal: (nodeId: number, parentId: number) => void;
  clear: () => void;
}

export const useNodeReveal = create<RevealState>((set) => ({
  request: null,
  reveal: (nodeId, parentId) => set({ request: { nodeId, parentId } }),
  clear: () => set({ request: null }),
}));

// TypeSafe API key for Jev. Kept in this device's localStorage only so it
// never ends up in the public bundle.
const JEV_KEY_STORAGE = "mindmap.jev.apiKey";

function readJevKey(): string {
  try {
    return localStorage.getItem(JEV_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

interface JevKeyState {
  apiKey: string;
  setApiKey: (key: string) => void;
}

export const useJevKey = create<JevKeyState>((set) => ({
  apiKey: readJevKey(),
  setApiKey: (apiKey) => {
    try {
      if (apiKey) localStorage.setItem(JEV_KEY_STORAGE, apiKey);
      else localStorage.removeItem(JEV_KEY_STORAGE);
    } catch {
      // Storage blocked: keep the key for this session only.
    }
    set({ apiKey });
  },
}));
