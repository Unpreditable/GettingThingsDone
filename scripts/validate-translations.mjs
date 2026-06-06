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

const SKIP = new Set(['en.json', 'sample_lang.json']);
const files = readdirSync(localesDir)
  .filter(f => f.endsWith('.json') && !SKIP.has(f))
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
  const blank   = [...requiredPaths].filter(p => localePaths.has(p) && getValueAtPath(locale, p).trim() === '');

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

if (!allPassed) {
  process.exit(1);
}
