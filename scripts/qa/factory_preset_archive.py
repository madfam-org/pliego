"""Opt-in, offline native sheet producer for draft factory-preset-archive/0.1.

No service, UI, geometry contract or engine fingerprint is changed. Only trusted
commons scripts may be evaluated (the native runner is not a security sandbox).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import struct
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = "factory-preset-archive/0.1"
GLB_FRAME = {"units": "m", "up_axis": "Y", "handedness": "right"}
FOLD_FRAME = {"units": "mm", "up_axis": "Y", "handedness": "right",
              "space": "flat-sheet-layout", "dimensions": 2}
SVG_FRAME = {"units": "mm", "up_axis": "down", "handedness": "presentation",
             "space": "native-svg-canvas", "physical_geometry": False}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def sha(blob):
    return hashlib.sha256(blob).hexdigest()


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE)


def commit(root, pin):
    if not isinstance(pin, str) or not re.fullmatch(r"[0-9a-f]{40}", pin):
        raise ValueError("pin must be a full lowercase 40-hex commit")
    if git(root, "rev-parse", pin + "^{commit}").decode().strip() != pin:
        raise ValueError("pin does not name the exact commit")
    return pin


def safe(root, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ValueError("archive paths must be relative")
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("archive path escapes root")
    return path


def tree_files(repo, pin, prefix):
    names = git(repo, "ls-tree", "-r", "--name-only", pin, "--", prefix).decode().splitlines()
    if not names:
        raise ValueError(f"empty pinned closure: {prefix}")
    return {name: git(repo, "show", f"{pin}:{name}") for name in sorted(names)}


def put(root, path, blob):
    target = safe(root, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(blob)
    return {"path": path, "sha256": sha(blob), "bytes": len(blob)}


def capture(root, namespace, blobs):
    return [{"path": name, "sha256": sha(blob),
             "archive_path": put(root, f"closure/{namespace}/{name}", blob)["path"]}
            for name, blob in sorted(blobs.items())]


def file_digest(files):
    return digest([{k: row[k] for k in ("path", "sha256")} for row in files])


def runtime_blobs(repo, pin):
    blobs = {**tree_files(repo, pin, "packages/kernel/src/pliego"),
             **tree_files(repo, pin, "materials")}
    blobs["packages/kernel/pyproject.toml"] = git(
        repo, "show", f"{pin}:packages/kernel/pyproject.toml")
    adapter = "scripts/qa/factory_preset_archive.py"
    if git(repo, "ls-tree", "--name-only", pin, "--", adapter).strip():
        blobs.update(tree_files(repo, pin, adapter))
    return blobs


def load_native():
    sys.path.insert(0, str(ROOT / "packages/kernel/src"))
    import pliego
    if not Path(pliego.__file__).resolve().is_relative_to(ROOT / "packages/kernel/src"):
        raise ValueError("imported kernel is outside captured runtime")
    from pliego.cartridge import check_result, execute, find_result
    from pliego.export import to_glb, to_svg
    return execute, find_result, check_result, to_glb, to_svg


def inspect_glb(blob):
    if len(blob) < 20 or blob[:4] != b"glTF":
        raise ValueError("asset is not a GLB")
    version, length, size, kind = struct.unpack_from("<IIII", blob, 4)
    if version != 2 or length != len(blob) or kind != 0x4E4F534A:
        raise ValueError("invalid GLB header")
    gl = json.loads(blob[20:20 + size])
    if gl.get("asset", {}).get("extras", {}).get("pliego:unit_scale") != 0.001:
        raise ValueError("native GLB must record mm-to-m unit scale .001")
    return {"clips": [a.get("name") for a in gl.get("animations", [])],
            "morph_targets": max((len(p.get("targets", []))
                                  for m in gl.get("meshes", [])
                                  for p in m.get("primitives", [])), default=0),
            "asset": gl.get("asset")}


def resolve(manifest, preset, mode, overrides):
    if not isinstance(overrides, dict):
        raise TypeError("requested params must be an object")
    defs = {p["id"]: p.get("default") for p in manifest.get("parameters", [])}
    if set(overrides) - set(defs):
        raise ValueError("unknown requested parameters")
    modes = [m["id"] for m in manifest.get("modes", [])] or ["default"]
    if mode not in modes:
        raise ValueError("unknown native mode")
    values = {}
    if preset != "default":
        found = [p for p in manifest.get("presets", []) if p["id"] == preset]
        if len(found) != 1:
            raise ValueError("unknown/ambiguous preset")
        values = found[0].get("values", {})
    requested = {**values, **overrides}
    params = {**defs, **requested}
    script = next((m.get("script_file", "main.py") for m in manifest.get("modes", [])
                   if m["id"] == mode), "main.py")
    return params, script, requested


def evaluate(blobs, slug, preset, mode, overrides):
    execute, find_result, check_result, to_glb, to_svg = load_native()
    manifest = json.loads(blobs[f"{slug}/project.json"])
    injected, script, _ = resolve(manifest, preset, mode, overrides)
    source = f"{slug}/{script}"
    if source not in blobs:
        raise ValueError("mode script escapes captured cartridge closure")
    ns = execute(blobs[source].decode(), {**injected, "mode": mode}, script)
    # Native cartridges normalize/clamp named parameter globals in their own code.
    resolved = {k: ns[k] for k in injected}
    canonical(resolved)  # reject non-JSON/nonfinite values rather than fabricate them
    check = check_result(find_result(ns), cartridge=slug, mode=mode, params=resolved)
    if not check.ok:
        raise ValueError(f"native verification failed: {check.issues}")
    from pliego.cartridge import manifest_ref_problems
    problems = manifest_ref_problems(manifest)
    if problems:
        raise ValueError(f"native reference resolution failed: {problems}")
    doc = check.document.data
    return resolved, doc, check.document.to_json(pretty=True).encode(), \
        to_glb(doc, animate=True), to_svg(doc).encode(), check.line


def produce(commons, pin, slug, preset, mode, overrides, out, runtime_pin):
    commit(commons, pin)
    commit(ROOT, runtime_pin)
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
        raise ValueError("invalid slug")
    source_blobs = tree_files(commons, pin, slug)
    runtime_source = runtime_blobs(ROOT, runtime_pin)
    # Runtime must match its claimed pinned bytes, including vendored data and materials.
    for name, blob in runtime_source.items():
        if (ROOT / name).read_bytes() != blob:
            raise ValueError(f"runtime differs from pinned closure: {name}")
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise ValueError("output directory must be empty")
    os.environ["PLIEGO_MATERIALS"] = str(ROOT / "materials")
    resolved, doc, fold, glb, svg, line = evaluate(
        source_blobs, slug, preset, mode, overrides)
    _, _, requested = resolve(json.loads(source_blobs[f"{slug}/project.json"]),
                              preset, mode, overrides)
    files = capture(out, "source", source_blobs)
    runtime = {"repository": "https://github.com/madfam-org/pliego",
               "revision": runtime_pin, "files": capture(out, "runtime", runtime_source),
               "versions": {"python": platform.python_version(),
                            "implementation": platform.python_implementation(),
                            "pliego_kernel": tomllib.loads(runtime_source[
                                "packages/kernel/pyproject.toml"].decode())["project"]["version"]},
               "scope": "Pinned kernel source, vendored data and material cards; Python "
                        "version recorded, not a hermetic interpreter/stdlib image."}
    runtime["fingerprint"] = digest(runtime)
    assets = {}
    for kind, blob, frame in (("fold", fold, FOLD_FRAME), ("glb", glb, GLB_FRAME),
                              ("svg", svg, SVG_FRAME)):
        assets[kind] = {**put(out, f"assets/{slug}.{mode}.{preset}.{kind}", blob),
                        "frame": frame}
    entry = {"key": f"sheet/{slug}/{preset}", "slug": slug, "preset": preset,
             "mode": mode,
             "source": {"repository": "https://github.com/madfam-org/sheet-hyperobjects",
                        "commons": "sheet-hyperobjects", "pin": pin,
                        "tree": git(commons, "rev-parse", pin + "^{tree}").decode().strip(),
                        "params": requested, "caller_params": overrides, "preset": preset,
                        "manifest_sha256": sha(source_blobs[f"{slug}/project.json"]),
                        "files": files, "source_sha256": file_digest(files)},
             "resolved_parameters": resolved,
             "parts": [s["id"] for s in doc["pliego:sheets"]], "runtime": runtime,
             "engine_fingerprint": runtime["fingerprint"], "frame": GLB_FRAME,
             "assets": assets,
             "geometry_sha256": doc["pliego:meta"]["digest"],
             "provenance": {"native_verification": line, "animation": inspect_glb(glb),
                            "authoritative": "assets.fold: flat native FOLD plus program",
                            "parameter_resolution": "manifest defaults + preset + requested "
                            "overrides, then post-execution named parameter globals",
                            "producer_sha256": sha(Path(__file__).read_bytes()),
                            "limits": ["Draft exchange, not a ratified keystone contract.",
                                       "No retail-package physical fit or SKU binding.",
                                       "Folding clips are construction, not inferred unboxing."]}}
    # Unsigned content hash for cache invalidation, not an authentication signature.
    entry["entry_digest"] = digest(entry)
    archive = {"schema": SCHEMA, "factory": "sheet", "entries": [entry],
               "coverage": {"requested": [entry["key"]], "rendered": [entry["key"]],
                            "failed": [], "skipped_fold_state": []}}
    put(out, "manifest.json", json.dumps(archive, indent=2, ensure_ascii=False,
                                        allow_nan=False).encode() + b"\n")
    print(f"factory-preset-archive: entries=1 parts={len(entry['parts'])} {line}")
    return archive


def captured(root, rows):
    result = {}
    for row in rows:
        if row["path"] in result:
            raise ValueError("duplicate closure path")
        blob = safe(root, row["archive_path"]).read_bytes()
        if sha(blob) != row["sha256"]:
            raise ValueError(f"stale closure: {row['path']}")
        result[row["path"]] = blob
    if not result:
        raise ValueError("empty closure")
    return result


def check_archive(root, expected_pin=None, commons=None, replay=False):
    data = json.loads((root / "manifest.json").read_bytes())
    if data.get("schema") != SCHEMA or data.get("factory") != "sheet" or not data.get("entries"):
        raise ValueError("wrong/empty native sheet archive")
    keys = set()
    for entry in data["entries"]:
        if digest({k: v for k, v in entry.items() if k != "entry_digest"}) != entry["entry_digest"]:
            raise ValueError("entry digest mismatch")
        source = entry["source"]
        pin = source["pin"]
        if not re.fullmatch(r"[0-9a-f]{40}", pin) or (expected_pin and pin != expected_pin):
            raise ValueError("wrong source pin")
        if entry["key"] in keys:
            raise ValueError("duplicate archive key")
        keys.add(entry["key"])
        if entry["key"] != f"sheet/{entry['slug']}/{entry['preset']}":
            raise ValueError("entry identity mismatch")
        blobs = captured(root, source["files"])
        if file_digest(source["files"]) != source["source_sha256"]:
            raise ValueError("source digest mismatch")
        if commons:
            commit(commons, pin)
            if blobs != tree_files(commons, pin, entry["slug"]):
                raise ValueError("source closure differs from pin")
        manifest_blob = blobs[f"{entry['slug']}/project.json"]
        if sha(manifest_blob) != source["manifest_sha256"]:
            raise ValueError("manifest hash mismatch")
        runtime = entry["runtime"]
        captured(root, runtime["files"])
        if digest({k: v for k, v in runtime.items() if k != "fingerprint"}) != runtime["fingerprint"]:
            raise ValueError("runtime fingerprint mismatch")
        if entry["engine_fingerprint"] != runtime["fingerprint"]:
            raise ValueError("runtime/engine fingerprint mismatch")
        if entry["frame"] != GLB_FRAME:
            raise ValueError("entry frame must be metres Y-up right-handed")
        assets = {}
        for kind, frame in (("glb", GLB_FRAME), ("svg", SVG_FRAME), ("fold", FOLD_FRAME)):
            asset = entry["assets"][kind]
            blob = safe(root, asset["path"]).read_bytes()
            if sha(blob) != asset["sha256"] or len(blob) != asset["bytes"]:
                raise ValueError(f"stale asset: {kind}")
            if asset["frame"] != frame:
                raise ValueError(f"wrong asset unit/frame: {kind}")
            assets[kind] = blob
        doc = json.loads(assets["fold"])
        if doc["frame_unit"] != "mm" or "creasePattern" not in doc["frame_classes"]:
            raise ValueError("authoritative FOLD must preserve flat mm layout")
        if entry["parts"] != [s["id"] for s in doc["pliego:sheets"]]:
            raise ValueError("parts do not match actual sheet IDs")
        if entry["resolved_parameters"] != doc["pliego:meta"]["params"]:
            raise ValueError("resolved parameters differ from native document")
        if entry["geometry_sha256"] != doc["pliego:meta"]["digest"]:
            raise ValueError("native geometry digest mismatch")
        if entry["provenance"]["animation"] != inspect_glb(assets["glb"]):
            raise ValueError("animation claim differs from inspected GLB")
        _, _, requested = resolve(json.loads(manifest_blob), entry["preset"], entry["mode"],
                                  source["caller_params"])
        if source["preset"] != entry["preset"] or requested != source["params"]:
            raise ValueError("effective requested preset parameters mismatch")
        if replay:
            commit(ROOT, runtime["revision"])
            pinned = runtime_blobs(ROOT, runtime["revision"])
            if captured(root, runtime["files"]) != pinned:
                raise ValueError("runtime closure differs from revision")
            if any((ROOT / p).read_bytes() != b for p, b in pinned.items()):
                raise ValueError("local runtime differs from capture")
            if runtime["versions"]["python"] != platform.python_version():
                raise ValueError("Python runtime version differs from capture")
            os.environ["PLIEGO_MATERIALS"] = str(ROOT / "materials")
            resolved, _, fold, glb, svg, _ = evaluate(
                blobs, entry["slug"], entry["preset"], entry["mode"], source["params"])
            if resolved != entry["resolved_parameters"]:
                raise ValueError("requested parameters do not reproduce resolved parameters")
            if {"fold": fold, "glb": glb, "svg": svg} != assets:
                raise ValueError("native replay differs from assets")
    if set(data["coverage"]["rendered"]) != keys:
        raise ValueError("coverage differs from entries")
    print(f"factory-preset-archive: entries={len(keys)} failures=0 replay={replay}")
    return data


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", type=Path, help="validate an existing archive directory")
    ap.add_argument("--commons", type=Path)
    ap.add_argument("--pin")
    ap.add_argument("--runtime-pin")
    ap.add_argument("--slug")
    ap.add_argument("--preset", default="default")
    ap.add_argument("--mode", default="default")
    ap.add_argument("--params", default="{}")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--replay", action="store_true")
    args = ap.parse_args(argv)
    try:
        if args.check:
            check_archive(args.check, args.pin, args.commons, args.replay)
        else:
            if not all((args.commons, args.pin, args.runtime_pin, args.slug, args.out)):
                ap.error("producer requires --commons --pin --runtime-pin --slug --out")
            produce(args.commons, args.pin, args.slug, args.preset, args.mode,
                    json.loads(args.params), args.out, args.runtime_pin)
        return 0
    except (ValueError, TypeError, KeyError, OSError, subprocess.CalledProcessError) as exc:
        print(f"factory-preset-archive: failures=1 {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
