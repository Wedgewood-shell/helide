#!/usr/bin/env python3
"""Rename Helium's runtime identifiers to Helide in a patched source tree.

Runs after the patches, Helium's name substitution and the visible-string
branding (apply-helide-branding.py, which renames helium:// in GRIT strings).
It rewrites what the outside world sees, and nothing else:

  pref keys           helium.browser.layout        -> helide.browser.layout
  internal URLs       helium://settings            -> helide://settings
  launch switches     --helium-frame-opacity       -> --helide-frame-opacity
  executable          out/Default/helium           -> out/Default/helide
  profile directory   ~/.config/net.imput.helium   -> ~/.config/net.imput.helide
  desktop file, icon  helium.desktop, helium       -> helide.desktop, helide
  flag descriptions   "Helium flag."               -> "Helide flag."

C++ names, namespaces, file paths, GN targets, base::Feature names, content
setting names, the private sync protocol, Helium's service domains and the
"Helium Authors" attribution stay as they are. Profiles from Helium are moved
and their pref keys renamed on first start (linux-helide-rename.patch).

The rules are idempotent. patches are written against the tree before this
step; scripts/generate-patch-from-build.py undoes nothing, it compares lines
with these rules applied to both sides (see rename_line()).

  scripts/apply-helide-rename.py [--tree build/src] [--check]
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Second segments of Helium's pref keys. Anything else after "helium." is a
# host name (helium.computer, services.helium.imput.net) and stays.
PREF_GROUPS = (
    'agent_access', 'browser', 'completed_onboarding', 'crash_reporting',
    'global_privacy_control', 'noise', 'private_sync', 'services', 'settings',
)
# Helium's launch switches and about:flags names (the same strings).
SWITCHES = (
    'frame-blur', 'frame-opacity', 'hide-page-actions',
    'middle-click-paste-enabled', 'native-frame-materials', 'noise',
    'noise-audio', 'noise-canvas', 'noise-hw-concurrency', 'split-clienthello',
    'transparent-web-content', 'update-channel',
)

# (pattern, replacement, files it applies to; None = every scanned file)
RULES = [
    # Pref keys, in C++, TypeScript and HTML (pref-key="...",
    # prefs.helium.services.enabled).
    (re.compile(r'(?<![\w/-])helium\.(?=(?:%s)\b)' % '|'.join(PREF_GROUPS)),
     'helide.', None),
    # The prefix onboarding uses to reach those prefs.
    (re.compile(r'(kHeliumPrefPrefix\[\] = )"helium\."'), r'\1"helide."',
     {'components/helium_services/pref_names.h'}),
    # Internal URLs written out in source.
    (re.compile(r'(?<!\w)helium://'), 'helide://', None),
    # The scheme itself. Only this definition; the legacy alias that keeps
    # old helium:// links working is a separate constant.
    (re.compile(r'(kHeliumUIScheme\[\] = )"helium"'), r'\1"helide"', None),
    (re.compile(r'(replace\(0, 6, )u"helium"'), r'\1u"helide"',
     {'components/omnibox/browser/builtin_provider.cc'}),
    # Launch switches and flag names, where they are defined. The same
    # strings elsewhere are content setting names and stay.
    (re.compile(r'"helium-(%s)"' % '|'.join(SWITCHES)), r'"helide-\1"',
     {'chrome/browser/helium_flag_choices.h',
      'chrome/browser/channel_selection.h',
      'chrome/browser/ui/views/helium/native_frame_materials.cc'}),
    # Profile directory (the move is in linux-helide-rename.patch).
    (re.compile(r'(data_dir_basename = )"net\.imput\.helium"'),
     r'\1"net.imput.helide"',
     {'chrome/common/chrome_paths_linux.cc'}),
    # Desktop file, which is also the Wayland app-id, and the icon name.
    (re.compile(r'"helium\.desktop"'), '"helide.desktop"',
     {'chrome/common/channel_info_posix.cc'}),
    (re.compile(r'"HELIUM_DESKTOP"'), '"HELIDE_DESKTOP"',
     {'chrome/common/channel_info_posix.cc'}),
    (re.compile(r'(GetIconName\(\) \{\n  return )"helium"'), r'\1"helide"',
     {'chrome/browser/shell_integration_linux.cc'}),
    # The executable and the crash handler next to it.
    (re.compile(r'(_chrome_output_name = )"helium"'), r'\1"helide"',
     {'chrome/BUILD.gn'}),
    (re.compile(r'\$root_out_dir/helium(?=["._])'), '$root_out_dir/helide',
     {'chrome/BUILD.gn', 'chrome/installer/linux/BUILD.gn'}),
    (re.compile(r'\bhelium_crashpad_handler\b'), 'helide_crashpad_handler',
     {'chrome/BUILD.gn', 'chrome/installer/linux/BUILD.gn',
      'components/crash/core/app/BUILD.gn',
      'components/crash/core/app/crashpad_linux.cc'}),
    (re.compile(r'(process_name = )u"helium"'), r'\1u"helide"',
     {'chrome/browser/memory_details_linux.cc'}),
    # The name PulseAudio shows for the browser's streams.
    (re.compile(r'(kBrowserDisplayName\[\] = )"helium"'), r'\1"helide"',
     {'media/audio/pulse/pulse_util.cc'}),
    (re.compile(r'(#define PRODUCT_STRING )"Helium"'), r'\1"Helide"',
     {'media/audio/pulse/pulse_util.cc'}),
    # Visible text of Helium's about:flags entries, which is not in GRIT.
    (re.compile(r'\bHelium\b(?!\s+Authors)'), 'Helide',
     {'chrome/browser/helium_flag_entries.h'}),
]

SCAN_DIRS = ('chrome', 'components', 'content', 'ui', 'extensions', 'services',
             'media/audio/pulse')
SUFFIXES = {'.cc', '.h', '.mm', '.ts', '.js', '.html', '.css', '.json', '.svelte',
            '.gn'}
SKIP_PARTS = {'out', 'node_modules', '.git', 'test', 'tests', 'testdata'}
# Cheap filter before running the rules on a file.
NEEDLE = re.compile(rb'helium|Helium|HELIUM')


def rename_text(text, path):
    """Applies every rule for `path` (relative, posix) to `text`."""
    for pattern, replacement, files in RULES:
        if files is None or path in files:
            text = pattern.sub(replacement, text)
    return text


def rename_line(line, path):
    """For comparing a line before and after this step."""
    return rename_text(line, path)


def candidate_files(tree):
    for top in SCAN_DIRS:
        for path in (tree / top).rglob('*'):
            if path.suffix not in SUFFIXES or not path.is_file():
                continue
            if SKIP_PARTS.intersection(path.relative_to(tree).parts):
                continue
            yield path


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--tree', type=Path, default=ROOT / 'build/src')
    parser.add_argument('--check', action='store_true',
                        help='report what would change, write nothing')
    args = parser.parse_args()
    if not (args.tree / 'chrome/app/theme/chromium/BRANDING').exists():
        parser.error('Expected a patched Chromium source tree')

    changed = 0
    for path in candidate_files(args.tree):
        data = path.read_bytes()
        if not NEEDLE.search(data):
            continue
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            continue
        relative = path.relative_to(args.tree).as_posix()
        renamed = rename_text(text, relative)
        if renamed == text:
            continue
        changed += 1
        if args.check:
            print(relative)
        else:
            path.write_bytes(renamed.encode('utf-8'))
    print(f'Helide rename: {changed} files {"would change" if args.check else "changed"}')
    # Fail loudly if a rule stopped matching after an upstream update.
    for relative, needle in [
            ('content/public/common/url_constants.h', 'kHeliumUIScheme[] = "helide"'),
            ('chrome/common/chrome_paths_linux.cc',
             'data_dir_basename = "net.imput.helide"'),
            ('chrome/common/channel_info_posix.cc', '"helide.desktop"'),
            ('chrome/browser/shell_integration_linux.cc', 'return "helide"'),
            ('chrome/BUILD.gn', '_chrome_output_name = "helide"'),
            ('components/crash/core/app/crashpad_linux.cc', 'helide_crashpad_handler'),
            ('media/audio/pulse/pulse_util.cc', 'kBrowserDisplayName[] = "helide"')]:
        if not args.check and needle not in (args.tree / relative).read_text():
            sys.exit(f'Helide rename: expected {needle!r} in {relative}')


if __name__ == '__main__':
    main()
