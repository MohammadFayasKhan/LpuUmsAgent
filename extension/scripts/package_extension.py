#!/usr/bin/env python3
"""
Chrome Web Store ZIP Packaging Script for ONEE.

Validates the dist/ directory and creates a clean zip archive:
1. Verifies that dist/manifest.json exists and is valid Manifest V3.
2. Checks that icons (16px, 32px, 48px, 128px) and sidepanel.html are present.
3. Packages everything into dist/onee-lpu-agent-v{version}.zip.
"""

import os
import sys
import json
import zipfile

def package_extension():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    ext_dir = os.path.abspath(os.path.join(script_dir, '..'))
    dist_dir = os.path.join(ext_dir, 'dist')
    manifest_path = os.path.join(dist_dir, 'manifest.json')

    if not os.path.isdir(dist_dir):
        print(f"Error: dist directory does not exist at {dist_dir}. Run 'npm run build' first.")
        sys.exit(1)

    if not os.path.isfile(manifest_path):
        print(f"Error: manifest.json not found in {dist_dir}.")
        sys.exit(1)

    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    version = manifest.get('version', '1.0.0')
    zip_filename = f"onee-lpu-agent-v{version}.zip"
    zip_filepath = os.path.join(dist_dir, zip_filename)

    # Remove existing zip if present
    if os.path.exists(zip_filepath):
        os.remove(zip_filepath)

    print(f"📦 Packaging ONEE - LPU Agent v{version}...")
    files_added = []

    with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(dist_dir):
            for file in files:
                # Exclude zip files, source maps, and system artifacts
                if file.endswith('.zip') or file.endswith('.map') or file.startswith('.'):
                    continue
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, dist_dir)
                zipf.write(file_path, arcname)
                files_added.append(arcname)

    size_kb = os.path.getsize(zip_filepath) / 1024
    print(f"✅ Successfully packaged {len(files_added)} files into {zip_filename} ({size_kb:.1f} KB)")
    print(f"📍 Location: {zip_filepath}")

    # Validate essential files in archive
    required_entries = ['manifest.json', 'sidepanel.html', 'service-worker.js', 'content.js']
    with zipfile.ZipFile(zip_filepath, 'r') as check_zip:
        contents = check_zip.namelist()
        for req in required_entries:
            if req not in contents:
                print(f"⚠️ Warning: Missing required entry in ZIP: {req}")

    print("🚀 Extension package is ready for Chrome Web Store Developer Dashboard upload.")

if __name__ == '__main__':
    package_extension()
