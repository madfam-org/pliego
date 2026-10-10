"""Pliego's cartridge policy on top of the shared ``commons_sandbox`` core.

``commons_sandbox`` (vendored, LOCK.json) supplies the safe-builtins whitelist (no ``open``,
``eval``, ``exec``, ``compile``, ``getattr``, ``globals``, ``vars``, ``__build_class__``), the
module blocklist and the realpath-checked script path. Pliego adds three layers, because a blocklist
alone still lets a script walk object graphs:

1. **An import allowlist** — ``pliego``, ``math`` and ``__future__`` only, absolute imports only.
2. **A static AST check** before anything runs: no dunder or private attribute (``x.__class__``,
   ``x._mod``), no frame / generator / coroutine / traceback / code-object attribute
   (``gi_frame``, ``f_back``, ``tb_frame``, ``co_code`` …), no dunder name other than
   ``__name__`` (``__builtins__``, ``__import__``), the same rules for ``match`` class patterns and
   ``from … import`` aliases, and imports outside the allowlist rejected up front.
3. **Module proxies**: the cartridge never holds a real module object. ``pliego`` and ``math`` are
   read-only proxies that expose public attributes only, wrap sub-modules of the same package, and
   refuse any module from elsewhere (``pliego.stock.os`` is an AttributeError) as well as the
   file-touching surface (``pliego.export``, ``pliego.foldfile``, and ``load*``/``read*``/
   ``write*``/``save*``/``open*`` callables): cartridges build geometry; the runner does the I/O.

Defense in depth, not a boundary on its own: the runner is still a killable subprocess with a
minimal environment, resource limits and (on Linux) no ptrace/proc access to itself.
"""

from __future__ import annotations

import ast
import types
from collections.abc import Callable

ALLOWED_IMPORTS = frozenset({"pliego", "math", "__future__"})
ALLOWED_DUNDER_NAMES = frozenset({"__name__"})
DENIED_SUBMODULES = frozenset({"export", "foldfile"})
DENIED_CALLABLE_PREFIXES = ("load", "read", "write", "save", "open", "from_file", "to_file")
FORBIDDEN_ATTR_PREFIXES = ("_", "gi_", "cr_", "ag_", "tb_", "co_")
FORBIDDEN_ATTRS = frozenset({
    "f_back", "f_globals", "f_locals", "f_builtins", "f_code", "f_trace", "f_lasti", "f_lineno",
})
MAX_SOURCE_BYTES = 256 * 1024


class PolicyError(ValueError):
    """The cartridge source breaks the sandbox policy (raised before execution)."""


def _attr_forbidden(name: str) -> bool:
    return name.startswith(FORBIDDEN_ATTR_PREFIXES) or name in FORBIDDEN_ATTRS


def _check_import(name: str | None, level: int, lineno: int) -> None:
    if level:
        raise PolicyError(f"line {lineno}: relative imports are not allowed")
    top = (name or "").split(".")[0]
    if top not in ALLOWED_IMPORTS:
        raise PolicyError(f"line {lineno}: import of {name!r} is not allowed "
                          f"(allowed: {', '.join(sorted(ALLOWED_IMPORTS))})")
    if any(part in DENIED_SUBMODULES or part.startswith("_")
           for part in (name or "").split(".")[1:]):
        raise PolicyError(f"line {lineno}: import of {name!r} is not allowed in cartridges")


def check_source(source: str, filename: str = "<cartridge>") -> ast.Module:
    """Parse and statically vet a cartridge; raise PolicyError on the first violation."""
    if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise PolicyError(f"cartridge source exceeds {MAX_SOURCE_BYTES} bytes")
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as exc:
        raise PolicyError(f"syntax error: {exc}") from exc
    for node in ast.walk(tree):
        line = getattr(node, "lineno", 0)
        if isinstance(node, ast.Attribute) and _attr_forbidden(node.attr):
            raise PolicyError(f"line {line}: attribute {node.attr!r} is not allowed")
        if isinstance(node, ast.Name) and node.id.startswith("__") \
                and node.id not in ALLOWED_DUNDER_NAMES:
            raise PolicyError(f"line {line}: name {node.id!r} is not allowed")
        if isinstance(node, ast.MatchClass):
            for attr in node.kwd_attrs:
                if _attr_forbidden(attr):
                    raise PolicyError(f"line {line}: pattern attribute {attr!r} is not allowed")
        if isinstance(node, ast.Import):
            for alias in node.names:
                _check_import(alias.name, 0, line)
        if isinstance(node, ast.ImportFrom):
            _check_import(node.module, node.level, line)
            for alias in node.names:
                if alias.name == "*" or alias.name.startswith("_") \
                        or alias.name in DENIED_SUBMODULES:
                    raise PolicyError(f"line {line}: 'from {node.module} import {alias.name}' "
                                      "is not allowed")
    return tree


class SafeModule:
    """A read-only, public-only view of a module (and its same-package sub-modules)."""

    __slots__ = ("_SafeModule__mod", "_SafeModule__package")

    def __init__(self, module: types.ModuleType, package: str | None = None) -> None:
        object.__setattr__(self, "_SafeModule__mod", module)
        object.__setattr__(self, "_SafeModule__package", package or module.__name__)

    def __getattr__(self, name: str):
        if name.startswith("_") or name in DENIED_SUBMODULES:
            raise AttributeError(f"{name!r} is not part of the cartridge API")
        value = getattr(self.__mod, name)
        if isinstance(value, types.ModuleType):
            pkg = self.__package
            if value.__name__ == pkg or value.__name__.startswith(pkg + "."):
                return SafeModule(value, pkg)
            raise AttributeError(f"{name!r} is not part of the cartridge API")
        if callable(value) and not isinstance(value, type) \
                and name.lower().startswith(DENIED_CALLABLE_PREFIXES):
            raise AttributeError(f"{name!r} touches files; cartridges may not call it")
        return value

    def __setattr__(self, name: str, value) -> None:
        raise AttributeError("sandboxed modules are read-only")

    def __delattr__(self, name: str) -> None:
        raise AttributeError("sandboxed modules are read-only")

    def __dir__(self):
        return [n for n in dir(self.__mod) if not n.startswith("_")]

    def __repr__(self) -> str:
        return f"<sandboxed module {self.__mod.__name__!r}>"


def make_allowlist_import(base_import: Callable) -> Callable:
    """An ``__import__`` that admits ALLOWED_IMPORTS only and hands back SafeModule proxies.

    ``base_import`` is commons_sandbox's restricted import (blocklist, then the real importer)."""

    def _import(name, globals=None, locals=None, fromlist=(), level=0):
        _check_import(name, level, 0)
        module = base_import(name, globals, locals, fromlist, level)
        if name.split(".")[0] == "__future__":
            return module
        return SafeModule(module, name.split(".")[0])

    return _import
