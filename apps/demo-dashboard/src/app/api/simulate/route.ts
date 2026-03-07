import { spawn } from "child_process";
import { NextRequest } from "next/server";
import path from "path";

const CRE_BIN = process.env.CRE_BIN || path.join(process.env.HOME || "~", ".cre/bin/cre");
const CRE_DIR = process.env.CRE_DIR || path.resolve(process.cwd(), "../../ProofPACRE");

export async function GET(req: NextRequest) {
  const workflow = req.nextUrl.searchParams.get("workflow");
  const broadcast = req.nextUrl.searchParams.get("broadcast") === "true";

  if (!workflow || !/^wf-\d{3}-[\w-]+$/.test(workflow)) {
    return new Response(JSON.stringify({ error: "Invalid workflow name" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const target = process.env.CRE_TARGET || "staging-settings";
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const args = [
        "workflow",
        "simulate",
        `./${workflow}`,
        `--target=${target}`,
      ];
      if (broadcast) args.push("--broadcast");

      const cre = spawn(CRE_BIN, args, {
        cwd: CRE_DIR,
        env: { ...process.env },
      });

      const send = (type: string, data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`)
          );
        } catch {
          // stream may be closed
        }
      };

      cre.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        // Split by newlines to send each line separately
        for (const line of text.split("\n").filter(Boolean)) {
          send("log", { text: line });
        }
      });

      cre.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        for (const line of text.split("\n").filter(Boolean)) {
          send("error", { text: line });
        }
      });

      cre.on("error", (err) => {
        send("error", { text: `Failed to start CRE: ${err.message}` });
        send("done", { code: -1 });
        controller.close();
      });

      cre.on("close", (code) => {
        send("done", { code: code ?? 0 });
        controller.close();
      });

      // Clean up on abort
      req.signal.addEventListener("abort", () => {
        cre.kill("SIGTERM");
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
