import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { currentTargetFromEnv, isAuthRequiredForCurrentTarget } from '../auth/targeting';
import { getPersonaSupport, getSuitePersonas } from '../config';

export type PersonaExpectation = 'pass' | 'fail';

export type TestPersona = {
  user: string;
  expectation?: PersonaExpectation;
};

type PersonaRecord = Record<string, unknown> & {
  label?: string;
};

type PersonaSupportContext = {
  suite: string;
  target: string;
  testInfo: unknown;
};

type PersonaSupportModule = {
  switchPersona: (page: unknown, personaKey: string, persona: PersonaRecord, context: PersonaSupportContext) => Promise<void>;
  resetPersona?: (page: unknown, context: PersonaSupportContext) => Promise<void>;
};

const supportModuleCache = new Map<string, Promise<PersonaSupportModule>>();

function normalizeArgs(detailsOrBody: unknown, maybeBody: unknown) {
  if (typeof detailsOrBody === 'function') {
    return {
      details: undefined,
      body: detailsOrBody,
    };
  }

  return {
    details: detailsOrBody,
    body: maybeBody,
  };
}

function getTestTargets(details: unknown) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return {};
  }

  return details as Record<string, unknown>;
}

function registerTest(testApi: any, title: string, details: unknown, body: any) {
  if (details === undefined) {
    return testApi(title, body);
  }

  return testApi(title, details, body);
}

function getPersonaLabel(persona: TestPersona, record: PersonaRecord) {
  const label = typeof record.label === 'string' && record.label.trim()
    ? record.label.trim()
    : persona.user;

  if (persona.expectation) {
    return `${label} / expect ${persona.expectation}`;
  }

  return label;
}

async function runForExpectation(persona: TestPersona, body: any, args: any, testInfo: any) {
  const expectsFailure = persona.expectation === 'fail';

  try {
    await body(args, testInfo);

    if (expectsFailure) {
      throw new Error(`Persona "${persona.user}" was expected to fail, but the test body passed.`);
    }
  }
  catch (error) {
    if (!expectsFailure) {
      throw error;
    }
  }
}

async function loadPersonaSupportModule(suite: string): Promise<PersonaSupportModule> {
  if (!supportModuleCache.has(suite)) {
    supportModuleCache.set(suite, (async () => {
      const support = getPersonaSupport(suite);

      if (!support.module || typeof support.module !== 'string') {
        throw new Error(
          `Suite "${suite}" uses personas but does not define personaSupport.module in qa-workflow config.`
        );
      }

      const modulePath = path.isAbsolute(support.module)
        ? support.module
        : path.resolve(process.cwd(), support.module);

      try {
        const loaded = await import(pathToFileURL(modulePath).href);
        const supportModule = (loaded.default || loaded) as PersonaSupportModule;

        if (!supportModule || typeof supportModule.switchPersona !== 'function') {
          throw new Error('Missing switchPersona export.');
        }

        return supportModule;
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to load persona support module for suite "${suite}" from ${modulePath}: ${message}`
        );
      }
    })());
  }

  return supportModuleCache.get(suite)!;
}

export function createPersonaTest(testApi: any, personas: TestPersona[] = []) {
  return (title: string, detailsOrBody: unknown, maybeBody?: unknown) => {
    const { details, body } = normalizeArgs(detailsOrBody, maybeBody);

    if (typeof body !== 'function') {
      throw new Error(`Persona test "${title}" is missing a test function.`);
    }

    const { suite, target } = currentTargetFromEnv();
    const authRequired = isAuthRequiredForCurrentTarget(getTestTargets(details));

    if (!authRequired || !personas.length) {
      return registerTest(testApi, title, details, body);
    }

    const suitePersonas = getSuitePersonas(suite);

    testApi.describe(`${title} [personas]`, () => {
      testApi.describe.configure({ mode: 'serial' });

      for (const persona of personas) {
        const personaKey = persona.user;
        const record = suitePersonas[personaKey];

        if (!record) {
          throw new Error(
            `Suite "${suite}" does not define persona "${persona.user}" in qa-workflow config.`
          );
        }

        const personaTitle = `${title} [as ${getPersonaLabel(persona, record)}]`;

        registerTest(testApi, personaTitle, details, async (args: any, testInfo: any) => {
          const supportModule = await loadPersonaSupportModule(suite);
          const context: PersonaSupportContext = {
            suite,
            target,
            testInfo,
          };

          await supportModule.switchPersona(args.page, personaKey, record, context);

          try {
            if (persona.expectation) {
              testInfo.annotations.push({
                type: 'persona-expectation',
                description: persona.expectation,
              });
            }

            await runForExpectation(persona, body, args, testInfo);
          }
          finally {
            if (typeof supportModule.resetPersona === 'function') {
              await supportModule.resetPersona(args.page, context);
            }
          }
        });
      }
    });
  };
}
