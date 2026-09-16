export const EDITOR_CSP_POLICY =
  "style-src * 'unsafe-hashes' 'nonce-sn-editor-csp-nonce' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; connect-src https://api.standardnotes.com https://assets.standardnotes.com https://sync.standardnotes.org https://files.standardnotes.com ws://sockets.standardnotes.com https://raw.githubusercontent.com https://listed.to blob:;";

// Mermaid itself creates temporary SVG style elements while rendering. Keep
// that exception out of the editor document by using a script-only sandboxed
// frame with every network and navigation capability denied.
export const MERMAID_RENDERER_CSP_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src blob:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';";
