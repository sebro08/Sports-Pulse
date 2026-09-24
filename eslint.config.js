import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Fronteras de arquitectura:
//  - shared/  no puede depender de modules/
//  - un modulo no puede importar de otro modulo (se comunican via app.ts o shared/)
const modules = ['catalog', 'health', 'ingestion'];

const moduleBoundary = (self) => ({
  files: [`src/modules/${self}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: modules
          .filter((other) => other !== self)
          .map((other) => ({
            group: [`**/${other}`, `**/${other}/**`],
            message: `El modulo "${self}" no puede importar del modulo "${other}".`,
          })),
      },
    ],
  },
});

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/modules/**'], message: 'shared/ no puede depender de modules/.' },
          ],
        },
      ],
    },
  },
  ...modules.map(moduleBoundary),
);
