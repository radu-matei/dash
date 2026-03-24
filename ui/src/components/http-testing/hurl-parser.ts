// Parses hurl --very-verbose output into structured entries.
// Also provides secret redaction for variable values.

export interface ParsedEntry {
  index: number
  request: {
    method: string
    url: string
    headers: [string, string][]
  }
  response: {
    status: number
    statusText: string
    headers: [string, string][]
    body: string
  }
  asserts: {
    description: string
    passed: boolean
  }[]
}

export interface ParsedHurlResult {
  entries: ParsedEntry[]
}

// ─── Secret redaction ───────────────────────────────────────────────────────

/**
 * Replaces all occurrences of variable values in the output with "***".
 * Call this BEFORE parsing or displaying output.
 */
export function redactSecrets(
  output: string,
  variables: { key: string; value: string }[],
): string {
  let redacted = output
  for (const v of variables) {
    if (v.value && v.value.length > 0) {
      // Escape regex special chars in the value
      const escaped = v.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      redacted = redacted.replace(new RegExp(escaped, 'g'), '***')
    }
  }
  return redacted
}

// ─── Parser ─────────────────────────────────────────────────────────────────

// Real hurl --very-verbose output format:
//
// * Executing entry 1
// * Request:
// * GET http://localhost:3000/models/
// * Authorization: Bearer <token>
// * Request can be run with the following curl command:
// * curl ...
// > GET /models/ HTTP/1.1
// > Host: localhost:3000
// > Authorization: Bearer <token>
// >
// * Response: (received N bytes in Xms)
// < HTTP/1.1 200 OK
// < content-type: application/json
// <
// * Response body:
// * { ... json ...
//   ... continuation ...
// }
// *
// * Timings:
// ...

type Section = 'init' | 'request-info' | 'request-headers' | 'response-headers' | 'response-body' | 'asserts' | 'timings'

export function parseHurlOutput(output: string): ParsedHurlResult | null {
  const lines = output.split('\n')
  const entries: ParsedEntry[] = []

  let current: ParsedEntry | null = null
  let section: Section = 'init'
  let bodyLines: string[] = []

  function flushBody() {
    if (current && bodyLines.length > 0) {
      current.response.body = bodyLines.join('\n').trim()
      bodyLines = []
    }
  }

  function pushEntry() {
    if (current) {
      flushBody()
      entries.push(current)
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // New entry: "* Executing entry N"
    if (/^\*\s+Executing entry\s+(\d+)/.test(line)) {
      pushEntry()
      current = {
        index: entries.length + 1,
        request: { method: '', url: '', headers: [] },
        response: { status: 0, statusText: '', headers: [], body: '' },
        asserts: [],
      }
      section = 'init'
      continue
    }

    if (!current) continue

    // Request info section: "* Request:" followed by "* METHOD url" and "* Header: value"
    if (/^\*\s+Request:/.test(line)) {
      section = 'request-info'
      continue
    }

    // In request-info, capture method+url from "* GET http://..."
    if (section === 'request-info') {
      const infoReq = line.match(/^\*\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\s+(.+)/)
      if (infoReq && !current.request.method) {
        current.request.method = infoReq[1]
        current.request.url = infoReq[2]
        continue
      }
      // Skip curl command line and other info lines
      if (line.startsWith('*')) continue
    }

    // Actual HTTP request line: "> GET /path HTTP/1.1"
    const reqLine = line.match(/^>\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\s+(\S+)/)
    if (reqLine) {
      // Update method if not set from info section, or keep the URL path version
      if (!current.request.method) {
        current.request.method = reqLine[1]
      }
      section = 'request-headers'
      continue
    }

    // Request header: "> Header: value"
    if (section === 'request-headers' && line.startsWith('> ')) {
      const headerLine = line.slice(2)
      const colonIdx = headerLine.indexOf(':')
      if (colonIdx > 0) {
        current.request.headers.push([
          headerLine.slice(0, colonIdx).trim(),
          headerLine.slice(colonIdx + 1).trim(),
        ])
      }
      continue
    }

    // Empty request line ">" signals end of request headers
    if (section === 'request-headers' && line === '>') {
      continue
    }

    // Response info: "* Response: (received N bytes in Xms)"
    if (/^\*\s+Response:/.test(line)) {
      section = 'response-headers'
      continue
    }

    // Response status: "< HTTP/1.1 200 OK"
    const respLine = line.match(/^<\s+HTTP\/[\d.]+\s+(\d{3})\s*(.*)/)
    if (respLine) {
      current.response.status = parseInt(respLine[1])
      current.response.statusText = respLine[2] || ''
      section = 'response-headers'
      continue
    }

    // Response header: "< Header: value"
    if (section === 'response-headers' && line.startsWith('< ')) {
      const headerLine = line.slice(2)
      const colonIdx = headerLine.indexOf(':')
      if (colonIdx > 0) {
        current.response.headers.push([
          headerLine.slice(0, colonIdx).trim(),
          headerLine.slice(colonIdx + 1).trim(),
        ])
      }
      continue
    }

    // Empty response line "<" signals end of response headers
    if (section === 'response-headers' && line === '<') {
      continue
    }

    // Response body marker: "* Response body:"
    if (/^\*\s+Response body:/.test(line)) {
      section = 'response-body'
      continue
    }

    // Response body lines: first line prefixed with "* ", subsequent lines not prefixed
    if (section === 'response-body') {
      // End of body: lone "*" or "* Timings:" or "* Assert"
      if (line === '*' || /^\*\s+(Timings|Assert)/.test(line)) {
        flushBody()
        if (/^\*\s+Timings/.test(line)) {
          section = 'timings'
        } else if (/^\*\s+Assert/.test(line)) {
          section = 'asserts'
        } else {
          section = 'init'
        }
        continue
      }
      // First body line may have "* " prefix
      const bodyLine = line.startsWith('* ') ? line.slice(2) : line
      bodyLines.push(bodyLine)
      continue
    }

    // Timings section — skip
    if (section === 'timings') {
      if (line.startsWith('*')) continue
      // Non-* line after timings means we've left the section
      section = 'init'
    }

    // Asserts section
    if (/^\*\s+Assert/.test(line)) {
      flushBody()
      section = 'asserts'
      continue
    }

    if (section === 'asserts' && line.startsWith('*')) {
      const assertContent = line.replace(/^\*\s*/, '').trim()
      if (assertContent && assertContent !== 'Asserts') {
        const failed = /failure|error/i.test(assertContent)
        if (assertContent.startsWith('>')) {
          current.asserts.push({
            description: assertContent.slice(1).trim(),
            passed: true,
          })
        } else if (failed) {
          if (current.asserts.length > 0) {
            current.asserts[current.asserts.length - 1].passed = false
          } else {
            current.asserts.push({
              description: assertContent,
              passed: false,
            })
          }
        }
      }
      continue
    }

    // Error/failure details
    if (line.startsWith('error:') || line.startsWith(' --> ') || line.startsWith(' |')) {
      if (current.asserts.length > 0) {
        const last = current.asserts[current.asserts.length - 1]
        last.description += `\n${line.trim()}`
        last.passed = false
      }
      continue
    }
  }

  pushEntry()

  if (entries.length === 0) return null
  return { entries }
}
