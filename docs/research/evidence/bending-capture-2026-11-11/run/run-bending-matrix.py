"""Frozen, portable bending fixed-24 capture driver (derived from the planar run-state-matrix.py).
Prepare and execute are separate; only the derived stages and totals differ from the planar driver.

No accepted process starts during prepare. CLI arguments supply private paths;
written command records use {repo}/{run} placeholders and bind executable bytes.
"""
import argparse
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
SELF = Path(__file__).resolve()
MANIFEST = HERE / "pipeline-manifest.json"
PLAN = HERE / "pipeline-plan.json"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return {"bytes": path.stat().st_size, "sha256": h.hexdigest()}


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def load(path):
    def bad_constant(value):
        raise ValueError("nonfinite JSON constant: " + value)
    with path.open("r") as f:
        return json.load(f, parse_constant=bad_constant)


def exclusive(path):
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb")


def write(path, value):
    with exclusive(path) as f:
        f.write(value if isinstance(value, bytes) else canonical(value))
        f.flush()
        os.fsync(f.fileno())


def command(repo, args):
    return subprocess.check_output(args, cwd=repo, text=True).strip()


def frozen():
    manifest = load(MANIFEST)
    assert manifest["schema"] == "pliego-bending-matrix-runner-manifest/1"
    assert {f["file"] for f in manifest["files"]} == {SELF.name, PLAN.name}
    for f in manifest["files"]:
        assert digest(HERE / f["file"]) == {k: f[k] for k in ("bytes", "sha256")}, "frozen driver changed"
    for f in manifest.get("auxiliaryFrozenFiles", []):
        assert digest(HERE / f["path"]) == {k: f[k] for k in ("bytes", "sha256")}, "frozen external reviewer changed"
    return manifest, load(PLAN)


def source(repo, commit):
    assert command(repo, ["git", "rev-parse", "HEAD"]) == commit, "source commit differs"
    assert command(repo, ["git", "status", "--porcelain", "--untracked-files=all"]) == "", "source is dirty"
    listed = subprocess.check_output(["git", "ls-files", "-z", "packages/engine/src", "packages/engine/bench", "packages/engine/test"], cwd=repo)
    paths = {x.decode() for x in listed.split(b"\0") if x}
    return [{"path": p, **digest(repo / p)} for p in sorted(paths)]


def private_directory(path, repo, create=False):
    path = path.resolve()
    assert path != repo and repo not in path.parents, "run directory must be outside checkout"
    assert not any(path == p or p in path.parents for p in [Path("/tmp").resolve(), Path("/private/tmp"), Path("/var/folders")]), "temporary storage refused"
    if create:
        assert path.parent.is_dir(), "create durable parent first"
        path.mkdir(mode=0o700)
    assert path.is_dir() and stat.S_IMODE(path.stat().st_mode) == 0o700, "private0700 directory required"
    return path


def executable(value):
    path = Path(shutil.which(value) or value).resolve()
    assert path.is_file(), "executable unavailable"
    version = subprocess.check_output([str(path), "--version"], stderr=subprocess.STDOUT, text=True).strip()
    return path, {"requested": Path(value).name, "version": version, **digest(path)}


def prepare(args):
    manifest, plan = frozen()
    repo = args.repo.resolve()
    assert len(args.commit) == 40 and all(c in "0123456789abcdef" for c in args.commit)
    inventory = source(repo, args.commit)
    for item in manifest["unchangedOracleFiles"]:
        assert digest(repo / item["path"])["sha256"] == item["sha256"], "unchanged oracle/helper source differs"
    # The resolved executables are supplied again during execute and byte checked.
    _, node = executable(args.node)
    _, python = executable(args.python)
    out = private_directory(args.run_dir, repo, create=True)
    write(out / "source-pin.json", {"schema": "pliego-bending-matrix-source-pin/1", "git": args.commit,
                                    "files": inventory, "inventorySHA256": sha(canonical(inventory))})
    for file in (SELF, PLAN, MANIFEST):
        write(out / file.name, file.read_bytes())
    execution = {"schema": "pliego-bending-matrix-prepared/1", "preparedAt": utc(), "sourceGit": args.commit,
                 "sourceInventorySHA256": sha(canonical(inventory)), "runnerManifestSHA256": digest(MANIFEST)["sha256"],
                 "runnerSHA256": digest(SELF)["sha256"], "planSHA256": digest(PLAN)["sha256"],
                 "executables": {"node": node, "python": python}, "plan": plan,
                 "pathBindings": {"{repo}": "CLI --repo resolved checkout", "{run}": "CLI --run-dir resolved durable directory"},
                 "environment": {"PYTHONDONTWRITEBYTECODE": "1", "PLIEGO_AUDIT_PYTHON": "byte-bound --python executable", "NODE_OPTIONS": "must be empty"},
                 "acceptedProcessesStarted": 0, "scope": "frozen preparation only; execute requires this manifest digest"}
    write(out / "prepared.json", execution)
    print(json.dumps({"preparedSHA256": digest(out / "prepared.json")["sha256"], "sourceGit": args.commit, "acceptedProcessesStarted": 0}), flush=True)


def full_equal(a, b):
    """Exact decoded proof equality; precision exclusions are made only by caller."""
    if isinstance(a, dict) or isinstance(b, dict):
        assert isinstance(a, dict) and isinstance(b, dict) and a.keys() == b.keys(), "proof keys differ"
        return sum(full_equal(a[k], b[k]) for k in a)
    if isinstance(a, list) or isinstance(b, list):
        assert isinstance(a, list) and isinstance(b, list) and len(a) == len(b), "proof array shape differs"
        return sum(full_equal(x, y) for x, y in zip(a, b))
    assert type(a) is type(b) and a == b, "proof leaf differs"
    # Python equality alone would identify signed zeros. Preserve float signs too.
    if isinstance(a, float) and a == 0:
        assert a.hex() == b.hex(), "proof signed zero differs"
    return 1


def oracle_comparison(out, plan):
    probe = load(out / "probes.json")
    proofs = [load(out / ("oracle-" + str(d) + ".json")) for d in (80, 100)]
    n = len(probe["cases"])
    assert probe["schema"] == "pliego-bending-state-probes/1"
    assert n > 0 and probe["coverage"]["allPoststepsEvaluated"] is False
    assert {c["selection"]["trajectoryIndex"] for c in probe["cases"]} == set(range(24))
    for p, digits in zip(proofs, (80, 100)):
        assert p["schema"] == "pliego-bending-state-precision-batch/1"
        assert p["inputSHA256"] == digest(out / "probes.json")["sha256"] and len(p["cases"]) == n
        for c in p["cases"]:
            assert c["decimalDigits"] == digits
    normalized = copy.deepcopy(proofs)
    for p in normalized:
        for c in p["cases"]:
            del c["decimalDigits"]
    leaves = full_equal(*normalized)
    items = [c["truth"][mode] for c in proofs[0]["cases"] for mode in ("authoritative", "public")]
    worst = lambda values: max((v for v in values if v is not None), default=0.0)
    maxima = {
        "membraneImpliedEnergyErrorNJ": worst(i["membrane"]["impliedObservedEnergyError"]["absoluteNJ"] for i in items),
        "bendingEnergyErrorNJ": worst(i["bending"]["energyError"]["absoluteNJ"] for i in items),
        "bendingImpliedGradientComponentErrorMicroN": worst(i["bending"]["impliedGradientError"]["maximumComponentMicroN"] for i in items),
        "elasticGradientComponentErrorMicroN": worst(i["elastic"]["gradientError"]["maximumComponentMicroN"] for i in items),
        "nativeCoefficientResidualComponentErrorMicroN": worst(i["nativeCoefficient"]["residualError"]["maximumComponentMicroN"] for i in items)}
    limits = plan["predeclaredRepresentedErrorLimits"]
    assert set(limits) == set(maxima), "every predeclared limit must be measured"
    disagreements = sum(1 for i in items if i["nativeCoefficient"]["agreesWithNativeGate"] is False)
    truth_failures = {mode: sum(1 for c in proofs[0]["cases"] if c["truth"][mode]["nativeCoefficient"]["passesUnchangedForceTolerance"] is False) for mode in ("authoritative", "public")}
    return {"schema": "pliego-bending-matrix-oracle-comparison/1", "completeProofEqual": True,
            "excludedFields": ["cases[].decimalDigits"], "excludedFieldInstancesPerProof": n, "leavesCompared": leaves,
            "inputs": {name: digest(out / name) for name in ("probes.json", "oracle-80.json", "oracle-100.json")},
            "cases": n, "coveredTrajectories": 24, "allPoststepsEvaluated": False, "allNewtonArmijoEvaluated": False,
            "maxima": maxima, "predeclaredLimits": limits, "representedErrorGates": {k: maxima[k] <= limits[k] for k in limits},
            "truthVersusNativeGateDisagreements": disagreements, "truthGateFailures": truth_failures,
            "scope": "complete sampled 80/100-digit proof identity except declared precision; sampled endpoints cannot certify all 7200 steps or 50400 Newton decisions, nor time/material/device/booklet acceptance"}


def summary(out, prepared, records):
    compared = {name: load(out / ("comparison-" + name + ".json")) for name in ("repeat", "parity")}
    precision = load(out / "oracle-comparison.json")
    selftest = load(out / "oracle-self-test.json")
    assert selftest["passed"] is True
    capture_gates = {}
    for name in ("candidate", "repeat", "plain"):
        report = load(out / (name + ".json"))
        totals = report["executionTotals"]
        for key, value in {"judgedCompletedPublicCalls": 7200, "retainedStates": 7224, "restoreControlCompletedPublicCalls": 24,
                           "restoreControlDeclaredNewtonIterations": 168}.items():
            assert totals[key] == value, "completed capture count differs: " + name + ":" + key
        assert report["protocol"]["poststeps"] == 7200 and report["protocol"]["newtonEvents"] == 50400
        capture_gates[name] = report["gates"]
        del report
    return {"schema": "pliego-bending-matrix-pipeline-summary/1", "sourceGit": prepared["sourceGit"],
            "preparedSHA256": digest(out / "prepared.json")["sha256"], "runnerManifestSHA256": prepared["runnerManifestSHA256"],
            "subprocessesCompleted": len(records), "allReturnCodesZero": all(r["returnCode"] == 0 for r in records),
            "captures": {name: digest(out / (name + ".json")) for name in ("candidate", "repeat", "plain")},
            "comparisonModes": {k: v["mode"] for k, v in compared.items()},
            "repeatIdentity": compared["repeat"]["comparison"], "observerParity": compared["parity"]["comparison"],
            "candidateForceOutcomes": compared["repeat"]["forceOutcomes"][0],
            "captureGatesUnmodified": capture_gates, "oracleSelfTest": selftest, "oracleComparison": precision,
            "scope": "pipeline completion/identity only; all false force gates and unmeasured physics/time/material/booklet/device gates retained; wall durations are research-processing receipts, never interaction or physics benchmarks"}


def execute(args):
    manifest, plan = frozen()
    repo = args.repo.resolve()
    out = private_directory(args.run_dir, repo)
    prepared = load(out / "prepared.json")
    assert digest(out / "prepared.json")["sha256"] == args.prepared_sha, "prepared manifest digest differs"
    assert prepared["runnerManifestSHA256"] == digest(MANIFEST)["sha256"]
    assert prepared["plan"] == plan
    for file in (SELF, PLAN, MANIFEST):
        assert (out / file.name).read_bytes() == file.read_bytes(), "prepared driver/plan changed"
    node, node_id = executable(args.node)
    python, python_id = executable(args.python)
    assert prepared["executables"] == {"node": node_id, "python": python_id}, "prepared executable bytes/version differ"
    assert not os.environ.get("NODE_OPTIONS"), "undeclared NODE_OPTIONS refused"
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PLIEGO_AUDIT_PYTHON": str(python)}
    pin = load(out / "source-pin.json")
    assert pin["git"] == prepared["sourceGit"] and pin["inventorySHA256"] == prepared["sourceInventorySHA256"]
    assert sha(canonical(pin["files"])) == pin["inventorySHA256"]
    records = []
    source_pin_digest = digest(out / "source-pin.json")

    def public_error(cause):
        message = str(cause)
        for path, symbol in [(str(repo), "{repo}"), (str(out), "{run}"), (str(HERE), "{pipeline}"), (str(python), "{python}"), (str(node), "{node}")]:
            message = message.replace(path, symbol)
        return {"type": type(cause).__name__, "message": message}
    with exclusive(out / "checkpoints.jsonl") as journal:
        def checkpoint(value):
            journal.write(canonical({"at": utc(), **value})); journal.flush(); os.fsync(journal.fileno())

        def guard(name, phase):
            frozen()
            assert digest(MANIFEST)["sha256"] == prepared["runnerManifestSHA256"]
            assert digest(SELF)["sha256"] == prepared["runnerSHA256"]
            assert digest(PLAN)["sha256"] == prepared["planSHA256"]
            assert digest(out / "prepared.json")["sha256"] == args.prepared_sha
            assert digest(out / "source-pin.json") == source_pin_digest
            current = source(repo, prepared["sourceGit"])
            assert current == pin["files"], "source inventory changed"
            receipt = {"schema": "pliego-bending-matrix-source-guard/1", "name": name, "phase": phase,
                       "git": prepared["sourceGit"], "clean": True, "files": len(current), "inventorySHA256": sha(canonical(current)),
                       "runnerManifestSHA256": prepared["runnerManifestSHA256"]}
            write(out / (name + ".source-" + phase + ".json"), receipt)

        def run(item):
            name, output = item["name"], out / item["output"]
            assert not output.exists(), "output already exists"
            guard(name, "before")
            checkpoint({"event": "process-start", "name": name, "argv": item["argv"], "stdin": item["stdin"], "output": item["output"]})
            actual = [str(node) if a == "{node}" else str(python) if a == "{python}" else str(out / a[6:]) if a.startswith("{run}/") else a for a in item["argv"]]
            input_path = out / item["stdin"] if item["stdin"] else None
            input_before = digest(input_path) if input_path else None
            started, clock = utc(), time.monotonic_ns()
            return_code, error, source_error, child = None, None, None, None
            stdout_name = item["output"] if item["stdoutIsOutput"] else name + ".stdout.log"
            try:
                with (input_path.open("rb") if input_path else open(os.devnull, "rb")) as inp, exclusive(out / stdout_name) as stdout, exclusive(out / (name + ".stderr.log")) as stderr:
                    child = subprocess.Popen(actual, cwd=repo, env=env, stdin=inp, stdout=stdout, stderr=stderr, start_new_session=True)
                    while True:
                        try:
                            return_code = child.wait(timeout=15)
                            break
                        except subprocess.TimeoutExpired:
                            elapsed = (time.monotonic_ns() - clock) / 1e9
                            checkpoint({"event": "process-running", "name": name, "elapsedResearchProcessingSeconds": elapsed,
                                        "stderrBytes": (out / (name + ".stderr.log")).stat().st_size})
                            print("RUNNING " + name + " " + str(round(elapsed, 1)) + "s", flush=True)
                    stdout.flush(); os.fsync(stdout.fileno()); stderr.flush(); os.fsync(stderr.fileno())
            except BaseException as cause:
                error = public_error(cause)
                if child is not None and child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL); child.wait()
                return_code = child.returncode if child is not None else None
            process_finished, process_clock = utc(), time.monotonic_ns()
            try:
                guard(name, "after")
                assert input_path is None or digest(input_path) == input_before, "stdin input changed"
            except BaseException as cause:
                source_error = public_error(cause)
            elapsed = (process_clock - clock) / 1e9
            record = {"schema": "pliego-bending-matrix-process-terminal/1", "name": name, "argv": item["argv"], "cwd": "{repo}",
                      "stdin": item["stdin"], "inputDigest": input_before, "output": item["output"], "startedAt": started, "finishedAt": process_finished, "receiptRecordedAt": utc(),
                      "returnCode": return_code, "researchProcessingWallSeconds": elapsed, "outputDigest": digest(output) if output.exists() else None,
                      "stdout": stdout_name, "stdoutDigest": digest(out / stdout_name) if (out / stdout_name).exists() else None,
                      "stderr": name + ".stderr.log", "stderrDigest": digest(out / (name + ".stderr.log")) if (out / (name + ".stderr.log")).exists() else None,
                      "processError": error, "sourceGuardError": source_error,
                      "durationScope": "untimed research process receipt; not an engine/interaction performance measurement"}
            write(out / (name + ".terminal.json"), record); records.append(record)
            checkpoint({"event": "process-finish", "name": name, "returnCode": return_code, "outputDigest": record["outputDigest"], "terminalDigest": digest(out / (name + ".terminal.json"))})
            print(name + ": returnCode=" + str(return_code), flush=True)
            assert return_code == 0 and error is None and source_error is None, "process/source failure: " + name
            assert output.is_file() and output.stat().st_size > 0, "missing/empty process output"

        try:
            checkpoint({"event": "accepted-pipeline-start", "sourceGit": prepared["sourceGit"], "preparedSHA256": args.prepared_sha})
            for item in plan["processes"]:
                run(item)
            for name, produce in [("oracle-comparison", lambda: oracle_comparison(out, plan)), ("summary", lambda: summary(out, prepared, records))]:
                guard(name, "before"); checkpoint({"event": "derived-start", "name": name})
                value = produce(); write(out / (name + ".json"), value)
                guard(name, "after"); checkpoint({"event": "derived-finish", "name": name, "outputDigest": digest(out / (name + ".json"))})
            terminal = {"schema": "pliego-bending-matrix-pipeline-terminal/1", "sourceGit": prepared["sourceGit"], "processes": records,
                        "pipelineCompleted": True, "sourceClean": True, "preparedSHA256": args.prepared_sha,
                        "files": [{"file": f.name, **digest(f)} for f in sorted(out.iterdir()) if f.is_file() and f.name != "checkpoints.jsonl"],
                        "scope": "complete research process chain, not universal physics or interaction acceptance; checkpoint journal remains append-only until close"}
            write(out / "pipeline-terminal.json", terminal); checkpoint({"event": "pipeline-complete", "terminalDigest": digest(out / "pipeline-terminal.json")})
            print("COMPLETE", flush=True)
        except BaseException as cause:
            failure = {"schema": "pliego-bending-matrix-pipeline-failure/1", "at": utc(), "sourceGit": prepared["sourceGit"],
                       "error": public_error(cause), "completedProcessReceipts": records,
                       "files": [{"file": f.name, **digest(f)} for f in sorted(out.iterdir()) if f.is_file() and f.name != "checkpoints.jsonl"],
                       "scope": "failed outputs and terminals retained; no overwrite/resume or successful-acceptance claim"}
            write(out / "pipeline-failure.json", failure); checkpoint({"event": "pipeline-failed", "error": failure["error"]})
            raise


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="mode", required=True)
    for name in ("prepare", "execute"):
        s = sub.add_parser(name); s.add_argument("--repo", type=Path, required=True); s.add_argument("--run-dir", type=Path, required=True)
        s.add_argument("--node", default="node"); s.add_argument("--python", default=sys.executable)
        if name == "prepare":
            s.add_argument("--commit", required=True)
        else:
            s.add_argument("--prepared-sha", required=True)
    args = p.parse_args()
    (prepare if args.mode == "prepare" else execute)(args)


if __name__ == "__main__":
    main()
