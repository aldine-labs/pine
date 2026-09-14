// Runs inside the same kernel boundary as bash, with networking denied.
import { access, mkdir, open, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

let input = "";
if (process.env.PINE_FILE_REQUEST) {
  input = await readFile(process.env.PINE_FILE_REQUEST, "utf8");
} else {
  for await (const chunk of process.stdin) input += chunk;
}
const request = JSON.parse(input);
try {
  let data;
  if (request.operation === "access") {
    await access(request.path, request.mode);
  } else if (request.operation === "mkdir") {
    await mkdir(request.path, { recursive: true });
  } else if (["read", "header", "write"].includes(request.operation)) {
    if (request.operation === "write" && request.createParent) {
      await mkdir(path.dirname(request.path), { recursive: true });
    }
    if (request.operation === "read" && request.mode !== undefined) {
      await access(request.path, request.mode);
    }
    // Refuse final symlink substitution and multi-linked files. The OS
    // sandbox still guards parent-directory races at the actual syscall.
    const flags =
      constants.O_NOFOLLOW |
      (request.operation === "write"
        ? constants.O_WRONLY | constants.O_CREAT
        : constants.O_RDONLY);
    const file = await open(request.path, flags, 0o600);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1) {
        throw new Error(
          "Only regular files with a single link are supported by sandboxed file tools.",
        );
      }
      if (request.operation === "write") {
        await file.truncate(0);
        await file.writeFile(request.content, "utf8");
      } else if (request.operation === "header") {
        const buffer = Buffer.alloc(12);
        const { bytesRead } = await file.read(buffer, 0, 12, 0);
        data = buffer.subarray(0, bytesRead).toString("base64");
      } else {
        if (stat.size > 64 * 1024 * 1024)
          throw new Error("File exceeds the 64 MiB read limit.");
        const chunks = [];
        let length = 0;
        for await (const chunk of file.createReadStream({
          end: 64 * 1024 * 1024,
          autoClose: false,
        })) {
          length += chunk.length;
          if (length > 64 * 1024 * 1024)
            throw new Error("File exceeds the 64 MiB read limit.");
          chunks.push(chunk);
        }
        data = Buffer.concat(chunks).toString("base64");
      }
    } finally {
      await file.close();
    }
  } else {
    throw new Error("Unknown file operation.");
  }
  process.stdout.write(JSON.stringify({ ok: true, data }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      message: String(error?.message ?? error),
      code: error?.code,
    }),
  );
}
