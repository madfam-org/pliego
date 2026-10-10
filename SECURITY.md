# Security

> Boundary checkpoint (2026-10-10): public policy. Report privately; never post a vulnerability in
> a public issue.

Please report vulnerabilities through GitHub's private vulnerability reporting for this repository:
the "Report a vulnerability" button under the Security tab. We acknowledge reports within three
business days.

What we treat as highest severity:

- **Code execution from a document.** A sheet document, stock card or commons cartridge that makes
  the API, the kernel or the studio execute code, read files or reach the network it should not.
- **Auth bypass.** Any `/api/v1` route that should require a Janua RS256 token of audience
  `pliego-api` and answers without one, or a service that starts with auth disabled outside local
  or test.
- **Injection in the studio.** Script execution through document content, SVG, filenames or
  translations; anything that needs the Content-Security-Policy relaxed.
- **Fabrication safety.** An export that silently differs from the document (a cut where a score
  was declared, a missing perforation), or any path that dispatches to a machine without Pravara MES.
- **Credential exposure.** Any secret in a commit, log, URL or response.

Licensing and attribution disputes about commons objects are not security reports; open an issue
in the commons repository instead.
