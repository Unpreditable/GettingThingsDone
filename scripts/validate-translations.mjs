import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = join(__dirname, '../src/i18n/locales');

function extractPaths(obj, prefix = '') {
  const paths = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key === '_comment' || key.endsWith('_comment')) continue;
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      paths.push(fullKey);
    } else if (typeof value === 'object' && value !== null) {
      paths.push(...extractPaths(value, fullKey));
    }
  }
  return paths;
}

function getValueAtPath(obj, path) {
  return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

function basePluralKey(path) {
  for (const suffix of PLURAL_SUFFIXES) {
    if (path.endsWith(suffix)) {
      return path.slice(0, -suffix.length);
    }
  }
  return null;
}

const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8'));
const requiredPaths = new Set(extractPaths(en));

// The translator template: every key, values left for the translator.
const BLANK_ALLOWED = new Set(['sample_lang.json']);
const files = readdirSync(localesDir)
  .filter(f => f.endsWith('.json') && f !== 'en.json')
  .sort();

let allPassed = true;

for (const file of files) {
  let locale;
  try {
    locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8'));
  } catch (e) {
    console.log(`❌ ${file}: invalid JSON — ${e.message}`);
    allPassed = false;
    continue;
  }
  const localePaths = new Set(extractPaths(locale));

  const missing = [...requiredPaths].filter(p => !localePaths.has(p));
  const extra   = [...localePaths].filter(p => {
    if (requiredPaths.has(p)) return false;
    const base = basePluralKey(p);
    if (base !== null) {
      return !PLURAL_SUFFIXES.some(s => requiredPaths.has(base + s));
    }
    return true;
  });
  const blank   = BLANK_ALLOWED.has(file) ? [] : [...requiredPaths].filter(p => localePaths.has(p) && getValueAtPath(locale, p).trim() === '');

  if (missing.length || extra.length || blank.length) {
    allPassed = false;
    console.log(`❌ ${file}`);
    for (const p of missing) console.log(`   missing: ${p}`);
    for (const p of extra)   console.log(`   extra:   ${p}`);
    for (const p of blank)   console.log(`   blank:   ${p}`);
  } else {
    console.log(`✅ ${file}`);
  }
}

// The changelog is translated as a whole file per locale. Each translation
// must have the same releases, in the same order, and under each the same
// #### sections (Features, Fixes) with as many bullets in each as en.md; that
// catches a missing entry, not stale wording. Section titles are translated,
// so only their places are compared.
const changelogDir = join(__dirname, '../src/changelog');

function changelogOutline(text) {
  const releases = [];
  for (const line of text.split(/\r?\n/)) {
    const release = releases[releases.length - 1];
    if (line.startsWith('## ')) {
      releases.push({ heading: line.slice(3).trim(), sections: [] });
    } else if (!release) {
      continue;
    } else if (line.startsWith('#### ')) {
      release.sections.push({ titled: true, bullets: 0 });
    } else if (/^\s*[-*] /.test(line)) {
      // Bullets straight under the release heading form an untitled section.
      if (!release.sections.length) release.sections.push({ titled: false, bullets: 0 });
      release.sections[release.sections.length - 1].bullets++;
    }
  }
  return releases.map(r => ({
    heading: r.heading,
    shape: r.sections.map(s => `${s.titled ? '####' : '(untitled)'} ${s.bullets}`).join(', ') || '(empty)',
  }));
}

const enOutline = changelogOutline(readFileSync(join(changelogDir, 'en.md'), 'utf8'));
const enHeadings = enOutline.map(s => s.heading);
const changelogIndex = readFileSync(join(changelogDir, 'index.ts'), 'utf8');

for (const file of files.filter(f => !BLANK_ALLOWED.has(f))) {
  const name = file.replace(/\.json$/, '.md');
  let outline;
  try {
    outline = changelogOutline(readFileSync(join(changelogDir, name), 'utf8'));
  } catch {
    console.log(`❌ changelog/${name}: missing`);
    allPassed = false;
    continue;
  }
  const problems = [];
  if (!changelogIndex.includes(`"./${name}"`)) problems.push(`not imported in changelog/index.ts`);
  const headings = outline.map(s => s.heading);
  if (headings.join('\n') !== enHeadings.join('\n')) {
    problems.push(`releases: ${headings.join(', ') || '(none)'} — en.md has ${enHeadings.join(', ')}`);
  } else {
    outline.forEach((r, i) => {
      if (r.shape !== enOutline[i].shape) {
        problems.push(`${r.heading}: sections and bullets ${r.shape} — en.md has ${enOutline[i].shape}`);
      }
    });
  }
  if (problems.length) {
    allPassed = false;
    console.log(`❌ changelog/${name}`);
    for (const p of problems) console.log(`   ${p}`);
  } else {
    console.log(`✅ changelog/${name}`);
  }
}

if (!allPassed) {
  process.exit(1);
}
