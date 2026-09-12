const variableName = "VITE_API_BASE_URL";
const rawValue = process.env[variableName]?.trim();

let url;
try {
  url = rawValue ? new URL(rawValue) : undefined;
} catch {
  url = undefined;
}

if (
  url?.protocol !== "https:" ||
  url.username !== "" ||
  url.password !== "" ||
  url.pathname !== "/" ||
  url.search !== "" ||
  url.hash !== ""
) {
  console.error(
    `${variableName} must be set to the Worker's exact HTTPS origin before a Pages deployment.`,
  );
  process.exitCode = 1;
}
