# AutoBE para OpenCode (plugin local, V2)

Plugin local que integra [AutoBE](https://autobe.dev) en OpenCode y expone la
herramienta `autobe.generate` (nombre efectivo `autobe_generate`).

Genera un backend completo NestJS + Prisma:

1. Análisis de requisitos
2. Esquema Prisma
3. Especificación OpenAPI
4. Tests E2E
5. Implementación NestJS

## Carga

OpenCode descubre automáticamente los plugins de `.opencode/plugins/`, así que
no hace falta añadir nada a `opencode.json`.

Las dependencias (`@autobe/agent`, `@autobe/compiler`, `openai`,
`@opencode/plugin`) están instaladas en `.opencode/node_modules`.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `AUTOBE_API_KEY` | Clave del proveedor (tiene prioridad) |
| `ANTHROPIC_API_KEY` | Alternativa; activa el endpoint compatible de Anthropic |
| `OPENAI_API_KEY` | Alternativa para OpenAI |
| `AUTOBE_BASE_URL` | Endpoint compatible con OpenAI (DeepSeek, OpenRouter, Zen…) |
| `AUTOBE_MODEL` | Modelo por defecto (`gpt-4.1` o `claude-sonnet-4-20250514`) |
| `AUTOBE_CONCURRENCY` | Peticiones concurrentes (por defecto 16) |
| `AUTOBE_TIMEOUT_MS` | Timeout por petición al proveedor |
| `AUTOBE_LOCALE` | Idioma de AutoBE (por defecto `en-US`) |
| `AUTOBE_TIMEZONE` | Zona horaria IANA |

En PowerShell, para la sesión actual:

```powershell
$env:OPENAI_API_KEY = "sk-..."
```

Para que persista (reinicia OpenCode después):

```powershell
setx OPENAI_API_KEY "sk-..."
```

## Uso

Pide al agente algo como:

> Genera un backend para una cerradura eléctrica con usuarios, dispositivos,
> permisos de acceso y registro de aperturas.

O llama a la herramienta directamente con los argumentos:

- `description` (obligatorio)
- `model`
- `dbms`: `postgres` (por defecto) o `sqlite`
- `write_files`: por defecto `true`
- `directory`: subdirectorio de salida dentro del proyecto
- `locale`, `timezone`

Los archivos se escriben en la raíz del proyecto por defecto. Usa `directory`
si no quieres mezclarlos con el proyecto actual.

## Notas

- La generación puede tardar varios minutos y consumir muchos tokens.
- `@autobe/agent` y `@autobe/compiler` usan licencia AGPL-3.0.
- No instales `@hacr/opencode-autobe`: su versión publicada es V1, está
  incompleta y no funciona en OpenCode V2. Este plugin es el port.
