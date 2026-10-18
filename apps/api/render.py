"""Run a cartridge through the sandbox runner as a killable subprocess.

The subprocess gets a minimal environment (no secrets from the worker's environment, no proxies),
its own session (the whole process group is killed on timeout), stdin for the parameters (no argv
length limit), and a private temporary directory under ``TMPDIR`` (/tmp is the only writable path
in the image). The runner owns the read-proof line; this module transports its outputs.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from .config import Settings
from .manifest import Cartridge, Mode

RUNNER = Path(__file__).resolve().parent / "services" / "engine" / "pliego_runner.py"
sys.path.insert(0, str(RUNNER.parent))
from pliego_runner import RUNNER_FORMATS, available_formats  # noqa: E402

# format → (media type, file extension). Mirrors pliego.export.EXPORTERS (kernel-gen); a test fails
# when the two drift, and ``fold`` is the sheet document itself.
TRANSPORT: dict[str, tuple[str, str]] = {
    "fold": ("application/json", "fold"),
    "svg": ("image/svg+xml", "svg"),
    "dxf": ("image/vnd.dxf", "dxf"),
    "pdf": ("application/pdf", "pdf"),
    "hpgl": ("application/vnd.hp-hpgl", "plt"),
    "glb": ("model/gltf-binary", "glb"),
}
_MISSING = [f for f in RUNNER_FORMATS if f not in TRANSPORT]
if _MISSING:  # fail at import, not on the first request
    raise RuntimeError(f"pliego_runner emits {_MISSING} but render.py has no media type for them")


# Stable codes in every render error body (openapi.json, Error.code).
CODE_TIMEOUT = "render_timeout"   # 504: the runner hit the timeout and was killed
CODE_INVALID = "render_invalid"   # 422: the document failed verify; the issues say why
CODE_FAILED = "render_failed"     # 422: the runner failed without issues (crash, policy, limits)


class RenderError(Exception):
    """A render that produced no document. ``str(exc)`` is what a client may read: never the
    runner's stderr. ``diagnostic`` carries the stderr tail for server-side logs and build
    reports only, under ``request_id`` (the id the client gets in the body)."""

    def __init__(self, message: str, status: int = 422, report: dict | None = None, *,
                 code: str = CODE_FAILED, diagnostic: str = ""):
        super().__init__(message)
        self.status, self.report = status, report or {}
        self.code, self.diagnostic = code, diagnostic
        self.request_id = uuid.uuid4().hex

    def server_detail(self) -> str:
        """The message plus the stderr tail, for logs and build reports (never a response)."""
        return f"{self}; stderr: {self.diagnostic}" if self.diagnostic else str(self)


@dataclass(frozen=True)
class RenderResult:
    document: bytes
    exports: dict[str, bytes]
    verify: str
    report: dict
    seconds: float


class Renderer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._formats: tuple[str, ...] | None = None

    def capability(self) -> tuple[str, ...]:
        """Formats the runner can write with the installed kernel (computed once per worker)."""
        if self._formats is None:
            self._formats = available_formats()
        return self._formats

    def published_formats(self, cart: Cartridge) -> list[str]:
        """The manifest's ``export_formats`` ∩ the runner's capability, in runner order.

        A manifest that declares nothing publishes nothing: formats are an explicit claim."""
        claimed = set(cart.export_formats)
        return [f for f in self.capability() if f in claimed]

    @staticmethod
    def _env() -> dict[str, str]:
        tmp = tempfile.gettempdir()
        env = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
               "HOME": tmp, "TMPDIR": tmp}
        if "PLIEGO_RUNNER_MAX_AS_MB" in os.environ:
            env["PLIEGO_RUNNER_MAX_AS_MB"] = os.environ["PLIEGO_RUNNER_MAX_AS_MB"]
        return env

    def run(self, cart: Cartridge, mode: Mode, params: dict,
            formats: tuple[str, ...] = ()) -> RenderResult:
        timeout = self.settings.render_timeout_s
        started = time.monotonic()
        with tempfile.TemporaryDirectory(prefix="pliego-render-") as tmp:
            out = Path(tmp)
            # -I: isolated mode (no PYTHON* variables, no user site, no cwd on sys.path); -B: no
            # bytecode writes. A source checkout's kernel is passed explicitly (the image
            # installs it).
            cmd = [sys.executable, "-I", "-B", str(RUNNER), str(mode.script), str(out),
                   "--params-stdin", "--formats", ",".join(formats),
                   "--cartridge", cart.slug, "--mode", mode.id, "--timeout", str(timeout)]
            if self.settings.materials.is_dir():
                cmd += ["--materials", str(self.settings.materials)]
            if self.settings.kernel_src.is_dir():
                cmd += ["--kernel-path", str(self.settings.kernel_src)]
            env = self._env()
            proc = subprocess.Popen(  # noqa: S603 — fixed argv, no shell
                cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                cwd=tmp, env=env, start_new_session=True, close_fds=True,
            )
            try:
                stdout, stderr = proc.communicate(json.dumps(params).encode("utf-8"),
                                                  timeout=timeout)
            except subprocess.TimeoutExpired:
                _kill_group(proc)
                proc.communicate()
                raise RenderError(f"render timed out after {timeout:g} s", status=504,
                                  code=CODE_TIMEOUT) from None
            seconds = time.monotonic() - started
            report = _read_json(out / "report.json")
            verify = report.get("verify") or _verify_from(stdout)
            if proc.returncode != 0:
                public = {"verify": verify, "issues": report.get("issues", [])}
                detail = _issues_detail(report)
                if detail:
                    raise RenderError(detail, status=422, report=public, code=CODE_INVALID)
                raise RenderError("render failed", status=422, report=public, code=CODE_FAILED,
                                  diagnostic=_stderr_tail(stderr))
            document = (out / "document.fold").read_bytes()
            exports = {f: (out / f"export.{f}").read_bytes() for f in formats}
            return RenderResult(document, exports, verify, report, seconds)


def _kill_group(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        proc.kill()


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _verify_from(stdout: bytes) -> str:
    for line in stdout.decode("utf-8", "replace").splitlines():
        if line.startswith("verify: "):
            return line
    return ""


def _issues_detail(report: dict) -> str:
    """The runner's error issues (kernel verify, cartridge, export): the contract's own reasons."""
    errors = [i for i in report.get("issues", []) if i.get("level") == "error"]
    return "; ".join(f"{i.get('kind')}: {i.get('detail')}" for i in errors[:4])


def _stderr_tail(stderr: bytes, lines: int = 20) -> str:
    """The last lines of the runner's stderr, for the server log only (paths, tracebacks)."""
    return "\n".join(stderr.decode("utf-8", "replace").strip().splitlines()[-lines:])
