const fs = require('node:fs');
const path = require('node:path');

const { getDefaultSuite, getPathConfig, getPersonaSupport, getSuitePersonas, suiteSupportsPersonas } = require('../config');
const { createPrompt, buildSpecFilename, ensureDir, flattenTargetHosts, inferSuiteFromFilename, listRecordedFiles, parseCsv, slugify, toTag } = require('./workflow-utils');

const RECORDED_DIR = path.join(process.cwd(), getPathConfig('recordedDir', 'tests/recorded'));
const SPECS_DIR = path.join(process.cwd(), getPathConfig('specsDir', 'tests/specs'));

function normalizeGotoUrls(content) {
  const hosts = flattenTargetHosts();
  let next = content;

  for (const host of hosts) {
    const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`page\\.goto\\((['"])https?:\\/\\/${escapedHost}([^'"]*)\\1\\)`, 'g');

    next = next.replace(pattern, (_, quote, urlPath) => {
      let relativePath = urlPath || '/';

      if (!relativePath.startsWith('/')) {
        relativePath = `/${relativePath}`;
      }

      return `page.goto(${quote}${relativePath}${quote})`;
    });
  }

  return next;
}

function injectTags(content, tags) {
  if (!tags.length) {
    return content;
  }

  const tagLiteral = `[${tags.map((tag) => `'${tag}'`).join(', ')}]`;

  return content.replace(
    /test\((['"`][^'"`]+['"`])\s*,\s*async\s*\(/g,
    `test($1, { tag: ${tagLiteral} }, async (`
  );
}

function injectPersonaSupport(content, personas) {
  if (!personas.length) {
    return content;
  }

  const importLine = "import { createPersonaTest } from '@lockweb/qa-workflow/support/persona-test';";
  const personaLiteral = personas
    .map((persona) => `  { user: '${persona.user}', expectation: '${persona.expectation}' }`)
    .join(',\n');
  const scaffold = `\n${importLine}\n\nconst TEST_PERSONAS = [\n${personaLiteral}\n];\n\nconst personaTest = createPersonaTest(test, TEST_PERSONAS);\n`;

  let next = content;

  if (!next.includes(importLine)) {
    next = next.replace(
      /import\s+\{\s*test,\s*expect\s*\}\s+from\s+['"]@playwright\/test['"];\s*/,
      (match) => `${match}${scaffold}`
    );
  }

  next = next.replace(/\btest\(/g, 'personaTest(');

  return next;
}

function loadPersonaKeys(suite) {
  return Object.keys(getSuitePersonas(suite)).sort();
}

async function choosePersonaKeys(prompt, availablePersonas) {
  if (!availablePersonas.length) {
    return [];
  }

  console.log('\nPersona keys:');

  availablePersonas.forEach((persona, index) => {
    console.log(`  ${index + 1}. ${persona}`);
  });

  while (true) {
    const answer = await prompt.ask(
      'Blank for base logged-in user only, or comma-separated persona numbers',
      ''
    );

    if (!answer.trim()) {
      return [];
    }

    const selections = parseCsv(answer);
    const resolved = [];
    let invalid = '';

    for (const selection of selections) {
      const byIndex = Number.parseInt(selection, 10);

      if (!Number.isInteger(byIndex) || byIndex < 1 || byIndex > availablePersonas.length) {
        invalid = selection;
        break;
      }

      resolved.push(availablePersonas[byIndex - 1]);
    }

    if (!invalid) {
      return [...new Set(resolved)];
    }

    console.log(`Invalid persona selection "${invalid}".`);
  }
}

async function main() {
  const prompt = createPrompt();

  try {
    const recordedFiles = listRecordedFiles(RECORDED_DIR);

    if (!recordedFiles.length) {
      console.error(`No recorded specs found in ${getPathConfig('recordedDir', 'tests/recorded')}/.`);
      process.exit(1);
    }

    const selected = await prompt.choose('Recorded file', recordedFiles, recordedFiles[0]);
    const selectedPath = path.join(RECORDED_DIR, selected);
    const inferred = inferSuiteFromFilename(selected);

    const suite = inferred.suite || getDefaultSuite();
    const nameAnswer = await prompt.ask('Final test name', inferred.name || 'new-test');
    const smoke = await prompt.choose('Tag as smoke?', ['yes', 'no'], 'no');
    const regression = await prompt.choose('Tag as regression?', ['yes', 'no'], 'yes');
    const extraTagAnswer = await prompt.ask('Extra tags (comma-separated)', '');
    const availablePersonas = loadPersonaKeys(suite);

    if (availablePersonas.length && !getPersonaSupport(suite).module) {
      throw new Error(
        `Suite "${suite}" defines personas but does not define personaSupport.module in qa-workflow config.`
      );
    }

    const extraTags = parseCsv(extraTagAnswer).map(toTag).filter(Boolean);
    const name = slugify(nameAnswer);
    const personaKeys = suiteSupportsPersonas(suite)
      ? await choosePersonaKeys(prompt, availablePersonas)
      : [];
    const personas = [];

    for (const personaKey of personaKeys) {
      const expectation = await prompt.choose(`Expectation for persona "${personaKey}"`, ['pass', 'fail'], 'pass');
      personas.push({
        user: personaKey,
        expectation,
      });
    }

    const tags = [
      toTag(suite),
      ...(smoke === 'yes' ? ['@smoke'] : []),
      ...(regression === 'yes' ? ['@regression'] : []),
      ...extraTags,
    ].filter(Boolean);

    const uniqueTags = [...new Set(tags)];
    const fileName = buildSpecFilename({ suites: [suite], name });
    const outputPath = path.join(SPECS_DIR, suite, fileName);

    ensureDir(path.dirname(outputPath));

    let content = fs.readFileSync(selectedPath, 'utf8');
    content = normalizeGotoUrls(content);
    content = injectTags(content, uniqueTags);
    content = injectPersonaSupport(content, personas);

    fs.writeFileSync(outputPath, content);

    console.log(`\nPublished ${selected} -> ${path.join(getPathConfig('specsDir', 'tests/specs'), suite, fileName)}`);
    console.log(`Suite: ${suite}`);
    console.log(`Tags: ${uniqueTags.join(', ') || '(none)'}`);
  }
  finally {
    prompt.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
