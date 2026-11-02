"""Archive integration: real native evaluation, adversarial metadata and stale files."""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

QA = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("factory_archive", QA / "factory_preset_archive.py")
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


def git(root, *args):
    return subprocess.check_output(
        ["git", "-C", str(root), "-c", "user.name=Archive Test",
         "-c", "user.email=archive@example.invalid", *args]).decode().strip()


class ArchiveTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="pliego-archive-test-"))
        cls.commons = cls.tmp / "commons"
        slug = cls.commons / "test-sheet"
        slug.mkdir(parents=True)
        manifest = {"parameters": [{"id": "size", "default": 100}],
                    "presets": [{"id": "small", "values": {"size": 40}}]}
        (slug / "project.json").write_text(json.dumps(manifest))
        (slug / "main.py").write_text(
            'import pliego\nsize = pliego.clamp(float(size), 10, 200)\n'
            'result = pliego.Sheet("actual-part", pliego.square(size), stock="copy-80")\n')
        git(cls.commons, "init", "-q")
        git(cls.commons, "add", ".")
        git(cls.commons, "commit", "-qm", "test fixture")
        cls.pin = git(cls.commons, "rev-parse", "HEAD")
        cls.runtime_pin = git(archive.ROOT, "rev-parse", "HEAD")
        cls.fixture = cls.tmp / "capture"
        archive.produce(cls.commons, cls.pin, "test-sheet", "small", "default",
                        {"size": "999"}, cls.fixture, cls.runtime_pin)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def setUp(self):
        self.out = self.tmp / self._testMethodName
        shutil.copytree(self.fixture, self.out)
        self.manifest = self.out / "manifest.json"
        self.data = json.loads(self.manifest.read_bytes())
        self.entry = self.data["entries"][0]

    def save(self):
        self.entry["entry_digest"] = archive.digest(
            {k: v for k, v in self.entry.items() if k != "entry_digest"})
        self.manifest.write_text(json.dumps(self.data))

    def test_capture_replays_and_preserves_requested_types_and_clamping(self):
        archive.check_archive(self.out, self.pin, self.commons, replay=True)
        self.assertEqual(self.entry["source"]["params"], {"size": "999"})
        self.assertEqual(self.entry["resolved_parameters"], {"size": 200.0})
        self.assertEqual(self.entry["parts"], ["actual-part"])
        self.assertEqual(self.entry["provenance"]["animation"]["clips"], [])

    def test_wrong_pin_rejected_even_with_plausible_full_sha(self):
        with self.assertRaisesRegex(ValueError, "wrong source pin"):
            archive.check_archive(self.out, "f" * 40)
        self.entry["source"]["pin"] = "f" * 40
        self.save()
        with self.assertRaises(subprocess.CalledProcessError):
            archive.check_archive(self.out, commons=self.commons)

    def test_stale_asset_rejected(self):
        (self.out / self.entry["assets"]["glb"]["path"]).write_bytes(b"old GLB")
        with self.assertRaisesRegex(ValueError, "stale asset"):
            archive.check_archive(self.out)

    def test_claimed_metre_or_up_axis_cannot_be_changed(self):
        for key, value in (("units", "mm"), ("up_axis", "Z")):
            with self.subTest(key=key):
                old = self.entry["assets"]["glb"]["frame"][key]
                self.entry["assets"]["glb"]["frame"][key] = value
                self.save()
                with self.assertRaisesRegex(ValueError, "wrong asset unit/frame"):
                    archive.check_archive(self.out)
                self.entry["assets"]["glb"]["frame"][key] = old

    def test_changed_request_does_not_silently_reuse_old_resolved_geometry(self):
        self.entry["source"]["params"] = {"size": 90}
        self.entry["source"]["caller_params"] = {"size": 90}
        self.save()
        with self.assertRaisesRegex(ValueError, "do not reproduce resolved"):
            archive.check_archive(self.out, replay=True)

    def test_metre_claim_cannot_hide_an_unscaled_native_glb(self):
        doc = json.loads((self.out / self.entry["assets"]["fold"]["path"]).read_bytes())
        to_glb = archive.load_native()[3]
        blob = to_glb(doc, unit_scale=1)
        row = self.entry["assets"]["glb"]
        (self.out / row["path"]).write_bytes(blob)
        row.update(sha256=archive.sha(blob), bytes=len(blob))
        self.save()
        with self.assertRaisesRegex(ValueError, "mm-to-m unit scale"):
            archive.check_archive(self.out)

    def test_resolved_parameters_must_match_native_fold(self):
        self.entry["resolved_parameters"]["size"] = 90
        self.save()
        with self.assertRaisesRegex(ValueError, "resolved parameters differ"):
            archive.check_archive(self.out)

    def test_stale_runtime_and_source_closure_rejected(self):
        for label, rows in (("runtime", self.entry["runtime"]["files"]),
                            ("source", self.entry["source"]["files"])):
            with self.subTest(label=label):
                p = self.out / rows[0]["archive_path"]
                original = p.read_bytes()
                p.write_bytes(b"drift")
                with self.assertRaisesRegex(ValueError, "stale closure"):
                    archive.check_archive(self.out)
                p.write_bytes(original)

    def test_path_escape_rejected(self):
        self.entry["assets"]["glb"]["path"] = "../outside.glb"
        self.save()
        with self.assertRaisesRegex(ValueError, "escapes root"):
            archive.check_archive(self.out)

    def test_unknown_parameter_and_empty_archive_rejected(self):
        with self.assertRaisesRegex(ValueError, "unknown requested"):
            archive.resolve({"parameters": []}, "default", "default", {"oops": 1})
        self.data["entries"] = []
        self.manifest.write_text(json.dumps(self.data))
        with self.assertRaisesRegex(ValueError, "wrong/empty"):
            archive.check_archive(self.out)

    def test_named_presets_have_distinct_effective_request_tuples(self):
        manifest = {"parameters": [{"id": "size", "default": 100}],
                    "presets": [{"id": "small", "values": {"size": 40}},
                                {"id": "large", "values": {"size": 120}}]}
        small = archive.resolve(manifest, "small", "default", {})[2]
        large = archive.resolve(manifest, "large", "default", {})[2]
        self.assertEqual(small, {"size": 40})
        self.assertEqual(large, {"size": 120})
        self.assertNotEqual(archive.digest(small), archive.digest(large))
        self.assertEqual(archive.resolve(manifest, "default", "default", {})[2], {})
        self.entry["source"]["params"] = {}
        self.save()
        with self.assertRaisesRegex(ValueError, "effective requested preset"):
            archive.check_archive(self.out)


if __name__ == "__main__":
    unittest.main()
