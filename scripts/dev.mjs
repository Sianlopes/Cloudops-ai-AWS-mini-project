import { spawn } from "node:child_process";
const env = {
  ...process.env,
  EMBEDDED_WORKER: "true",
  ALLOW_LOCAL_TEST_TARGET: "true",
};
const children = [
  spawn(
    process.execPath,
    ["--env-file-if-exists=.env", "--watch", "server/index.js"],
    { stdio: "inherit", env },
  ),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--configLoader",
      "native",
    ],
    { stdio: "inherit", env },
  ),
];
for (const child of children)
  child.on("exit", (code) => {
    for (const other of children) if (other !== child) other.kill();
    process.exit(code || 0);
  });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const child of children) child.kill();
    process.exit(0);
  });
