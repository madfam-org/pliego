"""Synthetic native sheet capture; no historical game content or route fixtures."""
import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from urllib.parse import unquote

SCRIPT = Path(__file__).resolve().parents[2] / "companion_book.py"
spec = importlib.util.spec_from_file_location("companion_book", SCRIPT)
book = importlib.util.module_from_spec(spec)
spec.loader.exec_module(book)
from qa import factory_preset_archive as archive


class CompanionBook(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="pliego-companion-"))
        cls.commons = cls.tmp / "commons"
        slug = cls.commons / "saddle-stitch"
        slug.mkdir(parents=True)
        (slug / "project.json").write_text(json.dumps({"parameters": [{"id": "pages", "default": 8}, {"id": "binding", "default": "left"}]}))
        (slug / "main.py").write_text(
            'import pliego\nsheets=[pliego.Sheet(f"sheet-{i+1}",[(0,0),(210,0),(210,148),(0,148)],stock="copy-80") for i in range(2)]\n'
            'marks=[s.valley((105,0),(105,148)) for s in sheets]\n'
            'result=pliego.Assembly(sheets,controls=[pliego.sequence_control()],sequence=pliego.Sequence([pliego.Step("fold",{"en":"Fold","es":"Doblar","fr":"Plier","pt":"Dobrar"},[(m,90) for m in marks])]))\n')
        def git(*args):
            return subprocess.check_output(["git", "-C", str(cls.commons), "-c", "user.name=Test", "-c", "user.email=test@example.invalid", *args]).decode().strip()
        git("init", "-q");git("add", ".");git("commit", "-qm", "synthetic fixture")
        runtime = subprocess.check_output(["git", "-C", str(archive.ROOT), "rev-parse", "HEAD"]).decode().strip()
        cls.native = cls.tmp / "native"
        archive.produce(cls.commons,git("rev-parse","HEAD"),"saddle-stitch","default","default",{},cls.native,runtime)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def setUp(self):
        self.content = {"schema":"authored-archive-companion/0.1", "edition":{"reference":"https://example.org/edition"},
                        "pages":[{"id":f"page-{i}","kind":"unknown","title":{"en":"Unknown","es":"Desconocido"},
                                  "paragraphs":{"en":["No admitted route."],"es":["No hay ruta admitida."]},"sources":[]} for i in range(1,9)]}
        self.path = self.tmp / (self._testMethodName + ".json")
        self.out = self.tmp / self._testMethodName

    def build(self):
        self.path.write_text(json.dumps(self.content))
        return book.build(self.native,self.path,self.out)

    def test_all_eight_pages_map_once_and_art_does_not_change_native_geometry(self):
        result = self.build()
        self.assertEqual([(p["number"],p["sheet"],p["side"],p["half"]) for p in result["pages"]],
                         [(1,"sheet-1","back","L"),(2,"sheet-1","front","L"),(3,"sheet-2","back","L"),(4,"sheet-2","front","L"),
                          (5,"sheet-2","front","R"),(6,"sheet-2","back","R"),(7,"sheet-1","front","R"),(8,"sheet-1","back","R")])
        self.assertTrue(result["checks"]["geometry_unchanged"])
        for name, descriptor in result["files"].items():
            self.assertEqual(book.sha((self.out/name).read_bytes()),descriptor["sha256"])
        self.assertFalse(result["checks"]["guide_content_admitted"])
        document = book.Document.from_json((self.out/'book-en.fold').read_bytes())
        self.assertEqual(document.verify(),[])
        back = unquote(document.data['pliego:sheets'][0]['back']['art'])
        front = unquote(document.data['pliego:sheets'][0]['front']['art'])
        self.assertLess(back.index('page-8'),back.index('page-1'))
        self.assertLess(front.index('page-2'),front.index('page-7'))
        self.assertEqual(result['pages'][0]['back_view_slot'],1)
        self.assertEqual(result['pages'][7]['back_view_slot'],0)
        with self.assertRaisesRegex(ValueError,"already occupied"): self.build()

    def test_unadmitted_guide_and_wrong_page_order_refuse(self):
        self.content["pages"][0]["kind"]="walkthrough"
        with self.assertRaisesRegex(ValueError,"no admission"): self.build()
        self.content["pages"][0]["kind"]="unknown"
        self.content["pages"][0]["id"]="page-9"
        with self.assertRaisesRegex(ValueError,"ordered logical"): self.build()

    def test_script_text_is_escaped_and_external_reference_is_refused(self):
        self.content["pages"][0]["title"]["en"]='<script>alert(1)</script>'
        result = self.build()
        svg=(self.out/'pages/en/page-1.svg').read_text()
        self.assertNotIn('<script>',svg);self.assertIn('&lt;script&gt;',svg)
        self.assertTrue(result["checks"]["geometry_unchanged"])
        self.content["pages"][0]["sources"]=['file:///private/example']
        with self.assertRaises(ValueError): book.validate_content(self.content)

    def test_changed_native_asset_refuses_before_deriving_artwork(self):
        changed = self.tmp / 'changed-native-fixture'
        shutil.copytree(self.native,changed)
        entry = book.read(changed/'manifest.json')['entries'][0]
        (changed/entry['assets']['glb']['path']).write_bytes(b'changed native mesh')
        self.path.write_text(json.dumps(self.content))
        with self.assertRaises(ValueError): book.build(changed,self.path,self.out)
        self.assertFalse((self.out/'companion.json').exists())

    def test_curated_links_cannot_be_bound_to_another_historical_edition(self):
        self.path.write_text(json.dumps(self.content))
        handoff = self.tmp/'handoff.json'
        handoff.write_text(json.dumps({'schema':'curated-experience-handoff/0.1','historical_reference':'https://example.org/other'}))
        with self.assertRaisesRegex(ValueError,'different edition'):
            book.build(self.native,self.path,self.out,handoff)
        self.assertFalse((self.out/'companion.json').exists())


if __name__ == '__main__':
    unittest.main()
