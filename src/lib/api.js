let csrfToken = "";
export const setCsrf = (token) => {
  csrfToken = token || "";
};
export async function api(path, options) {
  const res = await fetch(
    `/api/${path}`,
    options
      ? {
          method: options.method || "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify(options.body),
        }
      : undefined,
  );
  const body = await res.json();
  if (!res.ok) {
    const error = Error(body.error || "Request failed");
    error.status = res.status;
    throw error;
  }
  return body;
}
