"""
Lädt die GeoNames-Alternativnamen-Datenbank herunter und erzeugt
data/german_city_names.json: {german_name_lower: city_id}

Einmalig ausführen; dauert je nach Internetgeschwindigkeit 1-3 Minuten.
"""

import xml.etree.ElementTree as ET
import json
import urllib.request
import zipfile
import sys
import os
import tempfile

DATA_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
GEXF_FILE = os.path.join(DATA_DIR, 'european_cities_graph.gexf')
OUT_FILE  = os.path.join(DATA_DIR, 'german_city_names.json')
ALT_URL   = 'https://download.geonames.org/export/dump/alternateNamesV2.zip'

# ── 1. Stadt-IDs aus dem Graph lesen ──────────────────────────────────────────
print('Lese Stadt-IDs aus dem Graph ...', flush=True)
tree  = ET.parse(GEXF_FILE)
root  = tree.getroot()
ns    = {'g': 'http://www.gexf.net/1.2draft'}
nodes = root.find('g:graph/g:nodes', ns).findall('g:node', ns)

city_ids = set(int(n.attrib['id']) for n in nodes)
print('  {} Staedte gefunden.'.format(len(city_ids)), flush=True)

# ── 2. ZIP auf Festplatte streamen ─────────────────────────────────────────────
tmp_zip = os.path.join(tempfile.gettempdir(), 'geonames_alt_names.zip')
print('Lade alternateNamesV2.zip herunter -> {}'.format(tmp_zip), flush=True)

with urllib.request.urlopen(ALT_URL, timeout=120) as resp:
    total = int(resp.headers.get('Content-Length', 0))
    downloaded = 0
    with open(tmp_zip, 'wb') as out:
        while True:
            chunk = resp.read(1 << 17)  # 128 KB
            if not chunk:
                break
            out.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded / total * 100
                mb  = downloaded / 1000000.0
                sys.stdout.write('\r  {:.1f} / {:.1f} MB  ({:.0f}%)'.format(
                    mb, total / 1000000.0, pct))
                sys.stdout.flush()

print('\n  Download abgeschlossen ({:.1f} MB).'.format(downloaded / 1000000.0), flush=True)

# ── 3. ZIP parsen: nur 'de'-Eintraege unserer Stadt-IDs ───────────────────────
print('Parse Alternativnamen (lang=de) ...', flush=True)

german_names = {}   # city_id (int) -> [(name, is_preferred, is_short)]

with zipfile.ZipFile(tmp_zip) as zf:
    with zf.open('alternateNamesV2.txt') as f:
        for raw in f:
            parts = raw.decode('utf-8').rstrip('\n').split('\t')
            if len(parts) < 4:
                continue
            try:
                gid = int(parts[1])
            except ValueError:
                continue
            if gid not in city_ids:
                continue

            lang          = parts[2]
            name          = parts[3]
            is_preferred  = len(parts) > 4 and parts[4] == '1'
            is_short      = len(parts) > 5 and parts[5] == '1'
            is_colloquial = len(parts) > 6 and parts[6] == '1'
            is_historic   = len(parts) > 7 and parts[7] == '1'

            if lang != 'de' or is_historic or is_colloquial:
                continue

            if gid not in german_names:
                german_names[gid] = []
            german_names[gid].append((name, is_preferred, is_short))

print('  Deutsche Namen fuer {} Staedte gefunden.'.format(len(german_names)), flush=True)

# Temp-Datei aufraemen
try:
    os.remove(tmp_zip)
except OSError:
    pass

# ── 4. Mapping aufbauen: german_name_lower -> city_id ─────────────────────────
# Bevorzugte / kurze Namen kommen zuerst; bei Kollision gewinnt die erste Stadt.
result = {}  # german_name_lower -> city_id
for gid, entries in german_names.items():
    entries.sort(key=lambda e: (not e[1], not e[2]))  # preferred > short > rest
    for name, _, _ in entries:
        key = name.lower()
        if key not in result:
            result[key] = gid

print('  {} Eintraege im Mapping.'.format(len(result)), flush=True)

# ── 5. Speichern ───────────────────────────────────────────────────────────────
with open(OUT_FILE, 'w', encoding='utf-8') as fout:
    json.dump(result, fout, ensure_ascii=False, indent=2)

print('Gespeichert: {}'.format(OUT_FILE), flush=True)

# Kurze Stichprobe
samples = ['muenchen', 'münchen', 'wien', 'prag', 'venedig',
           'rom', 'warschau', 'kopenhagen', 'lissabon', 'brüssel', 'köln']
print('\nStichprobe:')
for key in samples:
    cid = result.get(key)
    print('  {:20s} -> {}'.format(key, cid))
print('Fertig!')
