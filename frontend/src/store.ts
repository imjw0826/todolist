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
