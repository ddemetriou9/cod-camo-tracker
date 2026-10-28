from pathlib import Path
import json,zipfile
ROOT=Path(__file__).resolve().parent
manifest=['Open-HTML-Tracker.cmd','Open-Automatic-Tracker.cmd','Web-Companion.ps1','Watch-CamoMenu.ps1','LocalCapture.ps1','CamoProgress.ps1','watch-settings.json','weapons.json','README.md']
destination=ROOT/'MW4-HTML-Tracker.zip'
with zipfile.ZipFile(destination,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for name in manifest:z.write(ROOT/name,name)
    for file in (ROOT/'web').rglob('*'):
        if not file.is_file() or file.name=='migration.js':continue
        z.write(file,file.relative_to(ROOT).as_posix())
    z.writestr('web/migration.js','window.NATIVE_MIGRATION=null;\n')
    z.writestr('START-HERE.txt','MW4 FIELDNOTES\n\nExtract this entire ZIP.\nOpen-HTML-Tracker.cmd opens the manual HTML/JavaScript tracker.\nOpen-Automatic-Tracker.cmd opens the optional Windows OCR companion.\nCapture starts only when you click Start tracker.\nProgress stays in your browser; export a plan backup.\nNo personal progress, screenshots or imported images are included in this ZIP.\nRead README.md for source confidence and current limitations.\n')
with zipfile.ZipFile(destination) as z:
    assert all(not n.startswith(('data/','validation/','catalog-source/')) for n in z.namelist())
    assert z.read('web/migration.js')==b'window.NATIVE_MIGRATION=null;\n'
print(json.dumps({'zip':str(destination),'bytes':destination.stat().st_size,'runtimeFiles':len(manifest),'personalDataIncluded':False}))
