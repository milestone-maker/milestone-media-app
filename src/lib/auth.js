// Auth context + hook, extracted from App.jsx to break a circular
// import. Views need useAuth; App.jsx hosts the Provider value.
// Both now import from this leaf module instead of from each other.

import { createContext, useContext } from "react";

export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}
