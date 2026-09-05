import { createIO } from "./io";
import { run } from "./run";

const io = createIO(process.argv.includes("--no-color") ? { color: false } : {});

run(process.argv.slice(2), io)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
