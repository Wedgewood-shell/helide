#!/usr/bin/env python3
"""Tests for apply-helide-rename.py: what it renames, and what it must not."""
import importlib.util
import tempfile
import unittest
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    'helide_rename', ROOT / 'scripts/apply-helide-rename.py')
rename = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rename)


def r(text, path='chrome/browser/foo.cc'):
    return rename.rename_text(text, path)


class RenameTest(unittest.TestCase):
    def test_pref_keys(self):
        self.assertEqual(r('"helium.browser.layout"'), '"helide.browser.layout"')
        self.assertEqual(r('pref-key="helium.agent_access.enabled"', 'x.html'),
                         'pref-key="helide.agent_access.enabled"')
        self.assertEqual(r('[[prefs.helium.services.enabled.value]]', 'x.html'),
                         '[[prefs.helide.services.enabled.value]]')
        self.assertEqual(r('"helium.completed_onboarding"'), '"helide.completed_onboarding"')

    def test_hosts_stay(self):
        for text in ['"https://services.helium.imput.net"', '"helium.computer"',
                     '"https://updates.helium.computer/"', '"helium.surf"']:
            self.assertEqual(r(text), text)

    def test_scheme(self):
        self.assertEqual(r('inline constexpr char kHeliumUIScheme[] = "helium";'),
                         'inline constexpr char kHeliumUIScheme[] = "helide";')
        self.assertEqual(r("'helium://settings'", 'x.ts'), "'helide://settings'")
        # The alias for old links.
        legacy = 'inline constexpr char kHeliumLegacyUIScheme[] = "helium";'
        self.assertEqual(r(legacy), legacy)

    def test_switches_only_where_defined(self):
        choices = 'chrome/browser/helium_flag_choices.h'
        self.assertEqual(r('= "helium-frame-opacity";', choices),
                         '= "helide-frame-opacity";')
        # The same string is a content setting name elsewhere.
        registry = 'components/content_settings/core/browser/content_settings_registry.cc'
        self.assertEqual(r('"helium-noise"', registry), '"helium-noise"')
        # The private sync protocol.
        self.assertEqual(r('"helium-private-sync-v1/object/"'), '"helium-private-sync-v1/object/"')

    def test_profile_dir_only_the_current_one(self):
        paths = 'chrome/common/chrome_paths_linux.cc'
        self.assertEqual(r('std::string data_dir_basename = "net.imput.helium";', paths),
                         'std::string data_dir_basename = "net.imput.helide";')
        # The migration's name for the old directory.
        old = 'constexpr char kHeliumDataDirBasename[] = "net.imput.helium";'
        self.assertEqual(r(old, paths), old)

    def test_executable(self):
        self.assertEqual(r('_chrome_output_name = "helium"', 'chrome/BUILD.gn'),
                         '_chrome_output_name = "helide"')
        self.assertEqual(r('binary = "$root_out_dir/helium"', 'chrome/BUILD.gn'),
                         'binary = "$root_out_dir/helide"')
        self.assertEqual(r('"$root_out_dir/helium.breakpad.ia32"', 'chrome/BUILD.gn'),
                         '"$root_out_dir/helide.breakpad.ia32"')
        self.assertEqual(r('Append("helium_crashpad_handler")',
                           'components/crash/core/app/crashpad_linux.cc'),
                         'Append("helide_crashpad_handler")')

    def test_flag_text_keeps_attribution(self):
        entries = 'chrome/browser/helium_flag_entries.h'
        self.assertEqual(r('"[Helium Noise] Canvas. Helium flag."', entries),
                         '"[Helide Noise] Canvas. Helide flag."')
        self.assertEqual(r('// Copyright 2025 The Helium Authors', entries),
                         '// Copyright 2025 The Helium Authors')

    def test_cpp_names_stay(self):
        for text in ['#include "chrome/browser/ui/views/helium/foo.h"',
                     'namespace helium {', 'helium::kThreeFingerTabScrub',
                     'BASE_FEATURE(kHeliumNoise, "HeliumNoise", ENABLED)']:
            self.assertEqual(r(text), text)

    def test_idempotent(self):
        text = '"helium.browser.layout" helium://flags'
        self.assertEqual(r(r(text)), r(text))

    def test_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            tree = Path(tmp)
            (tree / 'chrome/app/theme/chromium').mkdir(parents=True)
            (tree / 'chrome/app/theme/chromium/BRANDING').write_text('')
            files = {
                'content/public/common/url_constants.h':
                    'inline constexpr char kHeliumUIScheme[] = "helium";\n',
                'chrome/common/chrome_paths_linux.cc':
                    '  std::string data_dir_basename = "net.imput.helium";\n',
                'chrome/common/channel_info_posix.cc':
                    '  return "helium.desktop";\n',
                'chrome/browser/shell_integration_linux.cc':
                    'std::string GetIconName() {\n  return "helium";\n}\n',
                'chrome/BUILD.gn': '    _chrome_output_name = "helium"\n',
                'components/crash/core/app/crashpad_linux.cc':
                    'Append("helium_crashpad_handler")\n',
                'media/audio/pulse/pulse_util.cc':
                    'constexpr char kBrowserDisplayName[] = "helium";\n',
                'chrome/browser/resources/settings/page.html':
                    '<x pref-key="helium.browser.layout">\n',
                'chrome/browser/test/ignored.cc': '"helium.browser.layout"\n',
            }
            for path, text in files.items():
                (tree / path).parent.mkdir(parents=True, exist_ok=True)
                (tree / path).write_text(text)
            command = [sys.executable, str(ROOT / 'scripts/apply-helide-rename.py'),
                       '--tree', str(tree)]
            subprocess.run(command, check=True, capture_output=True)
            self.assertIn('helide.browser.layout',
                          (tree / 'chrome/browser/resources/settings/page.html').read_text())
            self.assertIn('helium.browser.layout',
                          (tree / 'chrome/browser/test/ignored.cc').read_text())
            first = {p: (tree / p).read_text() for p in files}
            subprocess.run(command, check=True, capture_output=True)
            self.assertEqual(first, {p: (tree / p).read_text() for p in files})


if __name__ == '__main__':
    unittest.main()
