export const API_BASE_URL =
  (typeof window !== "undefined" && window.location.hostname === "localhost")
    ? "http://127.0.0.1:8787"
    : "https://api.opsuimeets.com";
