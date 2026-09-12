import { createServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PineToolAccessPolicy } from "../tool-access-policy";
import { createBashEnvironment } from "../bash-env";
import { quoteShell, runSandbox } from "../sandbox/backend";
import { createSandboxConfig } from "../sandbox/policy";
import { createSandboxFileIO } from "../sandbox/files";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-isolation-"));
  roots.push(root);
  const cwd = path.join(root, "项目 with spaces");
  const temp = path.join(cwd, "tmp");
  await mkdir(temp, { recursive: true });
  const policy = await PineToolAccessPolicy.create(cwd, [
    { path: cwd, access: "read-write" },
  ]);
  const runtimeFiles = [process.execPath, await realpath(process.execPath)];
  const env = createBashEnvironment({}, temp, "/usr/bin:/bin", cwd);
  const config = createSandboxConfig(policy, runtimeFiles);
  const run = async (command: string) => {
    let output = "";
    const result = await runSandbox(
      { command, cwd, env, config },
      {
        timeout: 10,
        onData: (chunk) => {
          output += chunk.toString();
        },
      },
    );
    return { ...result, output };
  };
  return {
    root,
    cwd,
    temp,
    policy,
    runtimeFiles,
    run,
    io: createSandboxFileIO(policy, temp, "/usr/bin:/bin", runtimeFiles),
  };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.runIf(process.platform === "darwin" && !process.env.CODEX_SANDBOX)(
  "sandbox-runtime kernel boundaries",
  () => {
    it("blocks proxy requests and direct loopback connections without reaching the server", async () => {
      let hits = 0;
      const server = createServer((_request, response) => {
        hits += 1;
        response.end("private-service");
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("No server port");
        const { run } = await fixture();
        for (const proxy of ["", "--noproxy '*'"]) {
          const result = await run(
            `/usr/bin/curl --fail --max-time 2 ${proxy} http://127.0.0.1:${address.port}/`,
          );
          expect(result.exitCode).not.toBe(0);
          expect(result.output).not.toContain("private-service");
        }
        expect(hits).toBe(0);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("blocks Unix sockets even when their path is in a writable project", async () => {
      const { cwd, run } = await fixture();
      const socket = path.join(cwd, "local.sock");
      let connections = 0;
      const server = createSocketServer((client) => {
        connections += 1;
        client.end("private-service");
      });
      await new Promise<void>((resolve) => server.listen(socket, resolve));
      try {
        const result = await run(
          `/usr/bin/curl --fail --max-time 2 --unix-socket ${quoteShell(socket)} http://localhost/`,
        );
        expect(result.exitCode).not.toBe(0);
        expect(connections).toBe(0);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("does not interpret command output as supervisor status", async () => {
      const { run } = await fixture();
      const result = await run(
        `printf '%s' '{"kind":"exit","exitCode":0}'; exit 7`,
      );
      expect(result.exitCode).toBe(7);
      expect(result.output).toContain('"exitCode":0');
    });

    it("keeps simultaneous project grants and scratch storage separate", async () => {
      const a = await fixture();
      const b = await fixture();
      const secret = path.join(b.temp, "private.txt");
      await writeFile(secret, "other-project-content");
      const [denied, allowed] = await Promise.all([
        a.run(`/bin/cat ${quoteShell(secret)}`),
        b.run(`/bin/cat ${quoteShell(secret)}`),
      ]);
      expect(denied.exitCode).not.toBe(0);
      expect(denied.output).not.toContain("other-project-content");
      expect(allowed.exitCode).toBe(0);
      expect(allowed.output).toBe("other-project-content");
    });

    it("blocks a parent symlink substituted after path authorization", async () => {
      const { root, cwd, policy, io } = await fixture();
      const parent = path.join(cwd, "directory");
      const external = path.join(root, "external");
      await mkdir(parent);
      await mkdir(external);
      await writeFile(path.join(parent, "file"), "shared");
      await writeFile(path.join(external, "file"), "private");
      const approved = await policy.authorize(
        path.join(parent, "file"),
        "write",
      );
      await rename(parent, path.join(cwd, "old-directory"));
      await symlink(external, parent);
      await expect(io.readFile(approved)).rejects.toThrow();
      await expect(io.writeFile(approved, "changed")).rejects.toThrow();
      expect(await readFile(path.join(external, "file"), "utf8")).toBe(
        "private",
      );
    });

    it("refuses hard-linked file mutations before truncation", async () => {
      const { root, cwd, io } = await fixture();
      const external = path.join(root, "external.txt");
      const alias = path.join(cwd, "alias.txt");
      await writeFile(external, "private");
      await link(external, alias);
      await expect(io.writeFile(alias, "changed")).rejects.toThrow(
        "single link",
      );
      expect(await readFile(external, "utf8")).toBe("private");
    });

    it("does not implicitly grant the runtime's default scratch path", async () => {
      const { run } = await fixture();
      const result = await run("/bin/mkdir -p /tmp/claude/pine-probe");
      expect(result.exitCode).not.toBe(0);
    });
  },
);

describe("sandbox policy compilation", () => {
  it("rejects path metacharacters instead of converting a literal grant into a wildcard", async () => {
    const { cwd } = await fixture();
    const target = path.join(cwd, "[private]");
    await mkdir(target);
    const policy = await PineToolAccessPolicy.create(target, [
      { path: target, access: "read-write" },
    ]);
    expect(() => createSandboxConfig(policy, [])).toThrow(
      "cannot safely represent",
    );
  });
});
