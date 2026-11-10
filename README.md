# Aletheia

Aletheia is an interactive workbench for **Logic Design and Microprocessor (LDAM)** coursework. It supports Boolean analysis, minimization, circuit synthesis, sequential design, timing, IC/cost/power estimates, fault testing, and an optional AI study assistant.

## Run locally

Requirements: Node.js and pnpm.

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite. The core tools run without an API key.

### Optional AI assistant

The assistant uses the Gemini API from the local Express server. Keep the API key on the server; never add it to client code or a `VITE_` variable.

1. Copy `server/.env.example` to `server/.env` (`cp server/.env.example server/.env` on macOS/Linux, or `Copy-Item server\.env.example server\.env` in PowerShell).
2. Set `LLM_API_KEY` in `server/.env`.
3. In one terminal, run `pnpm server:dev`; in another, run `pnpm dev`.

The model defaults to `gemini-2.5-flash`. Optional settings include `LLM_PROVIDER`, `LLM_MODEL`, `CLIENT_ORIGIN`, and `CHAT_RATE_LIMIT`.

## Main features

- Boolean expressions, minterms/maxterms, editable truth tables, canonical forms, K-maps, and Quine–McCluskey minimization.
- Gate-level circuits, standard logic blocks, equivalence checks, NAND/NOR variants, sequential circuits, FSM analysis, and timing/hazard simulation.
- IC mapping, estimated cost and power, stuck-at fault coverage, and test-vector analysis.
- Dashboard with ten examples, project JSON save/load, printable report, deterministic self-test, and a course concept guide.
- Worker-backed large minimization and fault-analysis tasks.

For the architecture, course-topic map, project workflow, and sharing notes, see the [Project Guide](docs/PROJECT_GUIDE.md).

## Development checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Sharing the source

When making a source ZIP, exclude `.git`, `node_modules`, `dist`, and `server/.env`. Keep `server/.env.example`. The app uses repository-relative paths and local service URLs; it does not require this computer’s directory layout.
