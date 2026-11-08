import { AutoBeAgent, type IAutoBeVendor } from "@autobe/agent"
import { AutoBeCompiler } from "@autobe/compiler"
import { Plugin } from "@opencode/plugin"
import OpenAI from "openai"
import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve } from "node:path"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface GenerateInput {
  description: string
  model?: string
  dbms?: "postgres" | "sqlite"
  write_files?: boolean
  directory?: string
  locale?: string
  timezone?: string
}

function env(name: string): string | undefined {
  const value = process.env[name] ?? registryEnv(name)
  return value && value.trim().length > 0 ? value.trim() : undefined
}

// The OpenCode background service can outlive a `setx`, so its process
// environment may be stale. On Windows, fall back to the persisted user
// environment (HKCU\Environment) so a configured key is picked up without
// restarting the service.
const registryCache = new Map<string, string | undefined>()

function registryEnv(name: string): string | undefined {
  if (process.platform !== "win32") return undefined
  if (registryCache.has(name)) return registryCache.get(name)

  let value: string | undefined
  try {
    const output = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
    })
    value = output.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, "mi"))?.[1]?.trim()
  } catch {
    value = undefined
  }

  registryCache.set(name, value)
  return value
}

function createVendor(modelOverride?: string): IAutoBeVendor {
  const apiKey = env("AUTOBE_API_KEY") ?? env("ANTHROPIC_API_KEY") ?? env("OPENAI_API_KEY")
  if (!apiKey) {
    throw new Error(
      "No API key found. Set AUTOBE_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY before starting OpenCode.",
    )
  }

  const configuredBaseURL = env("AUTOBE_BASE_URL")
  const anthropic = configuredBaseURL === undefined && apiKey.startsWith("sk-ant-")
  const baseURL = configuredBaseURL ?? (anthropic ? "https://api.anthropic.com/v1/" : undefined)

  const timeout = Number(env("AUTOBE_TIMEOUT_MS") ?? "")
  const semaphore = Number(env("AUTOBE_CONCURRENCY") ?? "16")

  return {
    // The OpenAI SDK ships both ESM and CJS type declarations; AutoBE's own
    // declarations resolve the CJS flavour, so keep a single structural cast.
    api: new OpenAI({ apiKey, baseURL }) as unknown as IAutoBeVendor["api"],
    model: modelOverride ?? env("AUTOBE_MODEL") ?? (anthropic ? "claude-sonnet-4-20250514" : "gpt-4.1"),
    semaphore: Number.isFinite(semaphore) && semaphore > 0 ? semaphore : 16,
    options: Number.isFinite(timeout) && timeout > 0 ? { timeout } : undefined,
  }
}

// ---------------------------------------------------------------------------
// File output
// ---------------------------------------------------------------------------

async function writeGeneratedFiles(root: string, files: Record<string, string>): Promise<string[]> {
  const written: string[] = []

  for (const [path, content] of Object.entries(files)) {
    const full = resolve(root, path)
    const rel = relative(root, full)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Refusing to write a generated file outside the output directory: ${path}`)
    }

    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, content, "utf-8")
    written.push(rel)
  }

  return written
}

// ---------------------------------------------------------------------------
// Progress labels for the AutoBE pipeline
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<string, string> = {
  analyzeStart: "AutoBE: analizando requisitos…",
  analyzeComplete: "AutoBE: requisitos analizados ✓",
  databaseStart: "AutoBE: diseñando esquema Prisma…",
  databaseComplete: "AutoBE: base de datos lista ✓",
  interfaceStart: "AutoBE: diseñando la API OpenAPI…",
  interfaceComplete: "AutoBE: API diseñada ✓",
  testStart: "AutoBE: escribiendo tests E2E…",
  testComplete: "AutoBE: tests E2E escritos ✓",
  realizeStart: "AutoBE: generando implementación NestJS…",
  realizeComplete: "AutoBE: implementación generada ✓",
  realizeTestStart: "AutoBE: ejecutando los tests E2E…",
  realizeTestComplete: "AutoBE: tests E2E superados ✓",
  vendorTimeout: "AutoBE: timeout del proveedor, reintentando…",
  jsonParseError: "AutoBE: corrigiendo respuesta JSON del modelo…",
  jsonValidateError: "AutoBE: corrigiendo validación del modelo…",
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default Plugin.define({
  id: "autobe",

  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "autobe",
        description: "AI-powered NestJS + Prisma backend generation with AutoBE",
      })

      editor.add({
        name: "generate",
        description: `Generate a complete, compilable NestJS + Prisma backend with AutoBE.

Runs the full AutoBE pipeline in-process:
  1. Requirements analysis  → structured specification
  2. Database design        → Prisma schema (ERD)
  3. API design             → OpenAPI specification
  4. Test generation        → E2E test suites
  5. Code generation        → NestJS implementation

The generated files are written to the current project directory by default.
This operation can take several minutes and consumes a significant number of
model tokens; progress is reported while it runs.

Required configuration (environment variables):
  • AUTOBE_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY
  • AUTOBE_MODEL (optional), AUTOBE_BASE_URL (optional)`,
        input: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description:
                "Natural-language description of the backend to generate. Include the domain, main entities, key operations and any constraints.",
            },
            model: {
              type: "string",
              description:
                "Model identifier, e.g. 'gpt-4.1' or 'claude-sonnet-4-20250514'. Defaults to AUTOBE_MODEL or the provider default.",
            },
            dbms: {
              type: "string",
              enum: ["postgres", "sqlite"],
              description: "Target database for the generated code. Default: postgres.",
            },
            write_files: {
              type: "boolean",
              description: "Write the generated files to disk. Default: true.",
            },
            directory: {
              type: "string",
              description:
                "Output directory, relative to the current project (or an absolute path inside it). Default: the project directory.",
            },
            locale: {
              type: "string",
              description: "Locale used by AutoBE, e.g. 'es-ES'. Default: AUTOBE_LOCALE or 'en-US'.",
            },
            timezone: {
              type: "string",
              description: "IANA timezone used by AutoBE. Default: AUTOBE_TIMEZONE or the system timezone.",
            },
          },
          required: ["description"],
          additionalProperties: false,
        },
        options: { namespace: "autobe" },

        async execute(raw, context) {
          const input = raw as GenerateInput

          // Resolve and validate the output directory.
          const projectDirectory = ctx.location.directory
          const outputDirectory = resolve(projectDirectory, input.directory ?? ".")
          const outputRelative = relative(projectDirectory, outputDirectory)
          if (outputRelative.startsWith("..") || isAbsolute(outputRelative)) {
            return {
              content: `❌ Refusing to write outside the project directory: ${outputDirectory}`,
            }
          }

          if (context.signal.aborted) {
            return { content: "AutoBE generation cancelled before it started." }
          }

          // Progress updates are queued so they stay ordered without blocking
          // the generation pipeline.
          let lastTitle = ""
          let progressQueue: Promise<void> = Promise.resolve()
          const report = (title: string) => {
            if (title === lastTitle) return
            lastTitle = title
            progressQueue = progressQueue
              .then(() => context.progress({ title, status: title }))
              .catch(() => undefined)
          }

          let vendor: IAutoBeVendor
          try {
            vendor = createVendor(input.model)
            vendor.options = { ...vendor.options, signal: context.signal }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return {
              content: [
                `❌ AutoBE vendor setup failed: ${message}`,
                "",
                "Checklist:",
                "  1. Set AUTOBE_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY",
                "  2. Optionally set AUTOBE_BASE_URL for an OpenAI-compatible endpoint",
                "  3. Restart OpenCode after changing environment variables",
              ].join("\n"),
            }
          }

          report("AutoBE: inicializando el agente…")

          const agent = new AutoBeAgent({
            vendor,
            compiler: (listener) => new AutoBeCompiler(listener),
            config: {
              locale: input.locale ?? env("AUTOBE_LOCALE") ?? "en-US",
              timezone: input.timezone ?? env("AUTOBE_TIMEZONE") ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
          })

          for (const [event, label] of Object.entries(PHASE_LABELS)) {
            agent.on(event as never, () => report(label))
          }

          try {
            report("AutoBE: generando el backend…")
            await agent.conversate(input.description)
          } catch (error) {
            await progressQueue
            if (context.signal.aborted) {
              return { content: "AutoBE generation cancelled." }
            }
            const message = error instanceof Error ? error.message : String(error)
            return {
              content: [`❌ AutoBE generation failed: ${message}`, "", `Model: ${vendor.model}`].join("\n"),
              metadata: { model: vendor.model },
            }
          }

          report("AutoBE: recopilando los archivos generados…")

          if (context.signal.aborted) {
            await progressQueue
            return { content: "AutoBE generation cancelled." }
          }

          let files: Record<string, string>
          try {
            files = await agent.getFiles({ dbms: input.dbms ?? "postgres" })
          } catch (error) {
            await progressQueue
            const message = error instanceof Error ? error.message : String(error)
            return {
              content: [
                `❌ Failed to retrieve the generated files: ${message}`,
                "",
                "Generation finished, but file retrieval failed.",
              ].join("\n"),
            }
          }

          const fileList = Object.keys(files)
          const shouldWrite = input.write_files !== false

          if (shouldWrite && fileList.length > 0) {
            report("AutoBE: escribiendo los archivos en el proyecto…")
            try {
              await writeGeneratedFiles(outputDirectory, files)
            } catch (error) {
              await progressQueue
              const message = error instanceof Error ? error.message : String(error)
              return { content: `❌ Failed to write the generated files: ${message}` }
            }
          }

          report("AutoBE: completado ✓")
          await progressQueue

          const shown = fileList.slice(0, 40)
          const usage = agent.getTokenUsage()
          const total = usage.aggregate.total

          return {
            content: [
              "✅ AutoBE generation complete",
              "",
              `Model:  ${vendor.model}`,
              `Files:  ${fileList.length}`,
              shouldWrite ? `Output: ${outputDirectory}` : "Output: not written to disk (write_files=false)",
              "",
              "Generated files:",
              ...shown.map((file) => `  ${file}`),
              ...(fileList.length > shown.length ? [`  … and ${fileList.length - shown.length} more`] : []),
              ...(total > 0 ? ["", `Tokens: ${total.toLocaleString("en-US")} total`] : []),
            ].join("\n"),
            metadata: {
              model: vendor.model,
              directory: shouldWrite ? outputDirectory : undefined,
              files: fileList,
            },
          }
        },
      })
    })
  },
})
